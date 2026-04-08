"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type Mode = "blur" | "crop";

function toSafeMp4Filename(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "cleaned.mp4";

  const cleaned = trimmed
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 120);

  if (!cleaned) return "cleaned.mp4";
  return cleaned.toLowerCase().endsWith(".mp4") ? cleaned : `${cleaned}.mp4`;
}

export default function YouTubePage() {
  const [file, setFile] = useState<File | null>(null);
  const [outputFilename, setOutputFilename] = useState("cleaned.mp4");
  const [mode, setMode] = useState<Mode>("blur");

  const [cropTop, setCropTop] = useState(0);
  const [cropRight, setCropRight] = useState(0);
  const [cropBottom, setCropBottom] = useState(0);
  const [cropLeft, setCropLeft] = useState(0);

  const [blurX, setBlurX] = useState(0);
  const [blurY, setBlurY] = useState(0);
  const [blurWidth, setBlurWidth] = useState(320);
  const [blurHeight, setBlurHeight] = useState(80);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const canProcess = useMemo(
    () => !isProcessing && !!file,
    [file, isProcessing],
  );

  useEffect(() => {
    return () => {
      if (resultUrl) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [resultUrl]);

  async function handleProcess() {
    if (!file) return;

    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", mode);
      formData.append("filename", outputFilename);

      if (mode === "crop") {
        formData.append("cropTop", String(cropTop));
        formData.append("cropRight", String(cropRight));
        formData.append("cropBottom", String(cropBottom));
        formData.append("cropLeft", String(cropLeft));
      } else {
        formData.append("blurX", String(blurX));
        formData.append("blurY", String(blurY));
        formData.append("blurWidth", String(blurWidth));
        formData.append("blurHeight", String(blurHeight));
      }

      const response = await fetch("/api/video", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Request failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }

  function handleDownload() {
    if (!resultUrl) return;

    const anchor = document.createElement("a");
    anchor.href = resultUrl;
    anchor.download = toSafeMp4Filename(outputFilename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <div className="grid w-full gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,1fr)]">
        <section className="flex flex-col gap-6 rounded-3xl border border-border/60 bg-background/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Video cleanup
            </h1>
            <p className="text-sm text-muted-foreground">
              Upload an MP4, then crop or blur a region and download the result.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="video-file">
              MP4 file
            </label>
            <input
              id="video-file"
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs outline-none file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              type="file"
              accept="video/mp4"
              onChange={(e) => {
                const nextFile = e.target.files?.[0] ?? null;
                setFile(nextFile);
                setError(null);

                if (nextFile?.name) {
                  const base = nextFile.name.replace(/\.mp4$/i, "");
                  setOutputFilename(toSafeMp4Filename(`${base}-cleaned.mp4`));
                } else {
                  setOutputFilename("cleaned.mp4");
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Only use videos you own or have permission to edit.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="output-filename">
              Output file name
            </label>
            <input
              id="output-filename"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={outputFilename}
              onChange={(e) => setOutputFilename(e.target.value)}
              placeholder="cleaned.mp4"
              inputMode="text"
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="mode">
              Mode
            </label>
            <select
              id="mode"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              disabled={isProcessing}
            >
              <option value="blur">Blur a rectangle (x/y/w/h)</option>
              <option value="crop">Crop margins (top/right/bottom/left)</option>
            </select>
          </div>

          {mode === "crop" ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <p className="text-sm font-medium">Crop (pixels)</p>
                <p className="text-xs text-muted-foreground">
                  Remove edges to hide overlays.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="crop-top">
                    Top
                  </label>
                  <input
                    id="crop-top"
                    type="number"
                    min={0}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={cropTop}
                    onChange={(e) => setCropTop(Number(e.target.value))}
                    disabled={isProcessing}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="crop-right">
                    Right
                  </label>
                  <input
                    id="crop-right"
                    type="number"
                    min={0}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={cropRight}
                    onChange={(e) => setCropRight(Number(e.target.value))}
                    disabled={isProcessing}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="crop-bottom">
                    Bottom
                  </label>
                  <input
                    id="crop-bottom"
                    type="number"
                    min={0}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={cropBottom}
                    onChange={(e) => setCropBottom(Number(e.target.value))}
                    disabled={isProcessing}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="crop-left">
                    Left
                  </label>
                  <input
                    id="crop-left"
                    type="number"
                    min={0}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={cropLeft}
                    onChange={(e) => setCropLeft(Number(e.target.value))}
                    disabled={isProcessing}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <p className="text-sm font-medium">Blur region (pixels)</p>
                <p className="text-xs text-muted-foreground">
                  Coordinates are from the top-left corner.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="blur-x">
                    X
                  </label>
                  <input
                    id="blur-x"
                    type="number"
                    min={0}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={blurX}
                    onChange={(e) => setBlurX(Number(e.target.value))}
                    disabled={isProcessing}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="blur-y">
                    Y
                  </label>
                  <input
                    id="blur-y"
                    type="number"
                    min={0}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={blurY}
                    onChange={(e) => setBlurY(Number(e.target.value))}
                    disabled={isProcessing}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="blur-width">
                    Width
                  </label>
                  <input
                    id="blur-width"
                    type="number"
                    min={1}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={blurWidth}
                    onChange={(e) => setBlurWidth(Number(e.target.value))}
                    disabled={isProcessing}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="blur-height">
                    Height
                  </label>
                  <input
                    id="blur-height"
                    type="number"
                    min={1}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={blurHeight}
                    onChange={(e) => setBlurHeight(Number(e.target.value))}
                    disabled={isProcessing}
                  />
                </div>
              </div>
            </div>
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleProcess}
              disabled={!canProcess}
            >
              {isProcessing ? "Processing…" : "Process video"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFile(null);
                setOutputFilename("cleaned.mp4");
                setError(null);
                setResultUrl(null);
                setMode("blur");
                setCropTop(0);
                setCropRight(0);
                setCropBottom(0);
                setCropLeft(0);
                setBlurX(0);
                setBlurY(0);
                setBlurWidth(320);
                setBlurHeight(80);
              }}
              disabled={isProcessing}
            >
              Reset
            </Button>
          </div>
        </section>

        <section className="flex min-h-144 flex-col gap-3 rounded-3xl border border-border/60 bg-muted/25 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 px-2 pt-1">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Result</h2>
              <p className="text-xs text-muted-foreground">
                Download the processed MP4.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!resultUrl}
            >
              Download
            </Button>
          </div>

          {resultUrl ? (
            <div className="flex min-h-128 flex-1 items-center justify-center rounded-2xl border border-border/60 bg-background px-6 text-center text-sm text-muted-foreground">
              Ready to download: {toSafeMp4Filename(outputFilename)}
            </div>
          ) : (
            <div className="flex min-h-128 flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background px-6 text-center text-sm text-muted-foreground">
              Upload an MP4 and click Process.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
