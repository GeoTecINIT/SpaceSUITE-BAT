import { Component, Input, Output, EventEmitter, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { PanelModule } from 'primeng/panel';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { CheckboxModule } from 'primeng/checkbox';
import { SliderModule } from 'primeng/slider';

import { PDFDocument } from 'pdf-lib';
import { BokMatchingService, BokClassificationResult, BokMatch, BokRawClassificationResult } from '../../services/bok-matching.service';
import { PdfTextExtractorService } from '../../services/pdf-text-extractor.service';

type Progress = { current: number; total: number } | null;

@Component({
  standalone: true,
  selector: 'app-ai-bok-matching',
  imports: [CommonModule, FormsModule, ButtonModule, ProgressBarModule, PanelModule, TooltipModule, CheckboxModule, SliderModule],
  templateUrl: './ai-bok-matching.component.html',
  styleUrls: ['./ai-bok-matching.component.css']
})
export class AiBokMatchingComponent {
  @Input() pdfDoc: PDFDocument | null = null;
  @Input() pdfArrayBuffer: ArrayBuffer | null = null;
  @Input() bokRelations: string[] = [];
  @Output() bokRelationsChange = new EventEmitter<string[]>();

  bokMatchingResult: BokClassificationResult | null = null;
  bokDataLoaded = false;
  // Default similarity slider value; matches below it are hidden.
  similarityThreshold = 0.70;
  selectedConcepts = new Set<string>();
  processingProgress: Progress = null;
  extractionProgress: Progress = null;
  isProcessing = false;
  isAnalyzing = false;

  private rawMatchData: BokRawClassificationResult | null = null;
  private analysisId = 0;
  private extractionAbortController: AbortController | null = null;
  private isLoadingBokData = false;
  private subscriptions: Subscription[] = [];

  constructor(
    private readonly bokMatchingService: BokMatchingService,
    private readonly pdfTextExtractor: PdfTextExtractorService,
    private readonly messageService: MessageService
  ) {}

  // Lifecycle hooks
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

  ngOnChanges({ pdfArrayBuffer }: SimpleChanges): void {
    if (pdfArrayBuffer && !pdfArrayBuffer.firstChange) {
      this.bokMatchingResult = null;
      this.rawMatchData = null;
      this.selectedConcepts.clear();
    }
  }

  // Getters
  get isExtracting(): boolean { return this.extractionProgress !== null; }
  get selectedCount(): number { return this.selectedConcepts.size; }
  get allSelected(): boolean {
    const matches = this.bokMatchingResult?.matches;
    return !!matches?.length && matches.every(m => this.selectedConcepts.has(m.conceptId));
  }

  // Public methods
  cancelAnalysis(): void {
    this.analysisId++;
    this.extractionAbortController?.abort();
    this.extractionAbortController = null;
    this.bokMatchingService.cancelProcessing();
    this.extractionProgress = null;
    this.processingProgress = null;
    this.isProcessing = false;
    this.isAnalyzing = false;
    this.rawMatchData = null;
    this.showMessage('error', 'Cancelled', 'PDF analysis was cancelled.');
  }

  async classifyPdfContent(): Promise<void> {
    if (!this.pdfArrayBuffer || !this.bokDataLoaded) {
      return this.showMessage('error', 'No PDF', 'Please upload a PDF file first.');
    }

    try {
      const currentAnalysisId = ++this.analysisId;
      const isStale = () => currentAnalysisId !== this.analysisId;
      
      this.isAnalyzing = true;
      this.extractionAbortController = new AbortController();
      this.bokMatchingResult = null;
      this.extractionProgress = { current: 0, total: 0 };

      const extracted = await this.pdfTextExtractor.extractTextFromArrayBuffer(
        this.pdfArrayBuffer,
        (current, total) => { if (!isStale()) this.extractionProgress = { current, total }; },
        this.extractionAbortController.signal
      );
      this.extractionAbortController = null;

      if (isStale()) return;
      await this.delay(1500);
      this.extractionProgress = null;
      if (isStale()) return;

      this.showMessage('info', 'Info', 'Text extracted from PDF successfully.');

      if (!extracted.pages.length || !extracted.allText.trim()) {
        this.isAnalyzing = false;
        return this.showMessage('error', 'No Text Found', 'Could not extract text. The PDF might be image-based.');
      }

      const { textBlocks, pageNumbers } = this.pdfTextExtractor.splitIntoBlocks(extracted.pages, 150);
      if (isStale()) return;

      this.rawMatchData = await this.bokMatchingService.classifyText(textBlocks, pageNumbers);
      if (isStale()) return;
      
      this.applyFilters();
      await this.delay(1500);

      if (isStale()) return;
      this.isAnalyzing = false;
      if (!this.bokMatchingResult) return;
      
      const result: BokClassificationResult = this.bokMatchingResult;
      this.selectedConcepts.clear();

      const newCount = result.selectedIds.filter(id => !this.bokRelations.includes(id)).length;
      const msg = result.selectedIds.length
        ? `Found ${result.selectedIds.length} concepts (${newCount} new)`
        : 'No matching concepts found above threshold.';
      this.showMessage('info', 'Info', msg);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.extractionProgress = null;
      this.isAnalyzing = false;
      this.showMessage('error', 'Error', 'An error occurred during analysis.');
    }
  }

  calcPercent(p: Progress): number {
    if (!p?.total) return 0;
    const percent = (p.current / p.total) * 100;
    return percent >= 100 ? 100 : Math.floor(percent / 5) * 5;
  }

  onFilterChange(): void {
    if (this.rawMatchData) this.applyFilters();
  }

  toggleConceptSelection(id: string): void {
    this.selectedConcepts.has(id) ? this.selectedConcepts.delete(id) : this.selectedConcepts.add(id);
  }

  toggleAllConcepts(): void {
    const matches = this.bokMatchingResult?.matches;
    if (!matches?.length) return;
    const action = this.allSelected ? 'delete' : 'add';
    matches.forEach(m => this.selectedConcepts[action](m.conceptId));
  }

  addMatchedConcepts(): void {
    const newConcepts = [...this.selectedConcepts].filter(id => !this.bokRelations.includes(id));
    if (!newConcepts.length) return;
    this.bokRelationsChange.emit([...this.bokRelations, ...newConcepts]);
    this.selectedConcepts.clear();
  }

  // Private methods
  private async loadBokData(): Promise<void> {
    if (this.isLoadingBokData) return;
    this.isLoadingBokData = true;
    try {
      await this.bokMatchingService.loadBokDataFromUrl('assets/bok-embeddings.json');
      this.bokDataLoaded = true;
    } catch {
      this.showMessage('error', 'BoK Data Not Found', 'BoK embeddings file not found. AI classification unavailable.');
    } finally {
      this.isLoadingBokData = false;
    }
  }

  private applyFilters(): void {
    if (!this.rawMatchData) return;

    const { allMatches } = this.rawMatchData;
    const threshold = this.similarityThreshold;
    
    const thresholdFiltered = allMatches.filter(m => m.similarity >= threshold);
    
    const selectedMatches: BokMatch[] = thresholdFiltered.length
      ? [...thresholdFiltered].sort((a, b) => b.similarity - a.similarity)
      : [];

    this.bokMatchingResult = {
      selectedIds: selectedMatches.map(m => m.conceptId),
      matches: selectedMatches,
      totalMatches: thresholdFiltered.length
    };
  }

  private showMessage(severity: string, summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: 3000 });
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
