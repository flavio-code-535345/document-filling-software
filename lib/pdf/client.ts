// Client-only pdfjs wrapper. pdfjs-dist v6: page.render({ canvas }) takes the
// element (not a context). The worker is copied to public/ by postinstall.
"use client";

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

export function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}

// Module-level document cache keyed by url (urls carry ?v=<updatedAt> as cache-buster).
const docCache = new Map<string, ReturnType<PdfjsModule["getDocument"]>>();

export async function getDocument(url: string) {
  const existing = docCache.get(url);
  if (existing) return existing.promise;
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ url });
  docCache.set(url, task);
  return task.promise;
}

export function clearDocCache() {
  docCache.clear();
}

export async function renderPageToCanvas(
  url: string,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  targetWidthPx: number
): Promise<{ scale: number; pageWidthPt: number; pageHeightPt: number }> {
  const prepared = await preparePageRender(url, pageIndex, canvas, targetWidthPx);
  await prepared.task.promise;
  return { scale: prepared.scale, pageWidthPt: prepared.pageWidthPt, pageHeightPt: prepared.pageHeightPt };
}

/**
 * Prepares a cancellable page render (React StrictMode-safe: keep the returned
 * task and cancel it before starting a new one on the same canvas).
 */
export async function preparePageRender(
  url: string,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  targetWidthPx: number
): Promise<{
  task: { promise: Promise<void>; cancel: () => void };
  scale: number;
  pageWidthPt: number;
  pageHeightPt: number;
}> {
  const pdfjs = await getPdfjs();
  const doc = await getDocument(url);
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidthPx / base.width;
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(base.width * scale)}px`;
  canvas.style.height = `${Math.floor(base.height * scale)}px`;
  const task = page.render({ canvas, viewport });
  return { task, scale, pageWidthPt: base.width, pageHeightPt: base.height };
}

/** Approximate Helvetica text width (Arial ≈ Helvetica metrics) for SVG preview parity. */
export function measureHelvetica(text: string, fontSize: number): number {
  const ctx = measureCtx();
  ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width;
}

let _ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!_ctx) {
    _ctx = document.createElement("canvas").getContext("2d");
  }
  return _ctx!;
}

export function wrapClient(
  text: string,
  maxWidth: number,
  fontSize: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = `${current} ${words[i]}`;
      if (measureHelvetica(next, fontSize) <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}
