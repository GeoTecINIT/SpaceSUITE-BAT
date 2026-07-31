import { Component, Input, Output, EventEmitter, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray} from '@angular/cdk/drag-drop';
import { map, Observable, Subscription, take } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { PanelModule } from 'primeng/panel';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { CheckboxModule } from 'primeng/checkbox';
import { SliderModule } from 'primeng/slider';
import { MessageModule } from 'primeng/message';

import { PDFDocument } from 'pdf-lib';
import { BokMatchingService, BokClassificationResult, BokMatch, BokRawClassificationResult } from '../../services/bok-matching.service';
import { PdfTextExtractorService } from '../../services/pdf-text-extractor.service';
import { ChipModule } from 'primeng/chip';
import { BokInformationService } from '@eo4geo/ngx-bok-visualization';

type Progress = { current: number; total: number } | null;

@Component({
  standalone: true,
  selector: 'app-ai-bok-matching',
  imports: [CommonModule, FormsModule, ButtonModule, ProgressBarModule, PanelModule, TooltipModule, CheckboxModule, SliderModule, ChipModule, MessageModule, CdkDrag, CdkDropList],
  templateUrl: './ai-bok-matching.component.html',
  styleUrls: ['./ai-bok-matching.component.css']
})
export class AiBokMatchingComponent {
  @Input() pdfDoc: PDFDocument | null = null;
  @Input() pdfArrayBuffer: ArrayBuffer | null = null;
  @Input() bokRelations: string[] = [];

  bokMatchingResult: BokClassificationResult | null = null;
  filteredBokMatchingResult: BokClassificationResult | null = null;
  bokDataLoaded = false;
  // Default similarity slider value; matches below it are hidden.
  similarityThreshold = 0.70;
  selectedConcept: BokMatch | null = null;
  modelLoadProgress: number | null = null;
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
    private readonly messageService: MessageService,
    private readonly bokInfoService: BokInformationService
  ) {}

  // Lifecycle hooks
  ngOnInit(): void {
    this.subscriptions.push(
      this.bokMatchingService.modelLoadProgress$.subscribe(p => this.modelLoadProgress = p),
      this.bokMatchingService.processingProgress$.subscribe(p => this.processingProgress = p),
      this.bokMatchingService.isModelLoading$.subscribe(l => this.isProcessing = l)
    );
    this.loadBokData();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  ngOnChanges({ pdfArrayBuffer, bokRelations}: SimpleChanges): void {
    if (pdfArrayBuffer) {
      this.bokMatchingResult = null;
      this.rawMatchData = null;
      this.selectedConcept = null;
      if (pdfArrayBuffer.currentValue) this.classifyPdfContent();
    }
    if (bokRelations && bokRelations.currentValue) {
      if (this.rawMatchData) this.applyFilters();
    }
  }

  // Getters
  get isExtracting(): boolean { return this.extractionProgress !== null; }

  // Public methods
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
      this.selectedConcept = null;

      const msg = result.selectedIds.length
        ? `${result.selectedIds.length} AI suggested concepts available.`
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

  selectAIMatch(newSelection: BokMatch) {
    if(!this.isBokRelationDisabled(newSelection.conceptId)) {
      this.selectedConcept = newSelection;
    } else {
      this.selectedConcept = null;
    }
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
    
    const notAnnotatedMatches = allMatches.filter(m => !this.bokRelations.includes(m.conceptId));
    const thresholdFiltered = notAnnotatedMatches.filter(m => m.similarity >= threshold);
    
    const selectedMatches: BokMatch[] = thresholdFiltered.length
      ? [...thresholdFiltered].sort((a, b) => b.similarity - a.similarity)
      : [];

    this.bokMatchingResult = {
      selectedIds: selectedMatches.map(m => m.conceptId),
      matches: selectedMatches,
      totalMatches: thresholdFiltered.length
    };

    if (!selectedMatches.find(value => value.conceptId === this.selectedConcept?.conceptId))
      this.selectedConcept = null;
  }

  private showMessage(severity: string, summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: 3000 });
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getBackgroundColor(concept: string): Observable<string> {
    return this.bokInfoService.getConceptColor(concept).pipe(
      take(1),
      map((hex) => this.hexToRgba(hex, 0.5))
    );
  }

  private hexToRgba(hex: string, alpha: number): string {
    // Remove the hash if it exists
    hex = hex.replace(/^#/, '');

    // Parse r, g, b values
    let r: number, g: number, b: number;
    if (hex.length === 3) {
      // Convert shorthand hex (e.g., #abc to #aabbcc)
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  isBokRelationDisabled(conceptId: any): boolean {
    return this.bokRelations.includes(conceptId);
  }
}
