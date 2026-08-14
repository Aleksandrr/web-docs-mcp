/**
 * Tiny TTL cache for upstream HTTP responses (DDG HTML pages, raw fetched
 * pages, GitHub READMEs, npm registry JSON, etc.).
 *
 * Stored as flat files under CACHE_DIR, keyed by a SHA-1 of the cache key.
 * Each entry is a JSON envelope: `{ expiresAt, value }`.
 *
 * We deliberately avoid SQLite / leveldb to keep the runtime dependency
 * surface minimal — the cache is a perf optimization, not a source of truth.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CACHE_DIR, CACHE_TTL_HOURS, DISABLE_CACHE } from "../config.js";

const TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;

function keyHash(key: string): string {
  return crypto.createHash("sha1").update(key).digest("hex");
}

function entryPath(key: string): string {
  return path.join(CACHE_DIR, keyHash(key) + ".json");
}

/** Ensure the cache directory exists. Idempotent. */
export function ensureCacheDir(): void {
  if (DISABLE_CACHE) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/** Read a cached value. Returns `undefined` on miss / expiry / error. */
export function cacheGet<T>(key: string): T | undefined {
  if (DISABLE_CACHE) return undefined;
  let raw: string;
  try {
    raw = fs.readFileSync(entryPath(key), "utf8");
  } catch {
    return undefined;
  }
  let parsed: { expiresAt: number; value: T };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed.expiresAt !== "number") return undefined;
  if (Date.now() > parsed.expiresAt) {
    // Stale — best-effort delete.
    try {
      fs.unlinkSync(entryPath(key));
    } catch {
      /* ignore */
    }
    return undefined;
  }
  return parsed.value as T;
}

/** Write a value to the cache with the standard TTL. */
export function cacheSet<T>(key: string, value: T): void {
  if (DISABLE_CACHE) return;
  ensureCacheDir();
  const envelope = { expiresAt: Date.now() + TTL_MS, value };
  try {
    fs.writeFileSync(entryPath(key), JSON.stringify(envelope), "utf8");
  } catch {
    /* cache is best-effort */
  }
}

/** Compute a cache key from a method + URL (and optional body hash). */
export function urlCacheKey(method: string, url: string, extra: string = ""): string {
  return `${method.toUpperCase()} ${url} ${extra}`.trim();
}
