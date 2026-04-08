"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const canConvert = useMemo(
    () => html.trim().length > 0 && !isConverting,
    [html, isConverting],
  );

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

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

      setPdfUrl(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setIsConverting(false);
    }
  }

  function handleDownload() {
    if (!pdfUrl) return;

    const anchor = document.createElement("a");
    anchor.href = pdfUrl;
    anchor.download = toSafePdfFilename(filename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <div className="grid w-full gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
      <section className="flex flex-col gap-6 rounded-3xl border border-border/60 bg-background/90 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">HTML → PDF</h1>
          <p className="text-sm text-muted-foreground">
            Paste HTML, preview the generated PDF, then download the final file.
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

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleConvert} disabled={!canConvert}>
            {isConverting ? "Generating preview…" : "Convert to PDF"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setHtml(DEFAULT_HTML);
              setPdfUrl(null);
              setError(null);
            }}
            disabled={isConverting}
          >
            Reset sample
          </Button>
        </div>
      </section>

      <section className="flex min-h-144 flex-col gap-3 rounded-3xl border border-border/60 bg-muted/25 p-4 shadow-sm xl:sticky xl:top-6">
        <div className="flex items-center justify-between gap-3 px-2 pt-1">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Preview</h2>
            <p className="text-xs text-muted-foreground">
              The last generated PDF appears here.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={!pdfUrl}
          >
            Download
          </Button>
        </div>

        {pdfUrl ? (
          <iframe
            className="min-h-128 flex-1 rounded-2xl border border-border/60 bg-background"
            src={pdfUrl}
            title="PDF preview"
          />
        ) : (
          <div className="flex min-h-128 flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background px-6 text-center text-sm text-muted-foreground">
            Convert once to preview the PDF here before downloading it.
          </div>
        )}
      </section>
    </div>
  );
}
