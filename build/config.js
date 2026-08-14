/**
 * Configuration for the web-docs MCP server.
 *
 * All settings are read from environment variables with sensible defaults,
 * so Kilo Code (or any other MCP client) can override them in the
 * `mcpServers` entry without changing source code.
 */
import path from "node:path";
import os from "node:os";
function envInt(name, fallback) {
    const v = process.env[name];
    if (!v)
        return fallback;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
}
function envBool(name, fallback) {
    const v = process.env[name];
    if (v === undefined)
        return fallback;
    return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}
/** Directory where fetched markdown docs will be saved when `save: true`. */
export const DOCS_DIR = process.env.DOCS_DIR ?? path.resolve(process.cwd(), "docs");
/**
 * Canonical subdirectory layout under DOCS_DIR.
 * Each tool saves into a specific subdir by default, but the agent can
 * override via the `subdir` argument.
 */
export const DOCS_SUBDIRS = {
    /** Library READMEs / package docs from npm, PyPI, crates, GitHub. */
    libraries: "libraries",
    /** Language & API documentation (MDN, docs.python.org, pkg.go.dev, …). */
    api: "api",
    /** Tutorials, how-to articles, blog posts, guides. */
    guides: "guides",
    /** RFCs, standards, formal specifications. */
    specs: "specs",
    /** Short reference cards, cheat sheets, code snippets. */
    snippets: "snippets",
};
/** Directory for the TTL cache (raw HTML + fetched markdown). */
export const CACHE_DIR = process.env.CACHE_DIR ?? path.resolve(process.cwd(), ".cache", "web-docs");
/** Cache time-to-live in hours. Default: 7 days. */
export const CACHE_TTL_HOURS = envInt("CACHE_TTL_HOURS", 24 * 7);
/** HTTP timeout per request, in milliseconds. */
export const HTTP_TIMEOUT_MS = envInt("HTTP_TIMEOUT_MS", 20_000);
/** Maximum number of HTTP redirects to follow. */
export const HTTP_MAX_REDIRECTS = envInt("HTTP_MAX_REDIRECTS", 5);
/** User-Agent sent to all upstream servers. Some sites block empty/default UAs.
 * IMPORTANT: keep this looking like a real browser — DuckDuckGo HTML silently
 * returns an empty result page for UAs containing bot-like substrings
 * (e.g. "web-docs-mcp", "bot", "crawler", "scraper"). */
export const USER_AGENT = process.env.USER_AGENT ??
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
/** Default number of search results to return from DuckDuckGo. */
export const DEFAULT_SEARCH_LIMIT = envInt("DEFAULT_SEARCH_LIMIT", 8);
/** Hard cap on search results even if the agent asks for more. */
export const MAX_SEARCH_LIMIT = envInt("MAX_SEARCH_LIMIT", 20);
/** Maximum size (in chars) of a single fetched markdown response. */
export const MAX_MD_CHARS = envInt("MAX_MD_CHARS", 60_000);
/** If true, the `save` flag in tools defaults to true (auto-write to docs/).
 * Default changed to true in v1.1 — now that local-first search works,
 * saving aggressively is a net win: subsequent calls return local copies
 * in <5 ms instead of re-fetching. Override with `save: false` per-call. */
export const DEFAULT_SAVE_TO_DOCS = envBool("DEFAULT_SAVE_TO_DOCS", true);
/** If true, the local cache is bypassed (useful for debugging). */
export const DISABLE_CACHE = envBool("DISABLE_CACHE", false);
/** Optional GitHub token to lift the 60 req/hour anonymous rate limit. */
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
/** Pretty-printed banner used on stderr at startup. */
export function banner() {
    return [
        `[web-docs-mcp] docs dir  = ${DOCS_DIR}`,
        `[web-docs-mcp] cache dir = ${CACHE_DIR} (ttl ${CACHE_TTL_HOURS}h, ${DISABLE_CACHE ? "disabled" : "enabled"})`,
        `[web-docs-mcp] http timeout = ${HTTP_TIMEOUT_MS}ms, ua = ${USER_AGENT.slice(0, 40)}…`,
    ].join("\n");
}
export const IS_WINDOWS = os.platform() === "win32";
