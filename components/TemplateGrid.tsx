"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getPdfjs } from "@/lib/pdf/client";

export interface TemplateCardInfo {
  id: string;
  name: string;
  pageCount: number;
  updatedAt: string;
}

export default function TemplateGrid({ templates }: { templates: TemplateCardInfo[] }) {
  if (templates.length === 0) {
    return (
      <p className="mt-10 text-center text-ink-dim">
        Noch keine Formulare vorhanden. Ein Administrator kann Vorlagen anlegen.
      </p>
    );
  }
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Formulare</h1>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <TemplateCard key={t.id} template={t} />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ template }: { template: TemplateCardInfo }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;

    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const doc = await pdfjs.getDocument({
          url: `/api/templates/${template.id}/pdf?v=${encodeURIComponent(template.updatedAt)}`,
        }).promise;
        if (cancelled || !canvasRef.current) return;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = 220 / base.width;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [template.id, template.updatedAt]);

  return (
    <Link
      href={`/fill/${template.id}`}
      className="group overflow-hidden rounded-xl border border-line bg-surface transition hover:border-accent"
    >
      <div className="grid aspect-[4/3] place-items-center overflow-hidden bg-surface-2">
        {failed ? (
          <span className="text-sm text-ink-dim">Keine Vorschau</span>
        ) : (
          <canvas ref={canvasRef} className="max-h-full max-w-full" />
        )}
      </div>
      <div className="p-3">
        <p className="font-medium group-hover:text-accent">{template.name}</p>
        <p className="text-xs text-ink-dim">
          {template.pageCount} Seite{template.pageCount === 1 ? "" : "n"}
        </p>
      </div>
    </Link>
  );
}
