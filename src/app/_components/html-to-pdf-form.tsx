"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

const DEFAULT_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>HTML to PDF</title>
    <style>
      @page { margin: 20mm; }
      body { font-family: Arial, sans-serif; }
      h1 { margin: 0 0 12px; }
      p { margin: 0 0 12px; }
      .box {
        padding: 12px;
        border: 1px solid #e5e5e5;
        border-radius: 12px;
      }
    </style>
  </head>
  <body>
    <h1>Hello PDF</h1>
    <p>This PDF was generated from raw HTML.</p>
    <div class="box">Tip: keep assets inline (CSS + data: images).</div>
  </body>
</html>
`;

function toSafePdfFilename(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "document.pdf";

  const cleaned = trimmed
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 120);

  if (!cleaned) return "document.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

export default function HtmlToPdfForm() {
  const [html, setHtml] = useState(DEFAULT_HTML);
  const [filename, setFilename] = useState("document.pdf");
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConvert = useMemo(
    () => html.trim().length > 0 && !isConverting,
    [html, isConverting],
  );

  async function handleConvert() {
    if (!html.trim()) return;

    setIsConverting(true);
    setError(null);

    try {
      const response = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, filename }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Request failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = toSafePdfFilename(filename);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      URL.revokeObjectURL(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">HTML → PDF</h1>
        <p className="text-sm text-muted-foreground">
          Paste HTML, then convert and download the PDF.
        </p>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="filename">
          File name
        </label>
        <input
          id="filename"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="document.pdf"
          inputMode="text"
          autoComplete="off"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="html">
          HTML
        </label>
        <textarea
          id="html"
          className="min-h-105 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Note: the server blocks external network requests and disables
          JavaScript while rendering.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button onClick={handleConvert} disabled={!canConvert}>
          {isConverting ? "Converting…" : "Convert to PDF"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setHtml(DEFAULT_HTML);
            setError(null);
          }}
          disabled={isConverting}
        >
          Reset sample
        </Button>
      </div>
    </div>
  );
}
