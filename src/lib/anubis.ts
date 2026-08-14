/**
 * Anubis anti-bot PoW solver.
 *
 * Anubis (https://github.com/TecharoHQ/anubis) is an open-source proof-of-work
 * gateway used by wiki.altlinux.org and many other sites. The flow is:
 *
 *   1. Client fetches the page, gets HTML with embedded JSON:
 *        <script id="anubis_version">"1.25.0"</script>
 *        <script id="anubis_base_prefix">""</script>
 *        <script id="anubis_challenge">{"challenge":{"id":"<uuid>","randomData":"<hex>"}, "rules":{"algorithm":"fast","difficulty":<N>}}</script>
 *
 *   2. Client computes sha256(randomData + nonce) for nonce = 0, 1, 2, ...
 *      until the hex hash starts with N zeros.
 *
 *   3. Client GETs /<basePrefix>/.within.website/x/cmd/anubis/api/pass-challenge
 *      with query:  ?id=<uuid>&response=<hash>&nonce=<n>&redir=<original>&elapsedTime=<ms>
 *
 *   4. Server validates, sets a cookie (anubis_test...) + JWT, and 302s
 *      to the redir URL. Subsequent requests with the cookie pass through.
 *
 * This module implements that flow in pure Node.js, no headless browser.
 */
import crypto from "node:crypto";
// import { fetchText } from "./fetcher.js"; // unused
import { USER_AGENT } from "../config.js";

export interface AnubisChallenge {
  challenge: { id: string; randomData: string };
  rules: { algorithm: string; difficulty: number };
  basePrefix: string;
  version: string;
}

export interface AnubisSolution {
  nonce: number;
  response: string;       // hex sha256
  elapsedTime: number;    // ms spent computing
  challenge: AnubisChallenge;
}

/** Detect whether an HTML body looks like an Anubis challenge page. */
export function looksLikeAnubis(html: string): boolean {
  return (
    /\/\.within\.website\/x\/cmd\/anubis\//i.test(html) &&
    /anubis_challenge/i.test(html)
  );
}

/**
 * Detect the case where Anubis issues a flat DENY (no challenge issued).
 * This happens when the request matches a `action: DENY` rule — typically
 * because the client IP is on a cloud provider blocklist (Alibaba Cloud,
 * Huawei Cloud, etc.) or the User-Agent is on the AI-scraper denylist.
 *
 * In this state the server returns 200 with `anubis_challenge: null` and
 * an "Access Denied" message. There is no PoW to solve — the only way past
 * is to come from a different IP / use a proxy.
 */
export function isAnubisDeny(html: string): boolean {
  if (!looksLikeAnubis(html)) return false;
  // null challenge = DENY. Real challenges have a JSON object with `challenge.id`.
  const m = /<script[^>]*id=["']anubis_challenge["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return false;
  const body = m[1].trim();
  return body === "null" || body === '""' || body === "''";
}

/** Extract the embedded challenge JSON from the challenge HTML. */
export function parseAnubisChallenge(html: string, _sourceUrl: string): AnubisChallenge | null {
  // The challenge data lives in a <script type="application/json" id="anubis_challenge">...</script>
  // block, but older versions embed it as textContent of a regular script tag.
  // Try JSON-LD script first, then plain text script.
  const patterns = [
    /<script[^>]*id=["']anubis_challenge["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]*type=["']application\/json["'][^>]*id=["']anubis_challenge["'][^>]*>([\s\S]*?)<\/script>/i,
  ];
  let challengeJson: any = null;
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) {
      try {
        challengeJson = JSON.parse(m[1].trim());
        break;
      } catch {
        /* try next pattern */
      }
    }
  }
  if (!challengeJson) return null;

  let basePrefix = "";
  const bpMatch = /<[^>]*id=["']anubis_base_prefix["'][^>]*>([^<]*)</.exec(html);
  if (bpMatch) basePrefix = bpMatch[1].trim().replace(/^["']|["']$/g, "");

  let version = "";
  const vMatch = /<[^>]*id=["']anubis_version["'][^>]*>([^<]*)</.exec(html);
  if (vMatch) version = vMatch[1].trim().replace(/^["']|["']$/g, "");

  if (!challengeJson?.challenge?.id || !challengeJson?.challenge?.randomData) {
    return null;
  }
  if (typeof challengeJson.rules?.difficulty !== "number") {
    return null;
  }

  return {
    challenge: {
      id: challengeJson.challenge.id,
      randomData: challengeJson.challenge.randomData,
    },
    rules: {
      algorithm: challengeJson.rules.algorithm ?? "fast",
      difficulty: challengeJson.rules.difficulty,
    },
    basePrefix,
    version,
  };
}

/**
 * Solve the PoW: find nonce N such that
 *   sha256(randomData + N) starts with `difficulty` zero hex chars.
 *
 * Returns the solution + elapsed time in ms.
 *
 * For difficulty=4 (typical "fast" tier) this is ~65k iterations on average,
 * well under a second on modern hardware. For difficulty=5 it's ~1M iterations,
 * 2-5 seconds. Beyond that gets expensive.
 */
export function solveAnubis(challenge: AnubisChallenge): AnubisSolution {
  const { randomData } = challenge.challenge;
  const difficulty = challenge.rules.difficulty;
  const prefix = "0".repeat(difficulty);
  const start = Date.now();

  let nonce = 0;
  // Tight loop — use Buffer + createHash for speed.
  // RandomData is hex; we concat as ASCII string + decimal nonce, same as
  // Anubis server: fmt.Sprintf("%s%d", challenge, nonce)
  while (true) {
    const input = `${randomData}${nonce}`;
    const hash = crypto.createHash("sha256").update(input, "ascii").digest("hex");
    if (hash.startsWith(prefix)) {
      return {
        nonce,
        response: hash,
        elapsedTime: Date.now() - start,
        challenge,
      };
    }
    nonce++;
    // Sanity guard: at difficulty 6 this could be 16M iterations.
    if (nonce > 100_000_000) {
      throw new Error(
        `Anubis PoW exceeded 100M iterations (difficulty=${difficulty})`,
      );
    }
  }
}

/**
 * Solve the challenge and submit the solution. Returns the cookie header
 * value (e.g. `anubis_test=<uuid>; anubis_jwt=<token>`) to attach to the
 * follow-up request, or `null` if submission failed.
 *
 * The submission URL returns a 302 with Set-Cookie. We capture the cookies
 * by NOT following the redirect automatically, then return them as a
 * single "Cookie:" header value.
 */
export async function solveAndPassChallenge(
  challenge: AnubisChallenge,
  originalUrl: string,
): Promise<string | null> {
  const solution = solveAnubis(challenge);
  const { basePrefix } = challenge;
  const submitUrl = new URL(
    `${basePrefix}/.within.website/x/cmd/anubis/api/pass-challenge`,
    originalUrl,
  );
  submitUrl.searchParams.set("id", challenge.challenge.id);
  submitUrl.searchParams.set("response", solution.response);
  submitUrl.searchParams.set("nonce", String(solution.nonce));
  submitUrl.searchParams.set("redir", originalUrl);
  submitUrl.searchParams.set("elapsedTime", String(solution.elapsedTime));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(submitUrl.toString(), {
      method: "GET",
      redirect: "manual", // we want the Set-Cookie from the 302
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Referer": originalUrl,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `Anubis pass-challenge failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearTimeout(timer);

  // 302 is the happy path; some Anubis versions return 200 with a meta refresh.
  if (res.status >= 400) {
    return null;
  }

  // Collect every Set-Cookie.
  const setCookies: string[] = [];
  // Node fetch exposes set-cookie via headers (array on Node 18+).
  const raw = (res.headers as any).getSetCookie?.() ?? res.headers.get("set-cookie");
  if (Array.isArray(raw)) {
    setCookies.push(...raw);
  } else if (typeof raw === "string" && raw) {
    setCookies.push(...raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/));
  }
  if (setCookies.length === 0) return null;

  // Strip attributes (Path, Domain, HttpOnly, etc.) — keep only name=value pairs.
  const pairs = setCookies
    .map((sc) => sc.split(";")[0].trim())
    .filter((p) => p.includes("="));
  return pairs.join("; ");
}
