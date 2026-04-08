"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (
      hostname.endsWith("youtube.com") ||
      hostname.endsWith("youtube-nocookie.com")
    ) {
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");
        return id || null;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const [kind, id] = parts;

      if (kind === "embed" || kind === "shorts") {
        return id || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export default function YouTubePage() {
  const [url, setUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const embedSrc = useMemo(() => {
    const id = submittedUrl ? extractYouTubeId(submittedUrl) : null;
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }, [submittedUrl]);

  function handlePreview() {
    setError(null);

    const id = extractYouTubeId(url);
    if (!id) {
      setSubmittedUrl(null);
      setError("Please enter a valid YouTube URL (or video id).");
      return;
    }

    setSubmittedUrl(url);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <div className="grid w-full gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,1fr)]">
        <section className="flex flex-col gap-6 rounded-3xl border border-border/60 bg-background/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              YouTube video
            </h1>
            <p className="text-sm text-muted-foreground">
              Paste a YouTube link to preview it.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="youtube-url">
              YouTube URL
            </label>
            <input
              id="youtube-url"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              inputMode="url"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              This tool only previews/embeds videos. Downloading YouTube content
              isn’t supported here.
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handlePreview}>
              Preview
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setUrl("");
                setSubmittedUrl(null);
                setError(null);
              }}
            >
              Reset
            </Button>
          </div>
        </section>

        <section className="flex min-h-144 flex-col gap-3 rounded-3xl border border-border/60 bg-muted/25 p-4 shadow-sm">
          <div className="px-2 pt-1">
            <h2 className="text-sm font-semibold tracking-tight">Preview</h2>
            <p className="text-xs text-muted-foreground">
              The embedded video will appear here.
            </p>
          </div>

          {embedSrc ? (
            <iframe
              className="min-h-128 flex-1 rounded-2xl border border-border/60 bg-background"
              src={embedSrc}
              title="YouTube preview"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="flex min-h-128 flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background px-6 text-center text-sm text-muted-foreground">
              Paste a link and click Preview.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
