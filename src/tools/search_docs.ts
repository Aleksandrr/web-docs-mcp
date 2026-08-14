/**
 * `search_docs` tool — language / API documentation search.
 *
 * Unlike `web_search` (general web), this tool biases results toward
 * official documentation sources by appending `site:` filters to the
 * DuckDuckGo query.
 *
 * Supported targets:
 *   - mdn          → developer.mozilla.org
 *   - devdocs      → devdocs.io
 *   - readthedocs  → *.readthedocs.io
 *   - reactjs      → react.dev / reactjs.org
 *   - vuejs        → vuejs.org
 *   - angular      → angular.io / angular.dev
 *   - nodejs       → nodejs.org/api
 *   - python       → docs.python.org
 *   - go           → pkg.go.dev / go.dev
 *   - rust         → doc.rust-lang.org / docs.rs
 *   - java         → docs.oracle.com/javase
 *   - kotlin       → kotlinlang.org
 *   - swift        → developer.apple.com/documentation
 *   - cpp          → cppreference.com / cplusplus.com
 *   - typescript   → typescriptlang.org
 *
 * For each target the agent can optionally `fetch_url` the top hit to
 * get the full markdown.
 */
import { z } from "zod";
import { ddgSearch } from "../lib/ddg.js";
import { fetchText } from "../lib/fetcher.js";
import { htmlToMarkdown } from "../lib/html-to-md.js";
import { saveDoc } from "../lib/docs-writer.js";
import { searchByKeywords } from "../lib/local-search.js";
import { DEFAULT_SAVE_TO_DOCS, MAX_MD_CHARS, DOCS_SUBDIRS } from "../config.js";

export const TARGETS = [
  "mdn", "devdocs", "readthedocs", "reactjs", "vuejs", "angular",
  "nodejs", "python", "go", "rust", "java", "kotlin", "swift", "cpp",
  "typescript", "auto",
] as const;
export type Target = (typeof TARGETS)[number];

const SITE_MAP: Record<Exclude<Target, "auto">, string> = {
  mdn: "developer.mozilla.org",
  devdocs: "devdocs.io",
  readthedocs: "readthedocs.io",
  reactjs: "react.dev OR reactjs.org",
  vuejs: "vuejs.org",
  angular: "angular.io OR angular.dev",
  nodejs: "nodejs.org",
  python: "docs.python.org",
  go: "pkg.go.dev OR go.dev",
  rust: "doc.rust-lang.org OR docs.rs",
  java: "docs.oracle.com",
  kotlin: "kotlinlang.org",
  swift: "developer.apple.com",
  cpp: "cppreference.com OR cplusplus.com",
  typescript: "typescriptlang.org",
};

export const searchDocsSchema = {
  query: z
    .string()
    .min(1)
    .describe("What to look up, e.g. `Array.prototype.map` or `asyncio.gather`."),
  target: z
    .enum(TARGETS)
    .optional()
    .describe(
      "Which documentation site to bias toward. Default 'auto' (tries MDN first if query looks JS/Web, otherwise general docs).",
    ),
  fetch_top: z
    .boolean()
    .optional()
    .describe(
      "If true, fetch the top hit and return its full markdown instead of just the result list.",
    ),
  save: z
    .boolean()
    .optional()
    .describe("If true (and fetch_top is true), write markdown to docs/api/<slug>.md."),
  local_only: z
    .boolean()
    .optional()
    .describe(
      "If true, ONLY search local docs/ folder — never hit the network. Returns 'not found' if no local matches. Default false.",
    ),
  skip_local: z
    .boolean()
    .optional()
    .describe(
      "If true, skip the local docs/ lookup and go straight to web search. Default false.",
    ),
};

export interface SearchDocsArgs {
  query: string;
  target?: Target;
  fetch_top?: boolean;
  save?: boolean;
  local_only?: boolean;
  skip_local?: boolean;
}

export async function searchDocs(args: SearchDocsArgs): Promise<string> {
  const target = args.target ?? "auto";

  // ---- Step 0: LOCAL-FIRST search ----------------------------------------
  // Search across ALL subdirs (libraries, api, guides, specs, snippets).
  // If we get a strong match (score >= 8), return it directly. If we get
  // weaker matches, list them as candidates BEFORE going to the web.
  if (!args.skip_local) {
    const localHits = searchByKeywords(args.query, 5);
    if (localHits.length > 0) {
      const top = localHits[0];
      if (args.local_only) {
        // Hard requirement: local only. Return whatever we have.
        return formatLocalSearchResults(args.query, localHits, true);
      }
      if (top.score >= 12) {
        // Strong hit — return it immediately without hitting the network.
        return formatLocalSearchResults(args.query, localHits, true);
      }
      // Weak hits — show them as a preamble, then continue to web search.
      const preamble = formatLocalSearchResults(args.query, localHits, false);
      const webResult = await webSearchPhase(args, target);
      return preamble + "\n\n---\n\n" + webResult;
    }
    if (args.local_only) {
      return [
        `# Local docs search: "${args.query}"`,
        ``,
        `No matches found in any docs/ subfolder.`,
        ``,
        `Available subdirs: libraries, api, guides, specs, snippets.`,
        `Try removing \`local_only: true\` to also search the web.`,
      ].join("\n");
    }
  }

  return webSearchPhase(args, target);
}

/** Phase 2: web search via DuckDuckGo + optional fetch_top. */
async function webSearchPhase(args: SearchDocsArgs, target: Target): Promise<string> {
  const sites = pickSites(target, args.query);
  const q = sites.length > 0
    ? `${args.query} (${sites.map((s) => `site:${s}`).join(" OR ")})`
    : args.query;

  const results = await ddgSearch(q, 6);

  if (results.length === 0) {
    return `No documentation results for: ${args.query} (target=${target})\nTry \`web_search\` for a broader query.`;
  }

  if (!args.fetch_top) {
    const lines = [
      `# Docs search: "${args.query}" (target=${target})`,
      `Top ${results.length} matches:`,
      ``,
    ];
    results.forEach((r, i) => {
      lines.push(`${i + 1}. **${r.title}**`);
      lines.push(`   ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
    });
    lines.push(``, `Set \`fetch_top: true\` to retrieve the full markdown of result #1.`);
    return lines.join("\n");
  }

  // fetch_top: pull the first result and convert.
  const top = results[0];
  const res = await fetchText(top.url);
  if (res.status >= 400) {
    return `Could not fetch top result: HTTP ${res.status} for ${top.url}\n\nFalling back to result list:\n${results
      .map((r, i) => `${i + 1}. ${r.title} — ${r.url}`)
      .join("\n")}`;
  }
  let md = /text\/html/i.test(res.contentType)
    ? htmlToMarkdown(res.text)
    : "```\n" + res.text + "\n```\n";
  if (md.length > MAX_MD_CHARS) {
    md = md.slice(0, MAX_MD_CHARS) + `\n\n…[truncated, original ${md.length} chars]…`;
  }

  const header = [
    `# ${top.title}`,
    `**Source:** ${top.url}`,
    `**Target:** ${target}`,
    `**Fetched:** ${new Date().toISOString()}`,
    `---`,
    ``,
  ].join("\n");

  const full = header + md;
  if ((args.save ?? DEFAULT_SAVE_TO_DOCS) && args.fetch_top) {
    const r = saveDoc(full, {
      name: top.title || args.query,
      subdir: DOCS_SUBDIRS.api,
      sourceUrl: top.url,
      contentType: res.contentType,
      tool: "search_docs",
    });
    return full + `\n\n**Saved to:** \`${r.path}\``;
  }
  return full;
}

/** Format local search hits as a tool response block. */
function formatLocalSearchResults(
  query: string,
  hits: Array<ReturnType<typeof searchByKeywords>[number]>,
  returnTopBody: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# Local docs match: "${query}"`);
  lines.push(``);
  lines.push(`Found ${hits.length} local match${hits.length === 1 ? "" : "es"}:`);
  lines.push(``);
  hits.forEach((h, i) => {
    lines.push(`${i + 1}. **${h.title}** (score: ${h.score})`);
    lines.push(`   Path: \`${h.relativePath}\``);
    if (h.frontmatter.source) lines.push(`   Source: ${h.frontmatter.source}`);
    lines.push(`   Matched in: ${h.matchedIn.join(", ")}`);
  });
  if (returnTopBody && hits[0]) {
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`# ${hits[0].title}  ·  *(from local docs)*`);
    lines.push(``);
    lines.push(`**Local path:** \`${hits[0].relativePath}\``);
    if (hits[0].frontmatter.source) {
      lines.push(`**Original source:** ${hits[0].frontmatter.source}`);
    }
    if (hits[0].frontmatter.fetched_at) {
      lines.push(`**Fetched at:** ${hits[0].frontmatter.fetched_at}`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(hits[0].body);
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Loaded from local docs. Pass \`skip_local: true\` to force a fresh web fetch.*`);
  }
  return lines.join("\n");
}

function pickSites(target: Target, query: string): string[] {
  if (target !== "auto") return SITE_MAP[target].split(" OR ");
  // Auto: MDN for web-ish queries, otherwise the big general docs sites.
  const webHit = /\b(array|object|fetch|promise|css|html|dom|javascript|js|window|document|canvas|webgl|service worker)\b/i.test(
    query,
  );
  if (webHit) return ["developer.mozilla.org"];
  return [
    "developer.mozilla.org",
    "docs.python.org",
    "pkg.go.dev",
    "doc.rust-lang.org",
    "nodejs.org",
    "typescriptlang.org",
    "react.dev",
    "vuejs.org",
  ];
}
