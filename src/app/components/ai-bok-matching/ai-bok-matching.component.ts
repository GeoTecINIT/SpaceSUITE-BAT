import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { PanelModule } from 'primeng/panel';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { PDFDocument } from 'pdf-lib';
import { BokMatchingService, BokClassificationResult } from '../../services/bok-matching.service';
import { PdfTextExtractorService } from '../../services/pdf-text-extractor.service';

type Progress = { current: number; total: number } | null;

@Component({
  selector: 'app-ai-bok-matching',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, ProgressBarModule, PanelModule, TooltipModule],
  templateUrl: './ai-bok-matching.component.html',
  styleUrls: ['./ai-bok-matching.component.css']
})
export class AiBokMatchingComponent implements OnInit, OnDestroy {
  @Input() pdfDoc: PDFDocument | null = null;
  @Input() pdfArrayBuffer: ArrayBuffer | null = null;
  @Input() bokRelations: string[] = [];
  @Output() bokRelationsChange = new EventEmitter<string[]>();

  bokMatchingResult: BokClassificationResult | null = null;
  bokDataLoaded = false;
  similarityThreshold = 0.8;
  topPercentile = 95;
  selectedConcepts = new Set<string>();
  processingProgress: Progress = null;
  isProcessing = false;
  extractionProgress: Progress = null;

  private subscriptions: Subscription[] = [];

  constructor(
    private bokMatchingService: BokMatchingService,
    private pdfTextExtractor: PdfTextExtractorService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.bokMatchingService.processingProgress$.subscribe(p => this.processingProgress = p),
      this.bokMatchingService.isModelLoading$.subscribe(l => this.isProcessing = l)
    );
    this.loadBokData();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  private async loadBokData(): Promise<void> {
    try {
      await this.bokMatchingService.loadBokDataFromUrl('assets/bok-embeddings.json');
      this.bokDataLoaded = true;
    } catch (error) {
      console.error('Failed to load BoK data:', error);
      this.showMessage('warn', 'BoK Data Not Found', 'BoK embeddings file not found. AI classification unavailable.');
    }
  }

  async classifyPdfContent(): Promise<void> {
    if (!this.pdfArrayBuffer || !this.bokDataLoaded) {
      return this.showMessage('warn', 'No PDF', 'Please upload a PDF file first.');
    }

    try {
      this.bokMatchingResult = null;
      this.extractionProgress = { current: 0, total: 0 };
      this.showMessage('info', 'Extracting Text', 'Extracting text from PDF...');

      const extracted = await this.pdfTextExtractor.extractTextFromArrayBuffer(
        this.pdfArrayBuffer,
        (current, total) => this.extractionProgress = { current, total }
      );
      // Ensure progress bar shows 100% before hiding
      await this.delay(1500);
      this.extractionProgress = null;

      if (!extracted.pages.length || !extracted.allText.trim()) {
        return this.showMessage('warn', 'No Text Found', 'Could not extract text. The PDF might be image-based.');
      }

      const { textBlocks, pageNumbers } = this.pdfTextExtractor.splitIntoBlocks(extracted.pages, 200);
      this.showMessage('info', 'Processing', `Processing ${textBlocks.length} blocks from ${extracted.totalPages} pages...`);

      this.bokMatchingResult = await this.bokMatchingService.classifyText(
        textBlocks, this.similarityThreshold, this.topPercentile / 100, pageNumbers
      );
      // Ensure processing progress bar shows 100% before hiding
      await this.delay(1500);
      this.processingProgress = null;
      
      this.selectedConcepts.clear();

      const { selectedIds } = this.bokMatchingResult;
      const msg = selectedIds.length
        ? `Found ${selectedIds.length} concepts (${selectedIds.filter(id => !this.bokRelations.includes(id)).length} new)`
        : 'No matching concepts found above threshold.';
      this.showMessage(selectedIds.length ? 'success' : 'info', 'Analysis Complete', msg);
    } catch (error) {
      console.error('PDF classification error:', error);
      this.extractionProgress = null;
      this.showMessage('error', 'Error', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  get isExtracting(): boolean { return this.extractionProgress !== null; }
  get selectedCount(): number { return this.selectedConcepts.size; }
  get allSelected(): boolean {
    return !!this.bokMatchingResult?.matches?.every(m => this.selectedConcepts.has(m.conceptId));
  }

  calcPercent = (p: Progress) => !p || !p.total ? 0 : Math.min(100, Math.round((p.current / p.total) * 100));

  toggleConceptSelection(id: string): void {
    this.selectedConcepts.has(id) ? this.selectedConcepts.delete(id) : this.selectedConcepts.add(id);
  }

  toggleAllConcepts(): void {
    const matches = this.bokMatchingResult?.matches;
    if (!matches) return;
    matches.forEach(m => this.selectedConcepts[this.allSelected ? 'delete' : 'add'](m.conceptId));
  }

  addMatchedConcepts(): void {
    const newConcepts = [...this.selectedConcepts].filter(id => !this.bokRelations.includes(id));
    if (!newConcepts.length) return;
    this.bokRelationsChange.emit([...this.bokRelations, ...newConcepts]);
    this.showMessage('success', 'Concepts Added', `Added ${newConcepts.length} concepts`);
    this.selectedConcepts.clear();
  }

  private showMessage(severity: string, summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: 5000 });
  }
  
  private delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
}
