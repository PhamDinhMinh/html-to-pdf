"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type Transition = "fade" | "slideleft" | "wipeleft";
type Motion = "none" | "panup" | "pandown";

function toSafeMp4Filename(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "story.mp4";

  const cleaned = trimmed
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 120);

  if (!cleaned) return "story.mp4";
  return cleaned.toLowerCase().endsWith(".mp4") ? cleaned : `${cleaned}.mp4`;
}

export default function StoryPage() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);

  const [outputFilename, setOutputFilename] = useState("story.mp4");
  const [slideDurationSec, setSlideDurationSec] = useState(3);
  const [transition, setTransition] = useState<Transition>("fade");
  const [motion, setMotion] = useState<Motion>("none");

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const canGenerate = useMemo(() => {
    return (
      !isGenerating &&
      !!audioFile &&
      imageFiles.length >= 1 &&
      imageFiles.length <= 3
    );
  }, [audioFile, imageFiles.length, isGenerating]);

  useEffect(() => {
    return () => {
      if (resultUrl) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [resultUrl]);

  async function handleGenerate() {
    if (!audioFile || imageFiles.length === 0) return;

    setIsGenerating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("audio", audioFile);
      for (const img of imageFiles.slice(0, 3)) {
        formData.append("images", img);
      }
      formData.append("filename", outputFilename);
      formData.append("slideDurationSec", String(slideDurationSec));
      formData.append("transition", transition);
      formData.append("motion", motion);

      const response = await fetch("/api/story", {
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
      setIsGenerating(false);
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
            <h1 className="text-2xl font-semibold tracking-tight">Story</h1>
            <p className="text-sm text-muted-foreground">
              Upload an MP3 + 1–3 images, choose an animation, and generate an
              MP4 story.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="audio-file">
              MP3 audio
            </label>
            <input
              id="audio-file"
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs outline-none file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              type="file"
              accept="audio/mpeg,audio/mp3"
              onChange={(e) => {
                setAudioFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="image-files">
              Images (1–3)
            </label>
            <input
              id="image-files"
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs outline-none file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setImageFiles(files.slice(0, 3));
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Only use media you own or have permission to edit.
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
              placeholder="story.mp4"
              inputMode="text"
              autoComplete="off"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="slide-duration-sec"
              >
                Seconds per image
              </label>
              <input
                id="slide-duration-sec"
                type="number"
                min={1}
                max={10}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={slideDurationSec}
                onChange={(e) => setSlideDurationSec(Number(e.target.value))}
                disabled={isGenerating}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="transition">
                Transition
              </label>
              <select
                id="transition"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={transition}
                onChange={(e) => setTransition(e.target.value as Transition)}
                disabled={isGenerating}
              >
                <option value="fade">Fade</option>
                <option value="slideleft">Slide left</option>
                <option value="wipeleft">Wipe left</option>
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="motion">
                Image motion
              </label>
              <select
                id="motion"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={motion}
                onChange={(e) => setMotion(e.target.value as Motion)}
                disabled={isGenerating}
              >
                <option value="none">None</option>
                <option value="panup">Pan up</option>
                <option value="pandown">Pan down</option>
              </select>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
            >
              {isGenerating ? "Generating…" : "Generate story"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAudioFile(null);
                setImageFiles([]);
                setOutputFilename("story.mp4");
                setSlideDurationSec(3);
                setTransition("fade");
                setMotion("none");
                setError(null);
                setResultUrl(null);
              }}
              disabled={isGenerating}
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
                Preview and download the generated MP4.
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
            <video
              className="min-h-128 flex-1 rounded-2xl border border-border/60 bg-background"
              src={resultUrl}
              controls
            />
          ) : (
            <div className="flex min-h-128 flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background px-6 text-center text-sm text-muted-foreground">
              Upload files and click Generate.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
