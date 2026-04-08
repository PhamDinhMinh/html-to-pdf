import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const DEFAULT_OUTPUT_FILENAME = "cleaned.mp4";

type Mode = "crop" | "blur";

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

export async function POST(request: Request) {
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

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return new Response("Invalid multipart/form-data body", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return new Response("Missing `file`", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (file.size <= 0) {
    return new Response("Empty file", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (file.size > MAX_VIDEO_BYTES) {
    return new Response("Video is too large", {
      status: 413,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (file.type && file.type !== "video/mp4") {
    return new Response("Only MP4 videos are supported", {
      status: 415,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const modeRaw = formData.get("mode");
  const mode: Mode =
    modeRaw === "crop" || modeRaw === "blur" ? modeRaw : "blur";

  const outputFilename = toSafeMp4Filename(formData.get("filename"));

  const cropTop = toInt(formData.get("cropTop"), 0, { min: 0, max: 10_000 });
  const cropRight = toInt(formData.get("cropRight"), 0, {
    min: 0,
    max: 10_000,
  });
  const cropBottom = toInt(formData.get("cropBottom"), 0, {
    min: 0,
    max: 10_000,
  });
  const cropLeft = toInt(formData.get("cropLeft"), 0, { min: 0, max: 10_000 });

  const blurX = toInt(formData.get("blurX"), 0, { min: 0, max: 1_000_000 });
  const blurY = toInt(formData.get("blurY"), 0, { min: 0, max: 1_000_000 });
  const blurWidth = toInt(formData.get("blurWidth"), 320, {
    min: 1,
    max: 1_000_000,
  });
  const blurHeight = toInt(formData.get("blurHeight"), 80, {
    min: 1,
    max: 1_000_000,
  });

  if (mode === "blur" && (blurWidth <= 0 || blurHeight <= 0)) {
    return new Response("Invalid blur region size", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const tempDir = await mkdtemp(join(tmpdir(), "html-to-pdf-video-"));
  const inputPath = join(tempDir, "input.mp4");
  const outputPath = join(tempDir, "output.mp4");

  let cleanupOnReturn = true;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, bytes);

    const vf =
      mode === "crop"
        ? `crop=iw-${cropLeft}-${cropRight}:ih-${cropTop}-${cropBottom}:${cropLeft}:${cropTop}`
        : `split=2[base][tmp];[tmp]crop=${blurWidth}:${blurHeight}:${blurX}:${blurY},boxblur=20:1[blur];[base][blur]overlay=${blurX}:${blurY}`;

    const args = [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      vf,
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
    ];

    let lastStderr = "";
    let lastExitCode = -1;
    let allMissingBinary = true;

    for (const candidate of uniqueFfmpegCandidates) {
      const { exitCode, stderr } = await runFfmpeg(candidate, args);
      lastExitCode = exitCode;
      lastStderr = stderr;

      if (!/\bENOENT\b/.test(stderr)) {
        allMissingBinary = false;
      }

      if (exitCode === 0) {
        break;
      }

      if (!/\bENOENT\b/.test(stderr)) {
        break;
      }
    }

    const exitCode = lastExitCode;
    const stderr = lastStderr;

    if (exitCode !== 0) {
      const detail = stderr.trim().slice(-4000);

      if (allMissingBinary) {
        const message =
          "ffmpeg binary was not found at runtime (ENOENT).\n\n" +
          `Tried: ${uniqueFfmpegCandidates.join(", ")}\n` +
          `Resolved ffmpeg-static: ${staticFfmpeg ?? "(none)"}\n` +
          `Mapped ffmpeg-static: ${mappedStaticFfmpeg ?? "(none)"}\n` +
          `FFMPEG_BIN: ${envFfmpeg || "(unset)"}\n\n` +
          "If deploying, ensure `ffmpeg-static` install scripts ran and that the binary is included in the deployment bundle (Next.js output file tracing can be used for this).\n" +
          "If running locally, install system ffmpeg (or set FFMPEG_BIN to a valid path).";

        return new Response(message, {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        });
      }

      return new Response(`Failed to process video.\n\n${detail}`, {
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
    return new Response(`Failed to process video: ${message}`, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  } finally {
    if (cleanupOnReturn) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
