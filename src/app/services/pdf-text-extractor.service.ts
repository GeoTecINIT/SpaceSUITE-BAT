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

    return { textBlocks: textBlocks.map(b => this.joinHyphenated(b)), pageNumbers };
  }

  // Join a word split by a hyphen + whitespace (PDF line-break artifact): "exam- ple" / "exam-\nple" -> "example".
  private joinHyphenated(text: string): string {
    return text.replace(/(\S)-\s+(\S)/g, '$1$2');
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
    let prevEndX: number | null = null;
    let prevY: number | null = null;

    for (const item of items) {
      const str = this.sanitizeText(String(item?.str ?? ''));

      if (str) {
        const t = Array.isArray(item?.transform) ? item.transform : null;
        const x = t ? t[4] : null;
        const y = t ? t[5] : null;
        const fontSize = t ? (Math.hypot(t[2], t[3]) || Math.abs(t[3])) : 0;

        if (text && !text.endsWith('\n') && !text.endsWith(' ')) {
          // Add a space only when items are visually apart, not when a word was split
          // into runs (cairo emits ligatures like "ﬂ" as their own item -> "work fl ow").
          const insertSpace =
            x == null || prevEndX == null || prevY == null
              ? true // no geometry: keep old spacing behaviour
              : Math.abs((y ?? 0) - prevY) > fontSize * 0.5 // different line
                || x - prevEndX > fontSize * 0.2;            // real horizontal gap
          if (insertSpace) text += ' ';
        }

        text += str;
        if (x != null) prevEndX = x + (item?.width ?? 0);
        if (y != null) prevY = y;
      }

      if (item?.hasEOL) {
        text += '\n';
        prevEndX = null;
        prevY = null;
      }
    }

    return text.replace(/\n{3,}/g, '\n\n').trim();
  }
}
