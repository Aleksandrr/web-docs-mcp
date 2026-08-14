/**
 * Saves fetched markdown to `<DOCS_DIR>/<slug>.md` with a YAML frontmatter
 * block (source URL, fetch date, content type, tool that produced it).
 *
 * Slug rules:
 *   - lowercase
 *   - non-alphanumerics → `-`
 *   - collapse repeats
 *   - trim leading/trailing `-`
 *   - max 80 chars
 *
 * If a file already exists with the same slug, a numeric suffix is added.
 */
import fs from "node:fs";
import path from "node:path";
import { DOCS_DIR } from "../config.js";
export function slugify(input) {
    return input
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "untitled";
}
function frontmatter(opts) {
    const lines = ["---"];
    lines.push(`title: ${yamlScalar(opts.name)}`);
    if (opts.sourceUrl)
        lines.push(`source: ${yamlScalar(opts.sourceUrl)}`);
    if (opts.contentType)
        lines.push(`content_type: ${yamlScalar(opts.contentType)}`);
    if (opts.tool)
        lines.push(`fetched_by: ${yamlScalar(opts.tool)}`);
    lines.push(`fetched_at: ${new Date().toISOString()}`);
    if (opts.extra) {
        for (const [k, v] of Object.entries(opts.extra)) {
            lines.push(`${k}: ${yamlScalar(v)}`);
        }
    }
    lines.push("---");
    return lines.join("\n");
}
function yamlScalar(s) {
    // Always quote if there's any chance of YAML misinterpretation.
    if (/[:#[]{}&*!|>'"%@`,\n]/.test(s) || /^\s|\s$/.test(s)) {
        return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return s;
}
/**
 * Save a markdown document to disk. Returns the final path.
 * Throws on filesystem errors.
 */
export function saveDoc(markdown, opts) {
    const dir = opts.subdir
        ? path.join(DOCS_DIR, opts.subdir)
        : DOCS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const base = slugify(opts.name);
    const filename = base + ".md";
    const fullPath = path.join(dir, filename);
    const created = !fs.existsSync(fullPath);
    const body = `${frontmatter(opts)}\n\n${markdown.trim()}\n`;
    fs.writeFileSync(fullPath, body, "utf8");
    return { path: fullPath, created, slug: base };
}
