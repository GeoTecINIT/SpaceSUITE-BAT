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

    return { pages, totalPages, allText: pages.map(p => p.text).join('\n\n') };
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

    return { pages, totalPages, allText: pages.map(p => p.text).join('\n\n') };
  }

  splitIntoBlocks(pages: PageText[], maxBlockLength = 150): { textBlocks: string[]; pageNumbers: number[] } {
    const textBlocks: string[] = [];
    const pageNumbers: number[] = [];

    for (const page of pages) {
      if (!page.text?.trim()) continue;

      const paragraphs = page.text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

      for (const paragraph of paragraphs) {
        if (paragraph.length <= maxBlockLength) {
          textBlocks.push(paragraph);
          pageNumbers.push(page.pageNumber);
          continue;
        }

        const sentences = paragraph.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
        const sentenceList = sentences.length ? sentences : [paragraph];

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

  private buildPageText(textContent: any): string {
    const items = textContent?.items ?? [];
    let text = '';

    for (const item of items) {
      const str = String(item?.str ?? '').replace(/\s+/g, ' ').trim();
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
