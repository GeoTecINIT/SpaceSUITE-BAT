import { Injectable, OnDestroy } from '@angular/core';

import { BehaviorSubject } from 'rxjs';

// Types
export interface BokMatch {
  conceptId: string;
  conceptName: string;
  similarity: number;
  matchingSentence: string;
  pageNumber?: number;
}

export interface BokRawClassificationResult {
  allMatches: BokMatch[];
}

export interface BokClassificationResult {
  selectedIds: string[];
  matches: BokMatch[];
  totalMatches: number;
}

export interface BokData {
  embeddings: number[][];
  conceptIds: string[];
  conceptNames: string[];
}

@Injectable({ providedIn: 'root' })
export class BokMatchingService implements OnDestroy {
  private readonly _isModelLoading = new BehaviorSubject<boolean>(false);
  private readonly _processingProgress = new BehaviorSubject<{ current: number; total: number } | null>(null);
  private worker: Worker | null = null;
  private bokDataLoaded = false;
  private cachedBokData: BokData | null = null;

  readonly isModelLoading$ = this._isModelLoading.asObservable();
  readonly processingProgress$ = this._processingProgress.asObservable();

  // Lifecycle
  ngOnDestroy(): void {
    this.terminateWorker();
  }

  // Public methods
  loadBokData(bokData: BokData): Promise<number> {
    return new Promise((resolve, reject) => {
      this.initializeWorker();
      if (!this.worker) return reject(new Error('Failed to initialize worker'));

      const handler = (event: MessageEvent) => {
        const { status, data, error } = event.data;
        if (status === 'bok-loaded') {
          this.bokDataLoaded = true;
          this.cachedBokData = bokData;
          this.worker?.removeEventListener('message', handler);
          resolve(data.conceptCount);
        } else if (status === 'error') {
          this.worker?.removeEventListener('message', handler);
          reject(new Error(error));
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ type: 'load-bok', data: bokData });
    });
  }

  async loadBokDataFromUrl(url: string): Promise<number> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load BoK data: ${response.statusText}`);
    return this.loadBokData(await response.json());
  }

  async classifyText(textBlocks: string[], pageNumbers?: number[]): Promise<BokRawClassificationResult> {
    if (!textBlocks?.length) throw new Error('Text blocks cannot be empty');
    if (!this.bokDataLoaded && !this.cachedBokData) throw new Error('BoK data not loaded');

    await this.ensureWorkerReady();

    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('Failed to initialize worker'));

      this._isModelLoading.next(true);
      this._processingProgress.next(null);

      const handler = (event: MessageEvent) => {
        const { status, output, error, data } = event.data;

        if (status === 'processing') {
          this._processingProgress.next({ current: data.current, total: data.total });
        } else if (status === 'complete') {
          this._isModelLoading.next(false);
          setTimeout(() => this._processingProgress.next(null), 1500);
          this.worker?.removeEventListener('message', handler);
          resolve(output);
        } else if (status === 'error') {
          this.worker?.removeEventListener('message', handler);
          this.terminateWorker();
          reject(new Error(error));
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.onerror = (e) => {
        this.terminateWorker();
        reject(new Error(`Worker error: ${e.message}`));
      };
      this.worker.postMessage({ type: 'classify', data: { textBlocks, pageNumbers } });
    });
  }

  private async ensureWorkerReady(): Promise<void> {
    if (this.bokDataLoaded && this.worker) return;
    if (!this.cachedBokData) {
      throw new Error('BoK data not loaded — call loadBokData first');
    }
    await this.loadBokData(this.cachedBokData);
  }

  cancelProcessing(): void {
    this.worker?.terminate();
    this.worker = null;
    this.bokDataLoaded = false;
    this.resetState();
  }

  terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.bokDataLoaded = false;
    this.resetState();
  }

  // Private methods
  private initializeWorker(): void {
    this.worker ??= new Worker(new URL('../workers/bok-matching.worker', import.meta.url), { type: 'module' });
  }

  private resetState(): void {
    this._isModelLoading.next(false);
    this._processingProgress.next(null);
  }
}
