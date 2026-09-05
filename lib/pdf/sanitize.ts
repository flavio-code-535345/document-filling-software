// Filename sanitization for generated PDFs: keep umlauts, strip path-hostile chars.
export function sanitizePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50)
    .replace(/[.\s]+$/g, "");
}

export function buildOutputFilename(
  templateName: string,
  parts: { label: string; value: string }[]
): string {
  const namePart = sanitizePart(templateName) || "Dokument";
  const valueParts = parts
    .map((p) => sanitizePart(String(p.value)))
    .filter((v) => v.length > 0);
  return [namePart, ...valueParts].join(" - ").slice(0, 200) + ".pdf";
}

/** Encode a filename for a Content-Disposition header (UTF-8 with fallback). */
export function contentDispositionFilename(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
