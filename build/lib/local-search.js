/**
 * Local docs index & search.
 *
 * Scans DOCS_DIR recursively for *.md files, parses their YAML frontmatter
 * (source, fetched_at, version, title, etc.), and provides:
 *
 *   - findBySlug(name)        : exact slug match → Doc
 *   - findBySourceUrl(url)    : frontmatter `source:` match → Doc
 *   - searchByKeywords(query) : lightweight TF-style ranking → Doc[]
 *   - listAll(subdir?)        : list of all indexed docs (optionally filtered)
 *
 * The index is rebuilt on each call (no in-memory caching) because docs/
 * is typically small (< 100 files) and the agent needs to see fresh writes
 * immediately. For large docsets this can be upgraded to an mtime-based
 * incremental index later.
 */
import fs from "node:fs";
import path from "node:path";
import { DOCS_DIR, DOCS_SUBDIRS } from "../config.js";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
/** Parse a single .md file into a Doc. Returns null on read error. */
export function parseDoc(fullPath) {
    let raw;
    try {
        raw = fs.readFileSync(fullPath, "utf8");
    }
    catch {
        return null;
    }
    let frontmatter = {};
    let body = raw;
    const m = FRONTMATTER_RE.exec(raw);
    if (m) {
        frontmatter = parseSimpleYaml(m[1]);
        body = raw.slice(m[0].length);
    }
    const relativePath = path.relative(DOCS_DIR, fullPath).replace(/\\/g, "/");
    const slug = path.basename(fullPath, ".md");
    const subdir = path.dirname(relativePath).replace(/\\/g, "/");
    const title = frontmatter.title ||
        extractFirstH1(body) ||
        slug;
    return { path: fullPath, relativePath, slug, subdir, frontmatter, body, title };
}
/** Walk DOCS_DIR recursively, return all .md paths. */
function listMarkdownFiles(dir) {
    if (!fs.existsSync(dir))
        return [];
    const out = [];
    const stack = [dir];
    while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur)
            continue;
        let entries;
        try {
            entries = fs.readdirSync(cur, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            const full = path.join(cur, e.name);
            if (e.isDirectory()) {
                // Skip hidden dirs like .cache, .git
                if (!e.name.startsWith("."))
                    stack.push(full);
            }
            else if (e.isFile() && e.name.endsWith(".md")) {
                out.push(full);
            }
        }
    }
    return out;
}
/** Build the full index of docs. */
export function indexAll() {
    return listMarkdownFiles(DOCS_DIR)
        .map(parseDoc)
        .filter((d) => d !== null)
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
/** Find a doc by exact slug match within a subdir (or anywhere). */
export function findBySlug(slug, subdir) {
    const lower = slug.toLowerCase();
    return indexAll().find((d) => d.slug.toLowerCase() === lower &&
        (subdir ? d.subdir === subdir : true));
}
/** Find a doc whose frontmatter `source:` matches the given URL. */
export function findBySourceUrl(url) {
    const u = normalizeUrl(url);
    return indexAll().find((d) => d.frontmatter.source && normalizeUrl(d.frontmatter.source) === u);
}
/**
 * Keyword search across all indexed docs.
 *
 * Tokenizes the query, scores each doc by:
 *   - title exact match      : +10
 *   - title partial match    : +5 per token
 *   - slug exact match       : +8
 *   - slug partial match     : +4 per token
 *   - body token frequency   : +1 per occurrence
 *
 * Returns docs sorted by score descending. Limits to top N (default 10).
 */
export function searchByKeywords(query, limit = 10) {
    const tokens = tokenize(query);
    if (tokens.length === 0)
        return [];
    const results = [];
    for (const doc of indexAll()) {
        let score = 0;
        const matchedIn = [];
        const titleLower = doc.title.toLowerCase();
        const slugLower = doc.slug.toLowerCase();
        const bodyLower = doc.body.toLowerCase();
        if (titleLower === query.toLowerCase()) {
            score += 10;
            matchedIn.push("title (exact)");
        }
        if (slugLower === query.toLowerCase()) {
            score += 8;
            matchedIn.push("slug (exact)");
        }
        for (const t of tokens) {
            if (titleLower.includes(t)) {
                score += 5;
                if (!matchedIn.includes("title"))
                    matchedIn.push("title");
            }
            if (slugLower.includes(t)) {
                score += 4;
                if (!matchedIn.includes("slug"))
                    matchedIn.push("slug");
            }
            // Count body occurrences
            let count = 0;
            let idx = bodyLower.indexOf(t);
            while (idx !== -1 && count < 50) {
                count++;
                idx = bodyLower.indexOf(t, idx + t.length);
            }
            if (count > 0) {
                score += Math.min(count, 10);
                if (!matchedIn.includes("body"))
                    matchedIn.push(`body (${count}×)`);
            }
        }
        if (score > 0) {
            results.push({ ...doc, score, matchedIn });
        }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
/** List all docs, optionally filtered by subdir. */
export function listAll(subdir) {
    const all = indexAll();
    if (!subdir)
        return all;
    return all.filter((d) => d.subdir === subdir);
}
// ---- helpers ----------------------------------------------------------------
/**
 * Tiny YAML parser — handles only the flat `key: value` format that
 * docs-writer.ts produces. Values may be quoted ("..." or '...') or bare.
 * Multi-line values are NOT supported (we don't emit them).
 */
function parseSimpleYaml(yaml) {
    const out = {};
    for (const rawLine of yaml.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
            continue;
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
            // Unescape \" \\ within double-quoted strings
            if (rawLine.slice(colonIdx + 1).trim().startsWith('"')) {
                value = value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
            }
        }
        out[key] = value;
    }
    return out;
}
function extractFirstH1(body) {
    const m = /^#\s+(.+?)\s*$/m.exec(body);
    return m?.[1];
}
function tokenize(query) {
    return query
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/i)
        .filter((t) => t.length >= 2);
}
function normalizeUrl(url) {
    let u = url.trim();
    // Strip trailing slash, normalize protocol
    if (u.endsWith("/"))
        u = u.slice(0, -1);
    u = u.replace(/^http:/, "https:");
    // Strip common tracking query params
    try {
        const parsed = new URL(u);
        parsed.search = "";
        u = parsed.toString();
    }
    catch {
        /* leave as-is */
    }
    return u;
}
/** The list of valid subdirs, useful for tool descriptions. */
export const VALID_SUBDIRS = Object.values(DOCS_SUBDIRS);
