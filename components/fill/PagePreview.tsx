"use client";

import { useEffect, useRef, useState } from "react";
import { preparePageRender } from "@/lib/pdf/client";
import PreviewSvg, { type PreviewValues } from "@/components/PreviewSvg";
import type { TemplateField } from "@/lib/types";

/**
 * Live preview of one PDF page: the real document rendered via pdfjs (canvas)
 * with the filled values as a transparent SVG overlay on top.
 */
export default function PagePreview({
  pdfUrl,
  pageIndex,
  pageSize,
  fields,
  values,
  width = 440,
}: {
  pdfUrl: string;
  pageIndex: number;
  pageSize: { width: number; height: number };
  fields: TemplateField[];
  values: PreviewValues;
  width?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  const scale = width / (pageSize.width || 612);
  const heightPx = Math.round((pageSize.height || 792) * scale);

  useEffect(() => {
    let cancelled = false;
    let currentTask: { promise: Promise<void>; cancel: () => void } | null = null;

    (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const prepared = await preparePageRender(pdfUrl, pageIndex, canvas, width);
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
  }, [pdfUrl, pageIndex, width]);

  return (
    <div className="relative" style={{ width, height: heightPx }}>
      {failed ? (
        <div className="grid h-full w-full place-items-center bg-white text-sm text-gray-500">
          Vorschau nicht verfügbar
        </div>
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height: heightPx }} />
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
