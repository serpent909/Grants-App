/**
 * Shared page fetching module with Tavily → Playwright → raw fetch hierarchy.
 * Handles retries, rate limiting, and content truncation.
 */

import { tavily } from '@tavily/core';

const UA = 'Mozilla/5.0 (compatible; GrantSearchBot/1.0)';
const FETCH_TIMEOUT = 15_000;
const DEFAULT_CHAR_LIMIT = 80_000;

export type FetchMethod = 'tavily' | 'playwright' | 'fetch';

export interface FetchResult {
  content: string;
  method: FetchMethod;
  url: string;
}

// ─── Tavily Client Singleton ────────────────────────────────────────────────

let tavilyClient: ReturnType<typeof tavily> | null = null;

function getTavilyClient(): ReturnType<typeof tavily> {
  if (!tavilyClient) {
    if (!process.env.TAVILY_API_KEY) {
      throw new Error('TAVILY_API_KEY env var is required for Tavily extraction');
    }
    tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });
  }
  return tavilyClient;
}

// ─── Tavily Extract ─────────────────────────────────────────────────────────

export async function tavilyExtract(
  url: string,
  maxChars = DEFAULT_CHAR_LIMIT,
): Promise<string | null> {
  try {
    const tc = getTavilyClient();
    const result = await tc.extract([url]);
    const content = result?.results?.[0]?.rawContent || '';
    return content.slice(0, maxChars) || null;
  } catch {
    return null;
  }
}

// ─── Tavily Search ──────────────────────────────────────────────────────────

export interface TavilySearchResult {
  url: string;
  title: string;
  content: string;
}

export async function tavilySearch(
  query: string,
  maxResults = 5,
): Promise<TavilySearchResult[]> {
  try {
    const tc = getTavilyClient();
    const result = await tc.search(query, { maxResults });
    return (result?.results || []).map(r => ({
      url: r.url,
      title: r.title,
      content: r.content || '',
    }));
  } catch {
    return [];
  }
}

// ─── Raw Fetch ──────────────────────────────────────────────────────────────

export async function rawFetch(
  url: string,
  maxChars = DEFAULT_CHAR_LIMIT,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, maxChars) || null;
  } catch {
    return null;
  }
}

// ─── HTTP HEAD Check ────────────────────────────────────────────────────────

export interface HeadCheckResult {
  url: string;
  status: number | null;
  alive: boolean;
  error?: string;
}

export async function headCheck(url: string): Promise<HeadCheckResult> {
  const result = await _headCheckSingle(url);
  if (result.alive) return result;

  // If the original URL failed, try the www/non-www alternate
  try {
    const parsed = new URL(url);
    const altHost = parsed.hostname.startsWith('www.')
      ? parsed.hostname.slice(4)
      : `www.${parsed.hostname}`;
    parsed.hostname = altHost;
    const altUrl = parsed.toString();

    const altResult = await _headCheckSingle(altUrl);
    if (altResult.alive) return altResult;
  } catch { /* invalid URL — skip */ }

  return result;
}

async function _headCheckSingle(url: string): Promise<HeadCheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    // 404, 410 = dead; 403, 5xx = possibly blocked (not dead)
    const dead = res.status === 404 || res.status === 410;
    return { url, status: res.status, alive: !dead };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // ENOTFOUND = domain doesn't exist
    const domainDead = msg.includes('ENOTFOUND') || msg.includes('getaddrinfo');
    return { url, status: null, alive: !domainDead, error: msg.slice(0, 100) };
  }
}

// ─── Unified Fetcher (hierarchy: Tavily → Playwright → raw fetch) ───────────

export interface FetchPageOptions {
  /** Prefer Tavily even if raw fetch might work (default: true) */
  preferTavily?: boolean;
  /** Maximum characters to return */
  maxChars?: number;
  /** Skip Playwright fallback */
  skipPlaywright?: boolean;
}

/**
 * Fetch page content using the best available method.
 * Hierarchy: Tavily → Playwright → raw fetch.
 *
 * Playwright is only attempted if the `playwright` package is available and
 * skipPlaywright is not set. Pipeline scripts that need Playwright should
 * import it themselves and pass content directly.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchResult | null> {
  const { preferTavily = true, maxChars = DEFAULT_CHAR_LIMIT, skipPlaywright = true } = options;

  // 1. Tavily (handles 403s, JS rendering)
  if (preferTavily && process.env.TAVILY_API_KEY) {
    const content = await tavilyExtract(url, maxChars);
    if (content) return { content, method: 'tavily', url };
  }

  // 2. Raw fetch fallback (for simple HTML pages)
  const content = await rawFetch(url, maxChars);
  if (content) return { content, method: 'fetch', url };

  return null;
}

// ─── Playwright Fetch ──────────────────────────────────────────────────────

/**
 * Fetch page content using Playwright (headless Chromium).
 * Requires `playwright` to be installed.
 * Returns cleaned text content + links, or null if fetch fails.
 */
export async function playwrightFetch(
  url: string,
  maxChars = DEFAULT_CHAR_LIMIT,
): Promise<FetchResult | null> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    try {
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
      } catch {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
          await page.waitForTimeout(2000);
        } catch {
          return null;
        }
      }

      // Remove noise elements
      await page.evaluate(() => {
        const selectors = ['nav', 'header', 'footer', 'script', 'style', 'noscript',
                           '.cookie-banner', '#cookie-consent', '[role="banner"]', '[role="navigation"]'];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => el.remove());
        }
      });

      const text = await page.evaluate(() => {
        const body = document.querySelector('body');
        return body?.innerText || body?.textContent || '';
      });

      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => `${(a as HTMLAnchorElement).textContent?.trim() || ''}: ${(a as HTMLAnchorElement).href}`)
          .filter(l => l.length > 3)
          .join('\n');
      });

      const combined = `${text}\n\n--- Links on page ---\n${links}`;
      const content = combined.slice(0, maxChars) || null;
      return content ? { content, method: 'playwright', url } : null;
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
  } catch {
    return null;
  }
}

/**
 * Fetch page with Playwright using an existing browser instance (for batch use).
 * More efficient than playwrightFetch() when processing many pages.
 */
export async function playwrightFetchWithBrowser(
  url: string,
  browser: import('playwright').Browser,
  maxChars = DEFAULT_CHAR_LIMIT,
): Promise<FetchResult | null> {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  try {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
    } catch {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        await page.waitForTimeout(2000);
      } catch {
        return null;
      }
    }

    await page.evaluate(() => {
      const selectors = ['nav', 'header', 'footer', 'script', 'style', 'noscript',
                         '.cookie-banner', '#cookie-consent', '[role="banner"]', '[role="navigation"]'];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => el.remove());
      }
    });

    const text = await page.evaluate(() => {
      const body = document.querySelector('body');
      return body?.innerText || body?.textContent || '';
    });

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => `${(a as HTMLAnchorElement).textContent?.trim() || ''}: ${(a as HTMLAnchorElement).href}`)
        .filter(l => l.length > 3)
        .join('\n');
    });

    const combined = `${text}\n\n--- Links on page ---\n${links}`;
    const content = combined.slice(0, maxChars) || null;
    return content ? { content, method: 'playwright', url } : null;
  } catch {
    return null;
  } finally {
    await page.close();
    await context.close();
  }
}

// ─── PDF Text Extraction ──────────────────────────────────────────────────

/**
 * Fetch a PDF from a URL and extract its text content.
 * Falls back to GPT-4o-mini Vision OCR for scanned-image PDFs.
 * Returns null on failure or if content is too short.
 */
export async function fetchPdfText(url: string, maxChars = 15_000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('pdf') && !url.toLowerCase().endsWith('.pdf')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 10 * 1024 * 1024) return null; // Skip PDFs > 10MB

    // Dynamic import to avoid requiring pdf-parse when not needed
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    const text = result.text?.trim() || '';

    // If pdf-parse got meaningful text, use it
    if (text.length >= 50) return text.slice(0, maxChars);

    // Scanned image — fall back to GPT-4o-mini Vision OCR
    return await ocrPdfWithVision(buffer, 5, maxChars);
  } catch {
    return null;
  }
}

/**
 * OCR a scanned PDF using GPT-4o-mini Vision.
 * Renders pages to images and sends to GPT for text extraction.
 */
async function ocrPdfWithVision(
  buffer: Buffer,
  maxPages = 5,
  maxChars = 15_000,
): Promise<string | null> {
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('canvas');

    const doc = await getDocument({ data: buffer }).promise;
    const numPages = Math.min(doc.numPages, maxPages);
    const images: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      await (page.render as any)({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL('image/png'));
    }

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI();
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all text from these scanned PDF pages. Return the text content only, preserving structure.' },
          ...images.map(img => ({
            type: 'image_url' as const,
            image_url: { url: img, detail: 'low' as const },
          })),
        ],
      }],
    });

    const ocrText = result.choices[0]?.message?.content?.slice(0, maxChars) || null;
    if (ocrText) console.log(`  📄 OCR fallback for PDF (${ocrText.length} chars)`);
    return ocrText;
  } catch {
    // pdfjs-dist or canvas not installed — skip OCR
    return null;
  }
}

// ─── Fetch With Fallback ───────────────────────────────────────────────────

/**
 * Fetch page content using the best available method with full fallback chain:
 * raw fetch → Tavily → Playwright.
 *
 * Unlike fetchPage(), this tries raw fetch FIRST (free), then escalates.
 */
export async function fetchWithFallback(
  url: string,
  maxChars = DEFAULT_CHAR_LIMIT,
): Promise<FetchResult | null> {
  // 1. Raw fetch first (free)
  const raw = await rawFetch(url, maxChars);
  if (raw && raw.trim().length > 200) return { content: raw, method: 'fetch', url };

  // 2. Tavily (handles 403s, JS rendering)
  if (process.env.TAVILY_API_KEY) {
    const tavily = await tavilyExtract(url, maxChars);
    if (tavily && tavily.trim().length > 200) return { content: tavily, method: 'tavily', url };
  }

  // 3. Playwright (heavy JS, last resort) — only if available
  try {
    const pw = await playwrightFetch(url, maxChars);
    if (pw) return pw;
  } catch {
    // Playwright not installed
  }

  return null;
}

// ─── Multi-Page Fetch ───────────────────────────────────────────────────────

/**
 * Fetch multiple pages and concatenate their content.
 * Used for multi-page extraction (grant page + guidelines + form page).
 */
export async function fetchMultiplePages(
  urls: string[],
  options: { mainCharLimit?: number; subCharLimit?: number } = {},
): Promise<{ combined: string; pages: FetchResult[]; failedUrls: string[] }> {
  const { mainCharLimit = 80_000, subCharLimit = 15_000 } = options;
  const pages: FetchResult[] = [];
  const failedUrls: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    const limit = i === 0 ? mainCharLimit : subCharLimit;
    const result = await fetchPage(urls[i], { maxChars: limit });
    if (result) {
      pages.push(result);
    } else {
      failedUrls.push(urls[i]);
    }
  }

  const combined = pages
    .map((p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.content}`)
    .join('\n\n');

  return { combined, pages, failedUrls };
}
