import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

const DEFAULT_OUTPUT_FILENAME = "story.mp4";

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const FPS = 30;
const TRANSITION_DURATION_SEC = 0.8;
const MAX_OUTPUT_DURATION_SEC = 60;
const MOTION_SCALE = 1.08;

type Transition = "fade" | "slideleft" | "wipeleft";
type Motion = "none" | "panup" | "pandown";

function resolveFfmpegStaticPath(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (value && typeof value === "object") {
    const maybeDefault = (value as { default?: unknown }).default;
    if (typeof maybeDefault === "string") {
      const trimmed = maybeDefault.trim();
      return trimmed ? trimmed : null;
    }
  }

  return null;
}

function mapVirtualRootPathToFsPath(candidate: string): string | null {
  if (!candidate.startsWith("/ROOT/")) return null;

  const suffix = candidate.slice("/ROOT/".length);
  if (!suffix) return null;

  return join(/*turbopackIgnore: true*/ process.cwd(), suffix);
}

function toSafeMp4Filename(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_OUTPUT_FILENAME;

  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_OUTPUT_FILENAME;

  const cleaned = trimmed
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 120);

  if (!cleaned) return DEFAULT_OUTPUT_FILENAME;
  return cleaned.toLowerCase().endsWith(".mp4") ? cleaned : `${cleaned}.mp4`;
}

function toInt(
  value: FormDataEntryValue | null,
  defaultValue: number,
  opts?: { min?: number; max?: number },
): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;

  let result = parsed;
  if (typeof opts?.min === "number") result = Math.max(opts.min, result);
  if (typeof opts?.max === "number") result = Math.min(opts.max, result);
  return result;
}

function runFfmpeg(
  binaryPath: string,
  args: string[],
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : String(chunk);
      stderr += text;
      if (stderr.length > 60_000) {
        stderr = stderr.slice(stderr.length - 60_000);
      }
    });

    child.on("error", (err) => {
      resolve({ exitCode: -1, stderr: String(err) });
    });

    child.on("close", (code) => {
      resolve({ exitCode: typeof code === "number" ? code : -1, stderr });
    });
  });
}

async function isExecutable(filePath: string) {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isImageMimeType(mime: string) {
  return (
    mime === "image/jpeg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    mime === "image/avif" ||
    mime === "image/gif"
  );
}

function isAudioMimeType(mime: string) {
  return mime === "audio/mpeg" || mime === "audio/mp3";
}

function parseFfmpegDurationSeconds(stderr: string): number | null {
  const match = stderr.match(
    /\bDuration:\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/,
  );
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fractional = match[4] ? Number(`0.${match[4]}`) : 0;

  const totalSeconds = hours * 3600 + minutes * 60 + seconds + fractional;
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  return totalSeconds;
}

async function getAudioDurationSeconds(
  audioPath: string,
  ffmpegCandidates: string[],
): Promise<number | null> {
  const args = ["-hide_banner", "-i", audioPath];

  for (const candidate of ffmpegCandidates) {
    const { stderr } = await runFfmpeg(candidate, args);
    const parsed = parseFfmpegDurationSeconds(stderr);
    if (parsed) return parsed;
  }

  return null;
}

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return new Response("Invalid multipart/form-data body", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const audio = formData.get("audio");
  if (!(audio instanceof File)) {
    return new Response("Missing `audio`", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const images = formData
    .getAll("images")
    .filter((v): v is File => v instanceof File);
  if (images.length < 1) {
    return new Response("Missing `images`", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (images.length > MAX_IMAGES) {
    return new Response(`Too many images (max ${MAX_IMAGES})`, {
      status: 413,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (audio.size <= 0) {
    return new Response("Empty audio file", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return new Response("Audio is too large", {
      status: 413,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (audio.type && !isAudioMimeType(audio.type)) {
    return new Response("Only MP3 audio is supported", {
      status: 415,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let totalBytes = audio.size;

  for (const img of images) {
    if (img.size <= 0) {
      return new Response("Empty image file", {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (img.size > MAX_IMAGE_BYTES) {
      return new Response("Image is too large", {
        status: 413,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (img.type && !isImageMimeType(img.type)) {
      return new Response("Unsupported image type", {
        status: 415,
        headers: { "Cache-Control": "no-store" },
      });
    }

    totalBytes += img.size;
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    return new Response("Upload is too large", {
      status: 413,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const slideDurationSec = toInt(formData.get("slideDurationSec"), 3, {
    min: 1,
    max: 10,
  });

  const transitionRaw = formData.get("transition");
  const transition: Transition =
    transitionRaw === "fade" ||
    transitionRaw === "slideleft" ||
    transitionRaw === "wipeleft"
      ? transitionRaw
      : "fade";

  const motionRaw = formData.get("motion");
  const motion: Motion =
    motionRaw === "panup" || motionRaw === "pandown" ? motionRaw : "none";

  const outputFilename = toSafeMp4Filename(formData.get("filename"));

  const imageCount = images.length;

  const ffmpegCandidates: string[] = [];

  const envFfmpeg =
    typeof process.env.FFMPEG_BIN === "string"
      ? process.env.FFMPEG_BIN.trim()
      : "";
  const staticFfmpeg = resolveFfmpegStaticPath(ffmpegPath);
  const mappedStaticFfmpeg = staticFfmpeg
    ? mapVirtualRootPathToFsPath(staticFfmpeg)
    : null;

  const maybeAddCandidate = async (candidate: string | null) => {
    if (!candidate) return;
    if (!isAbsolute(candidate) || (await isExecutable(candidate))) {
      ffmpegCandidates.push(candidate);
    }
  };

  await maybeAddCandidate(envFfmpeg || null);
  await maybeAddCandidate(staticFfmpeg);
  await maybeAddCandidate(mappedStaticFfmpeg);

  ffmpegCandidates.push("ffmpeg");

  const uniqueFfmpegCandidates = Array.from(new Set(ffmpegCandidates));

  const tempDir = await mkdtemp(join(tmpdir(), "html-to-pdf-story-"));

  const outputPath = join(tempDir, "output.mp4");

  let cleanupOnReturn = true;

  try {
    const audioPath = join(tempDir, "audio.mp3");
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    const audioDurationSecRaw = await getAudioDurationSeconds(
      audioPath,
      uniqueFfmpegCandidates,
    );
    const audioDurationSec =
      typeof audioDurationSecRaw === "number" &&
      Number.isFinite(audioDurationSecRaw)
        ? Math.min(audioDurationSecRaw, MAX_OUTPUT_DURATION_SEC)
        : null;

    let effectiveSlideDurationSec = slideDurationSec;

    if (audioDurationSec) {
      if (imageCount === 1) {
        effectiveSlideDurationSec = Math.max(
          effectiveSlideDurationSec,
          audioDurationSec,
        );
      } else {
        const slideToFillAudio =
          (audioDurationSec - (imageCount - 1) * TRANSITION_DURATION_SEC) /
          imageCount;

        if (Number.isFinite(slideToFillAudio) && slideToFillAudio > 0) {
          effectiveSlideDurationSec = Math.max(
            effectiveSlideDurationSec,
            slideToFillAudio,
          );
        }
      }
    }

    const inputDurations = images.map((_, idx) => {
      if (imageCount === 1) return effectiveSlideDurationSec;

      const extra =
        idx === 0 || idx === imageCount - 1
          ? TRANSITION_DURATION_SEC
          : TRANSITION_DURATION_SEC * 2;
      return effectiveSlideDurationSec + extra;
    });

    const totalDurationSec =
      imageCount === 1
        ? effectiveSlideDurationSec
        : imageCount * effectiveSlideDurationSec +
          (imageCount - 1) * TRANSITION_DURATION_SEC;

    const imagePaths: string[] = [];

    for (let i = 0; i < images.length; i += 1) {
      const img = images[i];
      const ext =
        img.type === "image/png"
          ? "png"
          : img.type === "image/webp"
            ? "webp"
            : img.type === "image/avif"
              ? "avif"
              : img.type === "image/gif"
                ? "gif"
                : "jpg";

      const imgPath = join(tempDir, `image-${i + 1}.${ext}`);
      await writeFile(imgPath, Buffer.from(await img.arrayBuffer()));
      imagePaths.push(imgPath);
    }

    const args: string[] = ["-y", "-hide_banner"];

    for (let i = 0; i < imagePaths.length; i += 1) {
      args.push(
        "-loop",
        "1",
        "-t",
        String(inputDurations[i]),
        "-i",
        imagePaths[i],
      );
    }

    // Loop audio so the story always has sound, even if the MP3 is shorter.
    args.push("-stream_loop", "-1", "-i", audioPath);

    const audioInputIndex = imagePaths.length;

    const filters: string[] = [];

    for (let i = 0; i < imagePaths.length; i += 1) {
      if (motion === "none") {
        filters.push(
          `[${i}:v]` +
            `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,` +
            `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},` +
            `setsar=1,` +
            `fps=${FPS},` +
            `format=rgba,` +
            `setpts=PTS-STARTPTS` +
            `[v${i}]`,
        );
        continue;
      }

      const duration = Number(inputDurations[i].toFixed(3));
      const scaledWidth = Math.round(OUTPUT_WIDTH * MOTION_SCALE);
      const scaledHeight = Math.round(OUTPUT_HEIGHT * MOTION_SCALE);
      const progressExpr = `min(t/${duration},1)`;

      const xExpr = `max((iw-${OUTPUT_WIDTH})/2,0)`;
      const yExpr =
        motion === "pandown"
          ? `max(ih-${OUTPUT_HEIGHT},0)*${progressExpr}`
          : `max(ih-${OUTPUT_HEIGHT},0)*(1-${progressExpr})`;

      filters.push(
        `[${i}:v]` +
          `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,` +
          `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:x='${xExpr}':y='${yExpr}',` +
          `setsar=1,` +
          `fps=${FPS},` +
          `format=rgba,` +
          `setpts=PTS-STARTPTS` +
          `[v${i}]`,
      );
    }

    let currentLabel = "v0";
    let currentLength = inputDurations[0];

    for (let i = 1; i < imagePaths.length; i += 1) {
      const nextLabel = `x${i}`;
      const offset = Number(
        (currentLength - TRANSITION_DURATION_SEC).toFixed(3),
      );

      filters.push(
        `[${currentLabel}][v${i}]` +
          `xfade=transition=${transition}:duration=${TRANSITION_DURATION_SEC}:offset=${offset}` +
          `[${nextLabel}]`,
      );

      currentLength =
        currentLength + inputDurations[i] - TRANSITION_DURATION_SEC;
      currentLabel = nextLabel;
    }

    filters.push(`[${currentLabel}]format=yuv420p[v]`);

    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[v]",
      "-map",
      `${audioInputIndex}:a:0`,
      "-t",
      String(Math.min(totalDurationSec, MAX_OUTPUT_DURATION_SEC)),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
    );

    let lastExitCode = -1;
    let lastStderr = "";
    let allMissingBinary = true;

    for (const candidate of uniqueFfmpegCandidates) {
      const { exitCode, stderr } = await runFfmpeg(candidate, args);
      lastExitCode = exitCode;
      lastStderr = stderr;

      if (!/\bENOENT\b/.test(stderr)) {
        allMissingBinary = false;
      }

      if (exitCode === 0) break;
      if (!/\bENOENT\b/.test(stderr)) break;
    }

    if (lastExitCode !== 0) {
      if (allMissingBinary) {
        return new Response(
          "ffmpeg binary was not found at runtime (ENOENT).\n\n" +
            `Tried: ${uniqueFfmpegCandidates.join(", ")}` +
            `\nResolved ffmpeg-static: ${staticFfmpeg ?? "(none)"}` +
            `\nMapped ffmpeg-static: ${mappedStaticFfmpeg ?? "(none)"}` +
            `\nFFMPEG_BIN: ${envFfmpeg || "(unset)"}`,
          {
            status: 500,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      const detail = lastStderr.trim().slice(-4000);
      return new Response(`Failed to generate story.\n\n${detail}`, {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }

    cleanupOnReturn = false;

    const nodeStream = createReadStream(outputPath);
    const cleanup = () => {
      rm(tempDir, { recursive: true, force: true }).catch(() => {});
    };

    nodeStream.on("close", cleanup);
    nodeStream.on("error", cleanup);

    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${outputFilename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(`Failed to generate story: ${message}`, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  } finally {
    if (cleanupOnReturn) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
