// AI field auto-detection via Google Gemini.
//
// Scans the raw template PDF and proposes fillable fields (label, kind, page,
// rect) in PDF points with TOP-LEFT origin — matching lib/geometry exactly.
// The API key comes from the store settings (admin) or the GEMINI_API_KEY
// env var fallback.

import type { FieldKind, TemplateField } from "../types";
import { newId } from "../auth.ts";

const VALID_KINDS: FieldKind[] = ["text", "multiline", "date", "checkbox", "signature"];

// Gemini request payload cap (~20MB total): base64 inflates PDFs by 4/3.
const MAX_PDF_BYTES = 15 * 1024 * 1024;

export interface AIScanRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const PROMPT = (
  pageSizes: { width: number; height: number }[],
  region?: AIScanRegion
) => {
  const regionHint = region
    ? `\nWICHTIG: Erkenne NUR Felder, die INNERHALB des markierten Bereichs auf Seite ${region.page} liegen (Bereich in PDF-Punkten: x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height}). Gib x/y/width/height RELATIV zu DIESEM Bereich an (0,0 = oben links des Bereichs, 1,1 = unten rechts).`
    : "";
  return `Du bist ein Formular-Feld-Erkenner für ein PDF-Templating-System.
Schau dir die PDF-Seiten an und antworte NUR mit einem JSON-Array. Jedes Element ist ein Feld:
{
  "label": "deutscher Label-Name",
  "kind": "text|multiline|date|checkbox|signature",
  "page": 0-basierter Seitenindex,
  "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0,
  "fontSize": 11
}
WICHTIG: x, y, width und height sind RELATIVE Werte zwischen 0.0 und 1.0,
bezogen auf Seitenbreite und Seitenhöhe (0,0 = oben links). 0.1 bedeutet 10% der Seite.
Platziere jedes Rechteck GENAU auf die leere Fläche, in die hineingeschrieben werden
soll (Linie/Lücke/Kasten), nicht auf das gedruckte Label daneben.${regionHint}
Seitengrößen (pt): ${JSON.stringify(pageSizes)}. Nur Array, kein Markdown.`;
};

export async function detectFieldsWithGemini(
  templateBytes: Uint8Array | Buffer,
  pageSizes: { width: number; height: number }[],
  {
    apiKey,
    model,
    region,
  }: { apiKey: string; model: string; region?: AIScanRegion }
): Promise<TemplateField[]> {
  if (!apiKey) {
    const err = new Error("KI nicht konfiguriert (API-Schlüssel fehlt).") as Error & { code: string };
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }

  const bytes = Buffer.from(templateBytes);
  if (bytes.length > MAX_PDF_BYTES) {
    const err = new Error("Dokument ist zu groß für den KI-Scan (max. 15 MB).") as Error & { code: string };
    err.code = "AI_REQUEST_FAILED";
    throw err;
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT(pageSizes, region) },
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: bytes.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message: string;
    if (res.status === 404) {
      message = `Gemini-Modell „${model}" nicht gefunden — bitte anderes Modell in den Einstellungen wählen.`;
    } else if (res.status === 400) {
      message = body.includes("API key")
        ? "Gemini-API-Schlüssel ist ungültig — bitte in den Einstellungen prüfen."
        : `Gemini-Anfrage ungültig (${res.status}): ${body.slice(0, 160)}`;
    } else if (res.status === 429) {
      message = "Gemini-Limit erreicht — später erneut versuchen.";
    } else {
      message = `Gemini-Fehler ${res.status}: ${body.slice(0, 160)}`;
    }
    const err = new Error(message) as Error & { code: string };
    err.code = "AI_REQUEST_FAILED";
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error("KI-Antwort konnte nicht gelesen werden.");
  const parsed = JSON.parse(text.slice(start, end + 1));

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("KI hat keine Felder erkannt.");
  }

  return parsed
    .map((raw) => sanitizeProposal(raw, pageSizes, region))
    .filter((f): f is TemplateField => f !== null);
}

export function sanitizeProposal(
  raw: Record<string, unknown>,
  pageSizes: { width: number; height: number }[],
  region?: AIScanRegion
): TemplateField | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (typeof raw.kind === "string" ? raw.kind.toLowerCase() : "text") as FieldKind;
  if (!VALID_KINDS.includes(kind)) return null;

  const page = Number(raw.page);
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (!Number.isFinite(page) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const pageCount = Math.max(1, pageSizes.length);
  const regionPage = region
    ? Math.min(Math.max(0, Math.floor(region.page)), pageCount - 1)
    : Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const p = region ? regionPage : regionPage;
  const pageW = pageSizes[p]?.width ?? 612;
  const pageH = pageSizes[p]?.height ?? 792;

  // Effective coordinate space: the marked region (relative within it),
  // otherwise the full page.
  const spaceW = region ? Math.min(region.width, pageW) : pageW;
  const spaceH = region ? Math.min(region.height, pageH) : pageH;
  const offsetX = region ? Math.max(0, Math.min(region.x, pageW - 1)) : 0;
  const offsetY = region ? Math.max(0, Math.min(region.y, pageH - 1)) : 0;

  // Coordinates are requested relative (0..1). If the model ignored that and
  // answered in pixels of a 96-dpi render, convert those instead.
  const looksLikePixels = x > 1.5 || y > 1.5 || width > 1.5 || height > 1.5;
  const pxScaleW = looksLikePixels ? (spaceW * 96) / 72 : 1;
  const pxScaleH = looksLikePixels ? (spaceH * 96) / 72 : 1;

  const xN = looksLikePixels ? x / pxScaleW : x;
  const yN = looksLikePixels ? y / pxScaleH : y;
  const wN = looksLikePixels ? width / pxScaleW : width;
  const hN = looksLikePixels ? height / pxScaleH : height;

  const xPt = offsetX + Math.max(0, Math.min(1, xN)) * spaceW;
  const yPt = offsetY + Math.max(0, Math.min(1, yN)) * spaceH;
  let wPt = Math.abs(wN) * spaceW;
  let hPt = Math.abs(hN) * spaceH;

  if (region) {
    // Keep proposals inside the marked region.
    wPt = Math.min(wPt, offsetX + region.width - xPt);
    hPt = Math.min(hPt, offsetY + region.height - yPt);
  }

  // Font size must physically fit inside the box (value has to be written in it).
  let fontSize = Number.isFinite(Number(raw.fontSize)) ? Number(raw.fontSize) : 11;
  fontSize = Math.min(16, Math.max(6, fontSize));
  const minH = fontSize * 1.35;
  if (hPt < minH) hPt = minH;
  if (fontSize > hPt / 1.35) fontSize = Math.max(6, hPt / 1.35);
  if (kind === "checkbox") {
    hPt = Math.max(10, hPt);
    wPt = Math.max(10, wPt);
  }

  return {
    id: newId(),
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "Feld",
    kind,
    page: p,
    x: Math.round(Math.max(0, Math.min(xPt, pageW - 8)) * 100) / 100,
    y: Math.round(Math.max(0, Math.min(yPt, pageH - 8)) * 100) / 100,
    width: Math.round(Math.max(10, Math.min(wPt, pageW - xPt)) * 100) / 100,
    height: Math.round(Math.max(8, Math.min(hPt, pageH - yPt)) * 100) / 100,
    fontSize: Math.round(fontSize * 10) / 10,
    required: false,
  };
}
