import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { UploadDocumentComponent } from '../upload-document/upload-document.component';
import { BokComponent } from '@eo4geo/ngx-bok-visualization';
import { AnnotateDocumentComponent } from '../annotate-document/annotate-document.component';
import { PDFDocument } from 'pdf-lib';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, finalize, of, Subscription, timer } from 'rxjs';
import { AccordionModule } from 'primeng/accordion';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { DocumentInformationComponent } from "../document-information/document-information.component";
import { DocumentForm } from '../../model/documentForm';
import { ToastModule } from 'primeng/toast';
import { MessageService } from "primeng/api";
import { StorageService } from '../../services/storage.service';
import { Router } from '@angular/router';
import { AuthService } from '@eo4geo/ngx-bok-utils';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ProgressBarModule } from 'primeng/progressbar';
import { PanelModule } from 'primeng/panel';
import { SliderModule } from 'primeng/slider';
import { BokMatchingService, BokClassificationResult, BokMatch } from '../../services/bok-matching.service';
import { PdfTextExtractorService, PdfTextExtractionResult } from '../../services/pdf-text-extractor.service';

@Component({
  standalone: true,
  selector: 'main-page',
  templateUrl: './mainPage.component.html',
  styleUrls: ['./mainPage.component.css'],
  imports: [
    UploadDocumentComponent,
    AnnotateDocumentComponent,
    BokComponent,
    CommonModule,
    FormsModule,
    AccordionModule,
    DocumentInformationComponent,
    ButtonModule,
    DividerModule,
    ToastModule,
    InputTextModule,
    ProgressSpinnerModule,
    ProgressBarModule,
    PanelModule,
    SliderModule
  ],
  providers: [MessageService]
})
export class MainPageComponent implements OnInit, OnDestroy {
  concept: string = 'GIST'
  logged: boolean = false;
  pdfDoc: PDFDocument | null = null;
  pdfArrayBuffer: ArrayBuffer | null = null;
  formContent: DocumentForm = new DocumentForm();
  bokRelations: string[] = [];

  loading: boolean = false;

  // BoK matching state
  bokMatchingResult: BokClassificationResult | null = null;
  matcherReady: boolean | null = null;
  bokDataLoaded: boolean = false;
  classificationText: string = '';
  similarityThreshold: number = 0.8;
  topPercentile: number = 95; // Display as percentage (1-100)
  selectedConcepts: Set<string> = new Set();
  processingProgress: { current: number; total: number } | null = null;
  isProcessing: boolean = false;
  
  // PDF extraction state
  extractionProgress: { current: number; total: number } | null = null;
  isExtracting: boolean = false;
  extractedText: PdfTextExtractionResult | null = null;
  private extractionAbortController: AbortController | null = null;

  private loggedSubscrition!: Subscription;
  private processingSubscription!: Subscription;
  private loadingSubscription!: Subscription;

  constructor(
    private storageService: StorageService,
    private messageService: MessageService,
    private router: Router,
    private authService: AuthService,
    private bokMatchingService: BokMatchingService,
    private pdfTextExtractor: PdfTextExtractorService
  ) {}

  ngOnInit() {
    this.loggedSubscrition = this.authService.getUserState().subscribe(state => {
        this.logged = state?.logged || false;
    });

    // Subscribe to processing progress
    this.processingSubscription = this.bokMatchingService.processingProgress$.subscribe(progress => {
      this.processingProgress = progress;
    });

    this.loadingSubscription = this.bokMatchingService.isModelLoading$.subscribe(loading => {
      this.isProcessing = loading;
    });

    // Load BoK embeddings data
    this.loadBokData();
  }

  ngOnDestroy() {
    this.loggedSubscrition.unsubscribe();
    this.processingSubscription?.unsubscribe();
    this.loadingSubscription?.unsubscribe();
  }

  // Load BoK embeddings from JSON file
  private async loadBokData(): Promise<void> {
    try {
      // Load BoK embeddings from assets folder
      const conceptCount = await this.bokMatchingService.loadBokDataFromUrl('assets/bok-embeddings.json');
      this.bokDataLoaded = true;
      this.matcherReady = true;
    } catch (error) {
      console.error('Failed to load BoK data:', error);
      this.bokDataLoaded = false;
      this.matcherReady = false;
      this.messageService.add({
        severity: 'warn',
        summary: 'BoK Data Not Found',
        detail: 'BoK embeddings file not found. AI classification unavailable.',
        life: 5000
      });
    }
  }

  // Classify text against BoK concepts
  async classifyText(): Promise<void> {
    if (!this.classificationText.trim() || !this.bokDataLoaded) return;

    try {
      this.bokMatchingResult = null;
      this.matcherReady = false;

      const result = await this.bokMatchingService.classifySingleText(
        this.classificationText,
        this.similarityThreshold,
        this.topPercentile / 100 // Convert from percentage to decimal
      );

      this.bokMatchingResult = result;
      this.matcherReady = true;

      // Add matched concepts to bokRelations if there are selected IDs
      if (result.selectedIds.length > 0) {
        const newConcepts = result.selectedIds.filter(id => !this.bokRelations.includes(id));
        if (newConcepts.length > 0) {
          this.messageService.add({
            severity: 'info',
            summary: 'Concepts Found',
            detail: `Found ${result.selectedIds.length} matching BoK concepts (${newConcepts.length} new)`,
            life: 3000
          });
        }
      }
    } catch (error) {
      console.error('BoK matching error:', error);
      this.matcherReady = true;
      this.messageService.add({
        severity: 'error',
        summary: 'Classification Error',
        detail: error instanceof Error ? error.message : 'Unknown error occurred',
        life: 5000
      });
    }
  }

  // Classify PDF content against BoK concepts
  async classifyPdfContent(): Promise<void> {
    if (!this.pdfArrayBuffer || !this.bokDataLoaded) {
      this.messageService.add({
        severity: 'warn',
        summary: 'No PDF',
        detail: 'Please upload a PDF file first.',
        life: 3000
      });
      return;
    }

    try {
      this.bokMatchingResult = null;
      this.matcherReady = false;
      this.isExtracting = true;
      this.extractionProgress = { current: 0, total: 0 };
      
      // Create abort controller for this operation
      this.extractionAbortController = new AbortController();

      // Extract text from PDF
      this.messageService.add({
        severity: 'info',
        summary: 'Extracting Text',
        detail: 'Extracting text from PDF...',
        life: 2000
      });

      this.extractedText = await this.pdfTextExtractor.extractTextFromArrayBuffer(
        this.pdfArrayBuffer,
        (current, total) => {
          this.extractionProgress = { current, total };
        },
        this.extractionAbortController.signal
      );

      // Add delay to allow progress bar to visually show 100% before hiding
      await new Promise<void>(resolve => {
        timer(1500).subscribe(() => {
          this.isExtracting = false;
          this.extractionProgress = null;
          this.extractionAbortController = null;
          resolve();
        });
      });

      if (this.extractedText.pages.length === 0 || !this.extractedText.allText.trim()) {
        this.messageService.add({
          severity: 'warn',
          summary: 'No Text Found',
          detail: 'Could not extract any text from the PDF. The PDF might be image-based.',
          life: 5000
        });
        this.matcherReady = true;
        return;
      }

      // Split text into blocks for processing
      const { textBlocks, pageNumbers } = this.pdfTextExtractor.splitIntoBlocks(
        this.extractedText.pages,
        500 // Max block length
      );

      this.messageService.add({
        severity: 'info',
        summary: 'Processing',
        detail: `Processing ${textBlocks.length} text blocks from ${this.extractedText.totalPages} pages...`,
        life: 3000
      });

      // Classify the text blocks
      const result = await this.bokMatchingService.classifyText(
        textBlocks,
        this.similarityThreshold,
        this.topPercentile / 100, // Convert from percentage to decimal
        pageNumbers
      );

      this.bokMatchingResult = result;
      this.matcherReady = true;
      
      // Clear previous selections
      this.selectedConcepts.clear();

      if (result.selectedIds.length > 0) {
        const newConcepts = result.selectedIds.filter(id => !this.bokRelations.includes(id));
        this.messageService.add({
          severity: 'success',
          summary: 'Analysis Complete',
          detail: `Found ${result.selectedIds.length} matching BoK concepts (${newConcepts.length} new) from ${this.extractedText.totalPages} pages`,
          life: 5000
        });
      } else {
        this.messageService.add({
          severity: 'info',
          summary: 'Analysis Complete',
          detail: 'No matching concepts found above the threshold.',
          life: 5000
        });
      }
    } catch (error) {
      console.error('PDF classification error:', error);
      this.isExtracting = false;
      this.extractionProgress = null;
      this.extractionAbortController = null;
      this.matcherReady = true;
      
      // Don't show error message if operation was aborted
      if (error instanceof Error && error.name === 'AbortError') {
        this.messageService.add({
          severity: 'info',
          summary: 'Operation Cancelled',
          detail: 'PDF analysis was cancelled.',
          life: 3000
        });
      } else {
        this.messageService.add({
          severity: 'error',
          summary: 'Classification Error',
          detail: error instanceof Error ? error.message : 'Unknown error occurred',
          life: 5000
        });
      }
    }
  }

  // Get extraction progress percentage
  getExtractionProgressPercentage(): number {
    if (!this.extractionProgress || this.extractionProgress.total === 0) return 0;
    if (this.extractionProgress.current >= this.extractionProgress.total) return 100;
    return Math.round((this.extractionProgress.current / this.extractionProgress.total) * 100);
  }

  // Toggle selection for individual concept
  toggleConceptSelection(conceptId: string): void {
    if (this.selectedConcepts.has(conceptId)) {
      this.selectedConcepts.delete(conceptId);
    } else {
      this.selectedConcepts.add(conceptId);
    }
  }

  // Check if concept is selected
  isConceptSelected(conceptId: string): boolean {
    return this.selectedConcepts.has(conceptId);
  }

  // Toggle all concepts selection
  toggleAllConcepts(): void {
    if (!this.bokMatchingResult?.matches) return;
    
    const allSelected = this.bokMatchingResult.matches.every(match => 
      this.selectedConcepts.has(match.conceptId)
    );
    
    if (allSelected) {
      // Deselect all
      this.bokMatchingResult.matches.forEach(match => 
        this.selectedConcepts.delete(match.conceptId)
      );
    } else {
      // Select all
      this.bokMatchingResult.matches.forEach(match => 
        this.selectedConcepts.add(match.conceptId)
      );
    }
  }

  // Check if all concepts are selected
  areAllConceptsSelected(): boolean {
    if (!this.bokMatchingResult?.matches) return false;
    return this.bokMatchingResult.matches.every(match => 
      this.selectedConcepts.has(match.conceptId)
    );
  }

  // Get count of selected concepts
  getSelectedConceptsCount(): number {
    return this.selectedConcepts.size;
  }

  // Add selected concepts to the annotation list
  addMatchedConcepts(): void {
    const selectedIds = Array.from(this.selectedConcepts);
    if (selectedIds.length > 0) {
      const newConcepts = selectedIds.filter(
        id => !this.bokRelations.includes(id)
      );
      this.bokRelations = [...this.bokRelations, ...newConcepts];
      
      if (newConcepts.length > 0) {
        this.messageService.add({
          severity: 'success',
          summary: 'Concepts Added',
          detail: `Added ${newConcepts.length} concepts to annotations`,
          life: 3000
        });
        
        // Clear selections after adding
        this.selectedConcepts.clear();
      }
    }
  }

  // Get progress percentage for the progress bar
  getProgressPercentage(): number {
    if (!this.processingProgress || this.processingProgress.total === 0) return 0;
    if (this.processingProgress.current >= this.processingProgress.total) return 100;
    return Math.round((this.processingProgress.current / this.processingProgress.total) * 100);
  }

  async onDownload() {
    // check if file is available; if available, download, otherwise, set error message telling no file available to downlaod!
    if (this.pdfDoc) {
      // function returns the configured string in RDF format
      const relationsMetadata = this.configureMetaData(this.bokRelations);
      this.pdfDoc?.setTitle(this.formContent.name + '_annotated');

      // stores the RDF format string holding BoK keys and relations
      this.pdfDoc?.setSubject(relationsMetadata);
      const pdfBytes = await this.pdfDoc.save()

      // set title and download pdf
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.style.display = 'none';
      link.download = this.formContent?.name + '_annotated.pdf';
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    }
  }

  onSave() {
    if (this.pdfDoc && this.checkFormContent()) {
      const relationsMetadata = this.configureMetaData(this.bokRelations);
      this.pdfDoc?.setTitle(this.formContent?.name + '_annotated');
      this.pdfDoc?.setSubject(relationsMetadata);
      let isSuccess = true;
      this.loading = true;
      this.storageService.saveDocument(this.pdfDoc, this.formContent, this.bokRelations).pipe(
        catchError((error) => {
          isSuccess = false;
          this.messageService.add({ 
            severity: 'error', 
            summary: 'Error', 
            detail: error.message ?? 'Something went wrong. Try again later or contact the administrator.', 
            life: 3000, 
            closable: true 
          });
          return of(null);
        }),
        finalize(() => {
          this.loading = false;
          if (isSuccess) {
            this.navigateToMyDocs()
          }
        })
      ).subscribe();
    }
  }

  checkFormContent(): boolean {
    return (this.formContent.name != '' && this.formContent.organization._id != '')
  }

  updateFormContent(data: DocumentForm) {
    this.formContent = data;
  }

  // creates a RDF formatted string for BoK keywords
  configureMetaData(relations: string[]) {
    const bokRelations = relations.map(
      (relation) => 'dc:relation eo4geo:' + relation
    );
    const bokRelationsString = bokRelations.join('; ');
    const rdfPrefix = `@prefix dc: <http://purl.org/dc/terms/> . @prefix eo4geo: <http://bok.eo4geo.eu/> . <> ${bokRelationsString} .`;

    return rdfPrefix;
  }

  navigateToMyDocs() {
    this.router.navigate(['list'])
  }

  onPdfDocChange(newDoc: PDFDocument | null) {
    // Cancel any ongoing operations
    this.cancelOngoingOperations();
    
    this.pdfDoc = newDoc;
    this.extractedText = null;
    this.bokMatchingResult = null;
    
    if (newDoc) {
      // Store the PDF as ArrayBuffer for text extraction
      newDoc.save().then(bytes => {
        this.pdfArrayBuffer = bytes.buffer as ArrayBuffer;
      });
      
      this.messageService.add({ 
        severity: 'info', 
        summary: 'Info', 
        detail: `You uploaded a file without problems.`,
        life: 3000, 
        closable: true 
      }); 
    } else {
      this.pdfArrayBuffer = null;
    }
  }

  private cancelOngoingOperations(): void {
    // Cancel text extraction if in progress
    if (this.isExtracting && this.extractionAbortController) {
      this.extractionAbortController.abort();
      this.extractionAbortController = null;
      this.isExtracting = false;
      this.extractionProgress = null;
    }
    
    // Cancel AI processing if in progress
    if (this.isProcessing) {
      this.bokMatchingService.terminateWorker();
      this.isProcessing = false;
      this.processingProgress = null;
      this.matcherReady = null; // Set to null to show loading state
      this.bokDataLoaded = false; // Reset BoK data loaded state
      
      // Reload BoK data after terminating worker
      this.loadBokData();
    }
  }
}
