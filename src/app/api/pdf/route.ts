import puppeteer, { type Browser, type HTTPRequest } from "puppeteer";

export const runtime = "nodejs";

const MAX_HTML_CHARS = 500_000;
const DEFAULT_FILENAME = "document.pdf";

function toSafePdfFilename(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_FILENAME;

  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_FILENAME;

  const cleaned = trimmed
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 120);

  if (!cleaned) return DEFAULT_FILENAME;
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

export async function POST(request: Request) {
  let body: { html?: unknown; filename?: unknown };

  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const html = typeof body.html === "string" ? body.html : "";

  if (!html.trim()) {
    return new Response("Missing `html`", { status: 400 });
  }

  if (html.length > MAX_HTML_CHARS) {
    return new Response("`html` is too large", { status: 413 });
  }

  const filename = toSafePdfFilename(body.filename);

  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Block external network requests to reduce SSRF risk.
    await page.setRequestInterception(true);
    page.on("request", (req: HTTPRequest) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("about:")) {
        req.continue().catch(() => {});
        return;
      }
      req.abort().catch(() => {});
    });

    await page.setJavaScriptEnabled(false);

    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(10_000);

    await page.setContent(html, { waitUntil: "load" });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    const pdfBuffer = Buffer.from(pdfBytes);

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(`Failed to generate PDF: ${message}`, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  } finally {
    await browser?.close().catch(() => {});
  }
}
