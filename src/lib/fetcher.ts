/**
 * HTTP fetcher with caching, timeout, redirect handling, and a realistic
 * User-Agent. Uses Node's built-in `fetch` (Node 18+).
 *
 * All upstream calls in this server go through here, so we have a single
 * chokepoint for rate-limit politeness, Anubis PoW bypass, and retry logic.
 */
import { HTTP_MAX_REDIRECTS, HTTP_TIMEOUT_MS, USER_AGENT } from "../config.js";
import { cacheGet, cacheSet, urlCacheKey } from "./cache.js";
import {
  looksLikeAnubis,
  isAnubisDeny,
  parseAnubisChallenge,
  solveAndPassChallenge,
} from "./anubis.js";

export interface FetchOptions {
  /** Bypass the local cache (still writes back to it). */
  noCache?: boolean;
  /** Extra headers to send. */
  headers?: Record<string, string>;
  /** Optional Accept header shortcut. */
  accept?: string;
  /** If true, disable Anubis PoW bypass (return the challenge page as-is). */
  noAnubis?: boolean;
}

export interface FetchResult {
  url: string;       // final URL after redirects
  status: number;
  contentType: string;
  text: string;
  fromCache: boolean;
  /** True if we had to solve an Anubis challenge to get this content. */
  anubisBypassed?: boolean;
  /** True if Anubis flat-out denied us (no PoW issued) — see `anubisNote`. */
  anubisDenied?: boolean;
  /** Human-readable explanation when Anubis could not be bypassed. */
  anubisNote?: string;
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
};

/**
 * Fetch a URL as text. Follows redirects up to HTTP_MAX_REDIRECTS.
 * Results are cached by `GET <url>` for CACHE_TTL_HOURS.
 *
 * If the response looks like an Anubis PoW challenge, this transparently
 * solves the challenge and re-fetches the original URL with the resulting
 * cookie. Override with `opts.noAnubis: true` to get the raw challenge page.
 */
export async function fetchText(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const cacheKey = urlCacheKey("GET", url, opts.accept ?? "");
  if (!opts.noCache) {
    const cached = cacheGet<FetchResult>(cacheKey);
    if (cached) return { ...cached, fromCache: true };
  }

  const result = await rawFetch(url, opts);

  // Detect Anubis challenge and try to bypass it.
  if (
    !opts.noAnubis &&
    result.status === 200 &&
    /text\/html/i.test(result.contentType) &&
    looksLikeAnubis(result.text)
  ) {
    // Case A: flat DENY (no PoW issued). Typical causes:
    //   - Client IP is on a cloud-provider blocklist (Alibaba, Huawei, …)
    //   - User-Agent matches an AI-scraper deny rule
    // Nothing we can do here — surface a clear note to the agent.
    if (isAnubisDeny(result.text)) {
      const denied: FetchResult = {
        ...result,
        anubisDenied: true,
        anubisNote:
          "Anubis returned a flat DENY (no PoW challenge was issued). " +
          "This usually means your IP is on a cloud-provider blocklist " +
          "(Alibaba Cloud, Huawei Cloud, etc.) or your User-Agent matches " +
          "an AI-scraper deny rule. Try from a residential IP, set a " +
          "different USER_AGENT env var, or use a different source.",
      };
      // Don't cache denies — they may be transient.
      return denied;
    }

    // Case B: real PoW challenge. Solve it and retry.
    const challenge = parseAnubisChallenge(result.text, result.url);
    if (challenge) {
      try {
        const cookie = await solveAndPassChallenge(challenge, result.url);
        if (cookie) {
          // Re-fetch the original URL with the bypass cookie attached.
          const retry = await rawFetch(url, {
            ...opts,
            noCache: true,
            headers: { ...(opts.headers ?? {}), Cookie: cookie },
          });
          // Only accept the retry if it's NOT another challenge page.
          if (
            retry.status === 200 &&
            !looksLikeAnubis(retry.text)
          ) {
            const bypassed: FetchResult = {
              ...retry,
              anubisBypassed: true,
            };
            if (!opts.noCache) cacheSet(cacheKey, bypassed);
            return bypassed;
          }
        }
      } catch {
        /* fall through to return the original challenge page */
      }
    }
  }

  if (!opts.noCache && result.status < 400) {
    cacheSet(cacheKey, result);
  }
  return result;
}

/**
 * Low-level fetch — single URL, manual redirects, no Anubis bypass.
 * Used internally and by anubis.ts (via fetchText with noAnubis: true).
 */
async function rawFetch(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...(opts.accept ? { Accept: opts.accept } : {}),
    ...(opts.headers ?? {}),
  };

  let currentUrl = url;
  let redirects = 0;
  let response: Response | undefined;

  while (redirects <= HTTP_MAX_REDIRECTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(
        `fetch failed (${currentUrl}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    clearTimeout(timer);

    // Manual redirect handling so we can keep the final URL.
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      if (!loc) break;
      currentUrl = new URL(loc, currentUrl).toString();
      redirects++;
      continue;
    }
    break;
  }

  if (!response) {
    throw new Error(`fetch failed (${url}): no response`);
  }

  const text = await response.text();
  return {
    url: currentUrl,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
    fromCache: false,
  };
}

/**
 * Fetch a URL and return JSON. Throws if the body cannot be parsed.
 */
export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOptions = {},
): Promise<T> {
  const res = await fetchText(url, { ...opts, accept: "application/json" });
  try {
    return JSON.parse(res.text) as T;
  } catch (err) {
    throw new Error(
      `fetchJson: could not parse ${url} as JSON (${res.status}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
