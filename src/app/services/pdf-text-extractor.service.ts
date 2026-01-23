import { Injectable } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// Set the worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface PdfTextExtractionResult {
  pages: PageText[];
  totalPages: number;
  allText: string;
}

@Injectable({
  providedIn: 'root'
})
export class PdfTextExtractorService {

  constructor() {}

  /**
   * Extract text from a PDF file provided as ArrayBuffer
   * @param pdfData ArrayBuffer containing the PDF data
   * @param onProgress Optional callback for progress updates
   * @returns Promise with extracted text by page
   */
  async extractTextFromArrayBuffer(
    pdfData: ArrayBuffer,
    onProgress?: (current: number, total: number) => void
  ): Promise<PdfTextExtractionResult> {
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const totalPages = pdf.numPages;
    const pages: PageText[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Extract text items and join them
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      pages.push({
        pageNumber: pageNum,
        text: pageText
      });

      if (onProgress) {
        onProgress(pageNum, totalPages);
      }
    }

    const allText = pages.map(p => p.text).join('\n\n');

    return {
      pages,
      totalPages,
      allText
    };
  }

  /**
   * Extract text from a PDF file
   * @param file File object containing the PDF
   * @param onProgress Optional callback for progress updates
   * @returns Promise with extracted text by page
   */
  async extractTextFromFile(
    file: File,
    onProgress?: (current: number, total: number) => void
  ): Promise<PdfTextExtractionResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result as ArrayBuffer;
          const result = await this.extractTextFromArrayBuffer(arrayBuffer, onProgress);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read PDF file'));
      };

      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Extract text from a PDF URL
   * @param url URL of the PDF file
   * @param onProgress Optional callback for progress updates
   * @returns Promise with extracted text by page
   */
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
      
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      pages.push({
        pageNumber: pageNum,
        text: pageText
      });

      if (onProgress) {
        onProgress(pageNum, totalPages);
      }
    }

    const allText = pages.map(p => p.text).join('\n\n');

    return {
      pages,
      totalPages,
      allText
    };
  }

  /**
   * Split text into meaningful blocks for processing
   * Uses larger blocks (1500 chars) for more efficient processing with fewer API calls
   * @param pages Array of page texts
   * @param maxBlockLength Maximum length of each text block (default: 1500)
   * @returns Array of text blocks with their page numbers
   */
  splitIntoBlocks(
    pages: PageText[],
    maxBlockLength: number = 1500
  ): { textBlocks: string[]; pageNumbers: number[] } {
    const textBlocks: string[] = [];
    const pageNumbers: number[] = [];

    for (const page of pages) {
      if (!page.text || page.text.trim().length === 0) continue;

      // Split page text into paragraphs first, then sentences
      const paragraphs = page.text.split(/\n\n+/);
      let currentBlock = '';

      for (const paragraph of paragraphs) {
        // If the paragraph itself is too long, split by sentences
        if (paragraph.length > maxBlockLength) {
          // First, add any accumulated block
          if (currentBlock.trim().length > 0) {
            textBlocks.push(currentBlock.trim());
            pageNumbers.push(page.pageNumber);
            currentBlock = '';
          }

          // Split long paragraph by sentences
          const sentences = paragraph.split(/(?<=[.!?])\s+/);
          for (const sentence of sentences) {
            if (currentBlock.length + sentence.length > maxBlockLength && currentBlock.length > 0) {
              textBlocks.push(currentBlock.trim());
              pageNumbers.push(page.pageNumber);
              currentBlock = sentence;
            } else {
              currentBlock += (currentBlock ? ' ' : '') + sentence;
            }
          }
        } else {
          // Try to fit the paragraph in the current block
          if (currentBlock.length + paragraph.length > maxBlockLength && currentBlock.length > 0) {
            textBlocks.push(currentBlock.trim());
            pageNumbers.push(page.pageNumber);
            currentBlock = paragraph;
          } else {
            currentBlock += (currentBlock ? ' ' : '') + paragraph;
          }
        }
      }

      // Add remaining text as a block
      if (currentBlock.trim().length > 0) {
        textBlocks.push(currentBlock.trim());
        pageNumbers.push(page.pageNumber);
      }
    }

    return { textBlocks, pageNumbers };
  }
}
