"use client";

import { useEffect, useRef, useState } from "react";
import { preparePageRender } from "@/lib/pdf/client";
import PreviewSvg, { type PreviewValues } from "@/components/PreviewSvg";
import type { TemplateField } from "@/lib/types";

/**
 * Live preview of one PDF page: the real document rendered via pdfjs (canvas)
 * with the filled values as a transparent SVG overlay on top.
 * The wrapper keeps the exact page aspect ratio, so the border hugs the page.
 */
export default function PagePreview({
  pdfUrl,
  pageIndex,
  pageSize,
  fields,
  values,
}: {
  pdfUrl: string;
  pageIndex: number;
  pageSize: { width: number; height: number };
  fields: TemplateField[];
  values: PreviewValues;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let currentTask: { promise: Promise<void>; cancel: () => void } | null = null;

    (async () => {
      try {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const targetWidth = wrap.clientWidth || 440;
        const prepared = await preparePageRender(pdfUrl, pageIndex, canvas, targetWidth);
        if (cancelled) {
          prepared.task.cancel();
          return;
        }
        currentTask = prepared.task;
        await prepared.task.promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      currentTask?.cancel();
    };
  }, [pdfUrl, pageIndex]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden bg-white"
      style={{ aspectRatio: `${pageSize.width || 612} / ${pageSize.height || 792}` }}
    >
      {failed ? (
        <div className="grid h-full w-full place-items-center text-sm text-gray-500">
          Vorschau nicht verfügbar
        </div>
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0" />
      )}
      <PreviewSvg
        pageWidth={pageSize.width || 612}
        pageHeight={pageSize.height || 792}
        fields={fields}
        values={values}
        className="absolute inset-0 h-full w-full"
        transparent
      />
    </div>
  );
}
