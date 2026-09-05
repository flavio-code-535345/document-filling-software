import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function loadPdf(url) {
  const doc = await pdfjsLib.getDocument(url).promise;
  return doc;
}

/** Render a page into a canvas at the given CSS-pixel width. Returns scale (px per PDF point). */
export async function renderPage(doc, pageIndex, canvas, targetWidth) {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${targetWidth}px`;
  canvas.style.height = `${base.height * scale}px`;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { scale, pageWidthPt: base.width, pageHeightPt: base.height };
}

export { pdfjsLib };
