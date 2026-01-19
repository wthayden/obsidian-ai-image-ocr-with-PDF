// Copyright (c) 2025 Chris Laprade (chris@rootiest.com)
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Use legacy build for better CommonJS/esbuild compatibility
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { pluginLog, pluginLogger } from "./log";

// Configure PDF.js worker - must use explicit HTTPS for Electron
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PDFPageImage {
  pageNumber: number;
  base64: string;
  width: number;
  height: number;
}

export interface PDFInfo {
  pageCount: number;
  isEncrypted: boolean;
}

/**
 * Check if an ArrayBuffer contains a PDF file by examining magic bytes
 */
export function isPdfBuffer(buffer: ArrayBuffer): boolean {
  const header = new Uint8Array(buffer.slice(0, 5));
  // PDF magic bytes: %PDF-
  return String.fromCharCode(...header) === "%PDF-";
}

/**
 * Get basic PDF info without rendering pages
 */
export async function getPdfInfo(buffer: ArrayBuffer): Promise<PDFInfo> {
  pluginLogger("Getting PDF info");
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  return {
    pageCount: pdf.numPages,
    isEncrypted: false, // If we got here, it's not password-protected
  };
}

/**
 * Convert PDF pages to PNG images for OCR processing
 *
 * @param buffer - The PDF file as an ArrayBuffer
 * @param scale - Rendering scale (default 2.0 = ~144 DPI)
 * @param maxPages - Maximum pages to process (default 50)
 * @returns Array of page images with base64 PNG data
 */
export async function convertPdfToImages(
  buffer: ArrayBuffer,
  scale: number = 2.0,
  maxPages: number = 50
): Promise<PDFPageImage[]> {
  pluginLogger(`Converting PDF to images (scale: ${scale}, maxPages: ${maxPages})`);
  pluginLogger(`Buffer size: ${buffer.byteLength} bytes`);

  // Convert ArrayBuffer to Uint8Array for PDF.js compatibility
  const uint8Array = new Uint8Array(buffer);
  pluginLogger(`Uint8Array length: ${uint8Array.length}`);

  let pdf;
  try {
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    pdf = await loadingTask.promise;
    pluginLogger(`PDF loaded successfully, pages: ${pdf.numPages}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    pluginLog(`PDF.js error: ${errMsg}`, "error", true);
    console.error("PDF.js loading error:", err);
    if (errMsg.includes("password")) {
      throw new PDFEncryptedError("PDF is password protected");
    }
    throw new PDFCorruptedError(`Failed to load PDF: ${errMsg}`);
  }

  const totalPages = pdf.numPages;
  const pagesToProcess = Math.min(totalPages, maxPages);

  pluginLogger(`Processing ${pagesToProcess} of ${totalPages} pages`);

  const images: PDFPageImage[] = [];

  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      // Create canvas for rendering
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        pluginLog(`Could not get canvas context for page ${pageNum}`, "warn", true);
        continue;
      }

      // Render PDF page to canvas
      await page.render({
        canvasContext: ctx,
        viewport: viewport,
      }).promise;

      // Convert canvas to PNG base64 (strip data URL prefix)
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

      images.push({
        pageNumber: pageNum,
        base64,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
      });

      pluginLogger(`Rendered page ${pageNum}/${pagesToProcess}`);
    } catch (err) {
      pluginLog(`Failed to render page ${pageNum}: ${err}`, "warn", true);
    }
  }

  return images;
}

/**
 * Custom error for encrypted/password-protected PDFs
 */
export class PDFEncryptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PDFEncryptedError";
  }
}

/**
 * Custom error for corrupted or invalid PDFs
 */
export class PDFCorruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PDFCorruptedError";
  }
}
