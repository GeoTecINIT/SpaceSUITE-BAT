import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { PanelModule } from 'primeng/panel';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { PDFDocument } from 'pdf-lib';
import { BokMatchingService, BokClassificationResult, BokMatch, BokRawClassificationResult } from '../../services/bok-matching.service';
import { PdfTextExtractorService } from '../../services/pdf-text-extractor.service';

type Progress = { current: number; total: number } | null;

@Component({
  selector: 'app-ai-bok-matching',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, ProgressBarModule, PanelModule, TooltipModule],
  templateUrl: './ai-bok-matching.component.html',
  styleUrls: ['./ai-bok-matching.component.css']
})
export class AiBokMatchingComponent implements OnInit, OnDestroy, OnChanges {
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
  // Flag to track if analysis is in progress (covers entire process)
  isAnalyzing = false;

  // Store raw match data for dynamic filtering
  private rawMatchData: BokRawClassificationResult | null = null;
  // Flag to track if analysis was cancelled
  private isCancelled = false;
  // AbortController for PDF extraction cancellation
  private extractionAbortController: AbortController | null = null;

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

  ngOnChanges(changes: SimpleChanges): void {
    // Reset results when a new PDF is uploaded
    if (changes['pdfArrayBuffer'] && !changes['pdfArrayBuffer'].firstChange) {
      this.bokMatchingResult = null;
      this.rawMatchData = null;
      this.selectedConcepts.clear();
    }
  }

  private async loadBokData(): Promise<void> {
    try {
      await this.bokMatchingService.loadBokDataFromUrl('assets/bok-embeddings.json');
      this.bokDataLoaded = true;
    } catch (error) {
      console.error('Failed to load BoK data:', error);
      this.showMessage('error', 'BoK Data Not Found', 'BoK embeddings file not found. AI classification unavailable.');
    }
  }

  cancelAnalysis(): void {
    this.isCancelled = true;
    // Abort PDF extraction if in progress
    this.extractionAbortController?.abort();
    this.extractionAbortController = null;
    this.bokMatchingService.cancelProcessing();
    this.extractionProgress = null;
    this.processingProgress = null;
    this.isProcessing = false;
    this.isAnalyzing = false;
    this.bokDataLoaded = false;
    this.showMessage('error', 'Cancelled', 'PDF analysis was cancelled.');
    // Reload BoK data for next analysis
    this.loadBokData();
  }

  async classifyPdfContent(): Promise<void> {
    if (!this.pdfArrayBuffer || !this.bokDataLoaded) {
      return this.showMessage('error', 'No PDF', 'Please upload a PDF file first.');
    }

    try {
      // Reset cancellation flag at start of new analysis
      this.isCancelled = false;
      this.isAnalyzing = true;
      // Create new AbortController for this extraction
      this.extractionAbortController = new AbortController();
      this.bokMatchingResult = null;
      this.extractionProgress = { current: 0, total: 0 };

      const extracted = await this.pdfTextExtractor.extractTextFromArrayBuffer(
        this.pdfArrayBuffer,
        (current, total) => {
          // Don't update progress if cancelled
          if (!this.isCancelled) {
            this.extractionProgress = { current, total };
          }
        },
        this.extractionAbortController.signal
      );
      this.extractionAbortController = null;
      
      // Check if cancelled immediately after extraction
      if (this.isCancelled) {
        return;
      }
      
      // Ensure progress bar shows 100% before hiding
      await this.delay(1500);
      this.extractionProgress = null;

      // Check again if cancelled during delay
      if (this.isCancelled) {
        return;
      }

      this.showMessage('info', 'Info', 'Text extracted from PDF successfully.');

      if (!extracted.pages.length || !extracted.allText.trim()) {
        this.isAnalyzing = false;
        return this.showMessage('error', 'No Text Found', 'Could not extract text. The PDF might be image-based.');
      }

      const { textBlocks, pageNumbers } = this.pdfTextExtractor.splitIntoBlocks(extracted.pages, 200);
      
      // Check if cancelled before starting AI processing
      if (this.isCancelled) {
        return;
      }

      // Get raw match data from worker
      this.rawMatchData = await this.bokMatchingService.classifyText(textBlocks, pageNumbers);
      
      // Check if cancelled during AI processing
      if (this.isCancelled) {
        return;
      }
      
      // Apply current filter settings
      this.applyFilters();
      
      // Ensure processing progress bar shows 100% before hiding
      await this.delay(1500);
      this.processingProgress = null;
      
      this.selectedConcepts.clear();

      const { selectedIds } = this.bokMatchingResult!;
      const msg = selectedIds.length
        ? `Found ${selectedIds.length} concepts (${selectedIds.filter(id => !this.bokRelations.includes(id)).length} new)`
        : 'No matching concepts found above threshold.';
      this.showMessage('info', 'Info', msg);
      this.isAnalyzing = false;
    } catch (error) {
      // Don't show error if cancelled (AbortError)
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('PDF classification error:', error);
      this.extractionProgress = null;
      this.isAnalyzing = false;
      this.showMessage('error', 'Error', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  get isExtracting(): boolean { return this.extractionProgress !== null; }
  get selectedCount(): number { return this.selectedConcepts.size; }
  get allSelected(): boolean {
    return !!this.bokMatchingResult?.matches?.every(m => this.selectedConcepts.has(m.conceptId));
  }

  calcPercent = (p: Progress) => !p || !p.total ? 0 : Math.min(100, Math.round((p.current / p.total) * 100));

  // Called when similarity threshold or top percentile sliders change
  onFilterChange(): void {
    if (this.rawMatchData) {
      this.applyFilters();
    }
  }

  // Apply current filter settings to raw match data
  private applyFilters(): void {
    if (!this.rawMatchData) return;

    const { allMatches, allSimilarities } = this.rawMatchData;
    
    // Filter by similarity threshold
    const thresholdFilteredMatches = allMatches.filter(m => m.similarity >= this.similarityThreshold);
    const thresholdFilteredSimilarities = allSimilarities.filter(s => s >= this.similarityThreshold);
    
    // Calculate percentile threshold from filtered similarities
    let selectedMatches: BokMatch[] = [];
    let percentileThreshold: number | null = null;
    
    if (thresholdFilteredSimilarities.length > 0 && thresholdFilteredMatches.length > 0) {
      percentileThreshold = this.quantile(thresholdFilteredSimilarities, this.topPercentile / 100);
      selectedMatches = thresholdFilteredMatches.filter(m => m.similarity >= percentileThreshold!);
      // Sort by similarity descending
      selectedMatches.sort((a, b) => b.similarity - a.similarity);
    }

    this.bokMatchingResult = {
      allMatchedIds: thresholdFilteredMatches.map(m => m.conceptId),
      selectedIds: selectedMatches.map(m => m.conceptId),
      matches: selectedMatches,
      percentileThreshold,
      topPercentile: this.topPercentile / 100,
      totalMatches: thresholdFilteredMatches.length,
      selectedMatches: selectedMatches.length
    };
  }

  // Calculate quantile (same as in worker)
  private quantile(arr: number[], q: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  }

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
    this.selectedConcepts.clear();
  }

  private showMessage(severity: string, summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: 3000 });
  }
  
  private delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
}
