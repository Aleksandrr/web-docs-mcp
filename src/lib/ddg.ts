/**
 * DuckDuckGo HTML search backend.
 *
 * Endpoint: https://html.duckduckgo.com/html/
 * Method:   POST with form-encoded `q=...` (GET also works but POST is
 *           more reliable for non-ASCII queries).
 *
 * The HTML is intentionally minimal (no JS) so cheerio parsing is stable.
 * Result URLs are wrapped in a redirect `//duckduckgo.com/l/?uddg=<url>`
 * which we unwrap to recover the real target.
 */
import * as cheerio from "cheerio";
import { USER_AGENT } from "../config.js";

export interface DdgResult {
  title: string;
  url: string;       // unwrapped real URL
  snippet: string;
  displayUrl: string;
}

/**
 * Run a DuckDuckGo HTML search and parse the first N results.
 */
export async function ddgSearch(
  query: string,
  limit: number = 8,
): Promise<DdgResult[]> {
  const body = new URLSearchParams({ q: query, kl: "us-en" }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  let text: string;
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://duckduckgo.com/",
        "User-Agent": USER_AGENT,
      },
      body,
      redirect: "follow",
      signal: controller.signal,
    });
    text = await res.text();
    // finalUrl = res.url; // unused
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `DuckDuckGo search failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearTimeout(timer);

  return parseDdgHtml(text).slice(0, limit);
}

/**
 * Parse a DDG HTML results page into structured results.
 * Exported for testing.
 */
export function parseDdgHtml(html: string, _sourceUrl: string = ""): DdgResult[] {
  const $ = cheerio.load(html);
  const results: DdgResult[] = [];

  // Each organic result is `.result` (or `.web-result`). Skip ads
  // (`.result--ad`) and infoboxes (`.zci`).
  $(".result, .web-result").each((_, el) => {
    const $el = $(el);
    if ($el.hasClass("result--ad") || $el.hasClass("zci")) return;

    const $a = $el.find('a.result__a').first();
    if (!$a.length) return;
    const title = $a.text().trim();
    const wrappedHref = $a.attr("href") || "";
    const url = unwrapDdgUrl(wrappedHref);
    if (!url || !/^https?:\/\//.test(url)) return;

    // Snippet can be inside `a.result__snippet` (older) or
    // `.result__snippet` without an anchor (newer).
    let snippet = "";
    const $snippet = $el.find(".result__snippet").first();
    if ($snippet.length) snippet = $snippet.text().replace(/\s+/g, " ").trim();

    // The visible breadcrumb-style URL shown under the title.
    const displayUrl =
      $el.find(".result__url").first().text().trim() || url;

    results.push({ title, url, snippet, displayUrl });
  });

  return results;
}

/**
 * DDG wraps result URLs in `//duckduckgo.com/l/?uddg=<encoded>&rut=...`.
 * This unwraps to the real target URL. If the input isn't a DDG redirect,
 * it's returned unchanged.
 */
export function unwrapDdgUrl(href: string): string {
  if (!href) return "";
  // Cheerio may have already HTML-decoded entities — but be defensive.
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  // Sometimes DDG returns the raw URL directly.
  if (/^https?:\/\//.test(href)) return href;
  if (href.startsWith("//")) return "https:" + href;
  return href;
}
