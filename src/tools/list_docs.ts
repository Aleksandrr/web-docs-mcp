/**
 * `list_docs` tool — browse and search the local docs/ folder.
 *
 * Three modes:
 *   1. `list`     (no query)    — list every .md file in docs/ (or a subdir)
 *   2. `search`   (query)       — keyword search across all docs/
 *   3. `show`     (path)        — return the full body of a specific file
 *
 * Use cases:
 *   - "What docs do I already have?"  →  list_docs {}
 *   - "Show me everything about React"→  list_docs { query: "react" }
 *   - "Read the express doc"          →  list_docs { path: "libraries/express" }
 *   - "Just list library READMEs"     →  list_docs { subdir: "libraries" }
 */
import { z } from "zod";
import {
  indexAll,
  searchByKeywords,
  listAll,
  parseDoc,
  VALID_SUBDIRS,
  type Doc,
} from "../lib/local-search.js";
import { DOCS_DIR, DOCS_SUBDIRS } from "../config.js";
import path from "node:path";
import fs from "node:fs";

export const listDocsSchema = {
  query: z
    .string()
    .optional()
    .describe(
      "If provided, perform a keyword search across all docs/. " +
      "If omitted, list all docs (or those in `subdir`).",
    ),
  subdir: z
    .enum(VALID_SUBDIRS as unknown as [string, ...string[]])
    .optional()
    .describe(
      "Filter by subdirectory: 'libraries', 'api', 'guides', 'specs', or 'snippets'. " +
      "Ignored when `query` is set (search always scans all subdirs).",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "If provided, return the full body of this specific doc. " +
      "Accepts a relative path like 'libraries/express.md' or just a slug 'express'.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max number of search results or list entries. Default 30."),
};

export interface ListDocsArgs {
  query?: string;
  subdir?: string;
  path?: string;
  limit?: number;
}

export async function listDocs(args: ListDocsArgs): Promise<string> {
  // Mode 3: show a specific doc by path/slug
  if (args.path) {
    return showDocByPath(args.path);
  }

  const limit = args.limit ?? 30;

  // Mode 2: keyword search
  if (args.query) {
    const hits = searchByKeywords(args.query, limit);
    if (hits.length === 0) {
      return [
        `# Local docs search: "${args.query}"`,
        ``,
        `No matches found in any docs/ subfolder.`,
        ``,
        `Available subdirs: ${VALID_SUBDIRS.join(", ")}.`,
        `Use \`web_search\` or \`search_docs\` to look online instead.`,
      ].join("\n");
    }
    const lines: string[] = [
      `# Local docs search: "${args.query}"`,
      ``,
      `Found ${hits.length} match${hits.length === 1 ? "" : "es"} (showing top ${Math.min(hits.length, limit)}):`,
      ``,
    ];
    hits.forEach((h, i) => {
      lines.push(`${i + 1}. **${h.title}** (score: ${h.score})`);
      lines.push(`   Path: \`${h.relativePath}\``);
      if (h.frontmatter.source) lines.push(`   Source: ${h.frontmatter.source}`);
      if (h.frontmatter.version) lines.push(`   Version: ${h.frontmatter.version}`);
      lines.push(`   Matched in: ${h.matchedIn.join(", ")}`);
    });
    lines.push(``);
    lines.push(`---`);
    lines.push(`To read a specific doc, call \`list_docs\` with \`path: "<relative path>"\`.`);
    return lines.join("\n");
  }

  // Mode 1: list all
  const all = args.subdir ? listAll(args.subdir) : indexAll();
  if (all.length === 0) {
    return [
      `# Local docs index`,
      ``,
      `No .md files found under ${DOCS_DIR}.`,
      ``,
      `Expected subdirs: ${VALID_SUBDIRS.join(", ")}.`,
      `Docs are populated when you call \`fetch_url\`, \`lib_docs\`, or \`search_docs\` with \`save: true\`.`,
    ].join("\n");
  }
  const shown = all.slice(0, limit);
  const lines: string[] = [
    `# Local docs index`,
    ``,
    `Total: ${all.length} file${all.length === 1 ? "" : "s"}${args.subdir ? ` in '${args.subdir}/'` : ""}.${shown.length < all.length ? ` Showing first ${shown.length}.` : ""}`,
    ``,
  ];
  // Group by subdir for readability
  const grouped = new Map<string, Doc[]>();
  for (const d of shown) {
    if (!grouped.has(d.subdir)) grouped.set(d.subdir, []);
    grouped.get(d.subdir)!.push(d);
  }
  for (const [sub, items] of [...grouped.entries()].sort()) {
    const subLabel = sub || "(root)";
    lines.push(`## ${subLabel}/`);
    lines.push(``);
    for (const d of items) {
      const meta: string[] = [];
      if (d.frontmatter.version) meta.push(`v${d.frontmatter.version}`);
      if (d.frontmatter.fetched_at) {
        const date = d.frontmatter.fetched_at.slice(0, 10);
        meta.push(`fetched ${date}`);
      }
      lines.push(`- **${d.slug}**${meta.length ? `  ·  _${meta.join(" · ")}_` : ""}  ·  \`${d.relativePath}\``);
    }
    lines.push(``);
  }
  lines.push(`---`);
  lines.push(`To read a specific doc, call \`list_docs\` with \`path: "<relative path>"\` (e.g. \`"libraries/express"\`).`);
  lines.push(`To search by keywords, call \`list_docs\` with \`query: "react hooks"\`.`);
  return lines.join("\n");
}

/** Resolve a user-supplied path/slug to a Doc and return its body. */
function showDocByPath(userPath: string): string {
  // Strip leading "docs/" if user included it, and any .md suffix.
  let rel = userPath.replace(/^\/+/, "").replace(/^docs\//, "").replace(/\.md$/, "");
  // Try as-is first
  const candidates = [
    path.resolve(DOCS_DIR, rel + ".md"),
    path.resolve(DOCS_DIR, rel),
    // Search every subdir by slug
    ...VALID_SUBDIRS.map((s) => path.resolve(DOCS_DIR, s, rel + ".md")),
    ...VALID_SUBDIRS.map((s) => path.resolve(DOCS_DIR, s, rel)),
    // Root-level slug
    path.resolve(DOCS_DIR, path.basename(rel) + ".md"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      const doc = parseDoc(c);
      if (doc) {
        return formatDocBody(doc);
      }
    }
  }
  return [
    `# Doc not found: \`${userPath}\``,
    ``,
    `Tried paths:`,
    ...candidates.map((c) => `- ${c}`),
    ``,
    `Use \`list_docs\` with no args to see all available docs.`,
  ].join("\n");
}

function formatDocBody(doc: Doc): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}  ·  *(from local docs)*`);
  lines.push(``);
  lines.push(`**Path:** \`${doc.relativePath}\``);
  if (doc.frontmatter.source) lines.push(`**Original source:** ${doc.frontmatter.source}`);
  if (doc.frontmatter.fetched_at) lines.push(`**Fetched at:** ${doc.frontmatter.fetched_at}`);
  if (doc.frontmatter.version) lines.push(`**Version:** ${doc.frontmatter.version}`);
  if (doc.frontmatter.content_type) lines.push(`**Content type:** ${doc.frontmatter.content_type}`);
  if (doc.frontmatter.fetched_by) lines.push(`**Fetched by:** ${doc.frontmatter.fetched_by} tool`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(doc.body);
  return lines.join("\n");
}
