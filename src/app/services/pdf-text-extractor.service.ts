import { Injectable } from '@angular/core';

import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Types
export interface PageText {
  pageNumber: number;
  text: string;
}

export interface PdfTextExtractionResult {
  pages: PageText[];
  totalPages: number;
  allText: string;
}

@Injectable({ providedIn: 'root' })
export class PdfTextExtractorService {

  // Public methods
  async extractTextFromArrayBuffer(
    pdfData: ArrayBuffer,
    onProgress?: (current: number, total: number) => void,
    abortSignal?: AbortSignal
  ): Promise<PdfTextExtractionResult> {
    const dataForPdfJs = pdfData.slice(0);
    const pdf = await pdfjsLib.getDocument({ data: dataForPdfJs }).promise;
    const totalPages = pdf.numPages;
    const pages: PageText[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (abortSignal?.aborted) throw new DOMException('Operation was aborted', 'AbortError');

      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      pages.push({
        pageNumber: pageNum,
        text: this.buildPageText(textContent)
      });

      onProgress?.(pageNum, totalPages);
    }

    const filteredPages = this.filterReferences(pages);
    return { pages: filteredPages, totalPages, allText: filteredPages.map(p => p.text).join('\n\n') };
  }

  async extractTextFromFile(
    file: File,
    onProgress?: (current: number, total: number) => void
  ): Promise<PdfTextExtractionResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          resolve(await this.extractTextFromArrayBuffer(reader.result as ArrayBuffer, onProgress));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read PDF file'));
      reader.readAsArrayBuffer(file);
    });
  }

  async extractTextFromUrl(
    url: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<PdfTextExtractionResult> {
    const pdf = await pdfjsLib.getDocument(url).promise;
    const totalPages = pdf.numPages;
    const pages: PageText[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      pages.push({
        pageNumber: pageNum,
        text: this.buildPageText(textContent)
      });

      onProgress?.(pageNum, totalPages);
    }

    const filteredPages = this.filterReferences(pages);
    return { pages: filteredPages, totalPages, allText: filteredPages.map(p => p.text).join('\n\n') };
  }

  splitIntoBlocks(pages: PageText[], maxBlockLength = 150): { textBlocks: string[]; pageNumbers: number[] } {
    const textBlocks: string[] = [];
    const pageNumbers: number[] = [];

    for (const page of pages) {
      if (!page.text?.trim()) continue;

      const paragraphs = page.text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

      for (const paragraph of paragraphs) {
        const artScore = this.asciiArtScore(paragraph);
        if (artScore > 0.55) continue; // Maybe this is too high, but i want to save as much text as possible.
                                      //  If the resulting text is to short, it will be filtered by the worker anyway (Currently set at 10 chars)
        const processed = artScore > 0.05 ? this.cleanAsciiArt(paragraph) : paragraph;
        if (!processed) continue;

        if (processed.length <= maxBlockLength) {
          textBlocks.push(processed);
          pageNumbers.push(page.pageNumber);
          continue;
        }

        const sentences = processed.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
        const sentenceList = sentences.length ? sentences : [processed];

        let currentBlock = '';
        for (const sentence of sentenceList) {
          if (!currentBlock && sentence.length > maxBlockLength) {
            textBlocks.push(sentence);
            pageNumbers.push(page.pageNumber);
            continue;
          }

          if (!currentBlock) {
            currentBlock = sentence;
            continue;
          }

          if (currentBlock.length + sentence.length + 1 <= maxBlockLength) {
            currentBlock += ' ' + sentence;
          } else {
            textBlocks.push(currentBlock);
            pageNumbers.push(page.pageNumber);
            if (sentence.length > maxBlockLength) {
              textBlocks.push(sentence);
              pageNumbers.push(page.pageNumber);
              currentBlock = '';
            } else {
              currentBlock = sentence;
            }
          }
        }

        if (currentBlock) {
          textBlocks.push(currentBlock);
          pageNumbers.push(page.pageNumber);
        }
      }
    }

    return { textBlocks, pageNumbers };
  }

  private filterReferences(pages: PageText[]): PageText[] {
    const headingRegex = /^\s*(references?|bibliography|works\s+cited|literature\s+cited|referencias|bibliograf[ií]a)\s*:?\s*$/im;
    const minIdx = Math.floor(pages.length / 2);
    for (let i = pages.length - 1; i >= minIdx; i--) {
      if (headingRegex.test(pages[i].text)) {
        return pages.slice(0, i);
      }
    }
    return pages;
  }

  private asciiArtScore(text: string): number {
    if (!text) return 0;
    const nonAlphaCount = (text.match(/[^a-zA-Z0-9\s]/g) ?? []).length;
    const nonAlphaRatio = nonAlphaCount / text.length;
    const hasLongRunOfSymbols = /[-=_|+*~#]{6,}/.test(text); // We want to clean this if nonAlphaRatio is not too high
    return hasLongRunOfSymbols ? Math.max(nonAlphaRatio, 0.10) : nonAlphaRatio;
  }

  private cleanAsciiArt(text: string): string {
    return text
      .replace(/[|_=+*~#<>{}\[\]\\\/^@&`]/g, ' ')
      .replace(/-{3,}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sanitizeText(text: string): string {
    return text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // remove diacritics only
      .replace(/\(cid:\d+\)/gi, ' ')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
      .replace(/[\u00AD\u200B-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/g, '')
      .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2013\u2014\u2015]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildPageText(textContent: any): string {
    const items = textContent?.items ?? [];
    let text = '';

    for (const item of items) {
      const str = this.sanitizeText(String(item?.str ?? ''));
      if (str) {
        if (text && !text.endsWith('\n') && !text.endsWith(' ')) text += ' ';
        text += str;
      }
      if (item?.hasEOL) {
        text += '\n';
      }
    }

    return text.replace(/\n{3,}/g, '\n\n').trim();
  }
}
