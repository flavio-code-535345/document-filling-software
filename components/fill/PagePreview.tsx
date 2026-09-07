"use client";

import { useEffect, useRef, useState } from "react";
import { preparePageRender } from "@/lib/pdf/client";
import PreviewSvg, { type PreviewValues } from "@/components/PreviewSvg";
import type { PageRotation, TemplateField } from "@/lib/types";

/**
 * Live preview of one PDF page: the real document rendered via pdfjs (canvas)
 * with the filled values as a transparent SVG overlay on top.
 * Supports per-page display rotation (the page is rotated via CSS, matching the
 * final PDF's /Rotate).
 */
export default function PagePreview({
  pdfUrl,
  pageIndex,
  pageSize,
  fields,
  values,
  rotation = 0,
}: {
  pdfUrl: string;
  pageIndex: number;
  pageSize: { width: number; height: number };
  fields: TemplateField[];
  values: PreviewValues;
  rotation?: PageRotation;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [inner, setInner] = useState<{ w: number; h: number } | null>(null);

  const rotated = rotation === 90 || rotation === 270;
  const displayW = rotated ? pageSize.height : pageSize.width;
  const displayH = rotated ? pageSize.width : pageSize.height;

  useEffect(() => {
    let cancelled = false;
    let currentTask: { promise: Promise<void>; cancel: () => void } | null = null;

    (async () => {
      try {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const displayWidthPx = wrap.clientWidth || 440;
        const scale = displayWidthPx / (rotated ? pageSize.height : pageSize.width);
        const mediaWpx = pageSize.width * scale;
        const mediaHpx = pageSize.height * scale;
        setInner({ w: mediaWpx, h: mediaHpx });
        const prepared = await preparePageRender(pdfUrl, pageIndex, canvas, mediaWpx);
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
  }, [pdfUrl, pageIndex, rotation, pageSize.width, pageSize.height]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden bg-white"
      style={{ aspectRatio: `${displayW} / ${displayH}` }}
    >
      {failed ? (
        <div className="grid h-full w-full place-items-center text-sm text-gray-500">
          Vorschau nicht verfügbar
        </div>
      ) : inner ? (
        <div
          className="absolute"
          style={{
            left: "50%",
            top: "50%",
            width: inner.w,
            height: inner.h,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          }}
        >
          <canvas ref={canvasRef} className="absolute inset-0" />
          <PreviewSvg
            pageWidth={pageSize.width}
            pageHeight={pageSize.height}
            fields={fields}
            values={values}
            className="absolute inset-0 h-full w-full"
            transparent
          />
        </div>
      ) : null}
    </div>
  );
}
