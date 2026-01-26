import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, timer } from 'rxjs';

export interface BokMatch {
  conceptId: string;
  conceptName: string;
  similarity: number;
  matchingSentence: string;
  pageNumber?: number;
}

export interface BokClassificationResult {
  allMatchedIds: string[];
  selectedIds: string[];
  matches: BokMatch[];
  percentileThreshold: number | null;
  topPercentile: number;
  totalMatches: number;
  selectedMatches: number;
}

export interface BokProgress {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
  current?: number;
}

export interface BokData {
  embeddings: number[][];
  conceptIds: string[];
  conceptNames: string[];
}

@Injectable({
  providedIn: 'root'
})
export class BokMatchingService implements OnDestroy {
  private worker: Worker | null = null;
  private _isModelLoading = new BehaviorSubject<boolean>(false);
  private _isBokLoaded = new BehaviorSubject<boolean>(false);
  private _loadingProgress = new BehaviorSubject<BokProgress | null>(null);
  private _processingProgress = new BehaviorSubject<{ current: number; total: number } | null>(null);

  public readonly isModelLoading$ = this._isModelLoading.asObservable();
  public readonly isBokLoaded$ = this._isBokLoaded.asObservable();
  public readonly loadingProgress$ = this._loadingProgress.asObservable();
  public readonly processingProgress$ = this._processingProgress.asObservable();

  private bokDataLoaded = false;

  constructor() {}

  /**
   * Initialize the web worker for BoK matching
   */
  private initializeWorker(): void {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/bok-matching.worker', import.meta.url), {
        type: 'module'
      });
    }
  }

  /**
   * Load BoK embeddings data from a JSON file or provided data
   * @param bokData The BoK embeddings data
   */
  loadBokData(bokData: BokData): Promise<number> {
    return new Promise((resolve, reject) => {
      this.initializeWorker();

      if (!this.worker) {
        reject(new Error('Failed to initialize worker'));
        return;
      }

      const messageHandler = (event: MessageEvent) => {
        const { status, data, error } = event.data;

        if (status === 'bok-loaded') {
          this.bokDataLoaded = true;
          this._isBokLoaded.next(true);
          this.worker?.removeEventListener('message', messageHandler);
          resolve(data.conceptCount);
        } else if (status === 'error') {
          this.worker?.removeEventListener('message', messageHandler);
          reject(new Error(error));
        }
      };

      this.worker.addEventListener('message', messageHandler);
      this.worker.postMessage({
        type: 'load-bok',
        data: bokData
      });
    });
  }

  /**
   * Load BoK embeddings from a URL (JSON file)
   * @param url URL to the BoK embeddings JSON file
   */
  async loadBokDataFromUrl(url: string): Promise<number> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load BoK data: ${response.statusText}`);
      }
      const bokData: BokData = await response.json();
      return this.loadBokData(bokData);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Classify text blocks against BoK concepts
   * @param textBlocks Array of text strings to classify
   * @param threshold Similarity threshold (default 0.8)
   * @param topPercentile Top N percentile to select (default 0.95 = top 5%)
   * @param pageNumbers Optional array of page numbers corresponding to text blocks
   * @returns Promise with classification results
   */
  classifyText(
    textBlocks: string[], 
    threshold: number = 0.8, 
    topPercentile: number = 0.95,
    pageNumbers?: number[]
  ): Promise<BokClassificationResult> {
    return new Promise((resolve, reject) => {
      if (!textBlocks || textBlocks.length === 0) {
        reject(new Error('Text blocks cannot be empty'));
        return;
      }

      if (!this.bokDataLoaded) {
        reject(new Error('BoK data not loaded. Please load BoK embeddings first.'));
        return;
      }

      this.initializeWorker();

      if (!this.worker) {
        reject(new Error('Failed to initialize worker'));
        return;
      }

      this._isModelLoading.next(true);
      this._processingProgress.next(null);

      const messageHandler = (event: MessageEvent) => {
        const { status, output, error, data } = event.data;

        switch (status) {
          case 'initiate':
            this._loadingProgress.next({ status: 'Initializing model...' });
            break;

          case 'progress':
            this._loadingProgress.next(data);
            break;

          case 'ready':
            this._loadingProgress.next({ status: 'Model ready, processing...' });
            break;

          case 'processing':
            this._processingProgress.next({ current: data.current, total: data.total });
            break;

          case 'complete':
            this._isModelLoading.next(false);
            this._loadingProgress.next(null);
            // Add delay to allow progress bar to visually show 100% before hiding
            timer(1500).subscribe(() => {
              this._processingProgress.next(null);
            });
            this.worker?.removeEventListener('message', messageHandler);
            resolve(output);
            break;

          case 'error':
            this._isModelLoading.next(false);
            this._loadingProgress.next(null);
            this._processingProgress.next(null);
            this.worker?.removeEventListener('message', messageHandler);
            reject(new Error(error));
            break;
        }
      };

      this.worker.addEventListener('message', messageHandler);

      this.worker.addEventListener('error', (error) => {
        this._isModelLoading.next(false);
        this._loadingProgress.next(null);
        this._processingProgress.next(null);
        reject(new Error(`Worker error: ${error.message}`));
      });

      this.worker.postMessage({
        type: 'classify',
        data: {
          textBlocks,
          threshold,
          topPercentile,
          pageNumbers
        }
      });
    });
  }

  /**
   * Classify a single text string
   * @param text The text to classify
   * @param threshold Similarity threshold (default 0.8)
   * @param topPercentile Top N percentile to select (default 0.95)
   */
  async classifySingleText(
    text: string, 
    threshold: number = 0.8,
    topPercentile: number = 0.95
  ): Promise<BokClassificationResult> {
    return this.classifyText([text], threshold, topPercentile);
  }

  /**
   * Check if BoK data is loaded
   */
  get isBokDataLoaded(): boolean {
    return this.bokDataLoaded;
  }

  /**
   * Terminate the worker
   */
  terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this._isModelLoading.next(false);
      this._loadingProgress.next(null);
      this._processingProgress.next(null);
      this.bokDataLoaded = false;
      this._isBokLoaded.next(false);
    }
  }

  ngOnDestroy(): void {
    this.terminateWorker();
  }
}
