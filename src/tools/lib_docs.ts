/**
 * `lib_docs` tool — fetch documentation for a library by name.
 *
 * Strategy (in order, first hit wins):
 *   0. **LOCAL**         →  docs/libraries/<slug>.md
 *      If a doc with this slug already exists in the local docs/ folder,
 *      return it immediately WITHOUT hitting the network. Override with
 *      `refresh: true` to force a fresh fetch.
 *
 *   1. npm registry  →  package.json + README
 *      URL: https://registry.npmjs.org/<name>
 *      README is in `readme` field, or fetched from GitHub repo.
 *
 *   2. PyPI          →  project info JSON
 *      URL: https://pypi.org/pypi/<name>/json
 *
 *   3. crates.io     →  Rust crates
 *      URL: https://crates.io/api/v1/crates/<name>
 *      README: fetched from docs.rs/<name>
 *
 *   4. pkg.go.dev    →  Go modules (just metadata + link)
 *
 *   5. GitHub repo   →  repo info + README
 *      URL: https://api.github.com/repos/<owner>/<repo>
 *      README: raw.githubusercontent.com/<owner>/<repo>/<default>/README.md
 *
 * If the user passes a `name` like `react` we try npm first; if they pass
 * `owner/repo` we go straight to GitHub.
 */
import { z } from "zod";
import { fetchJson, fetchText } from "../lib/fetcher.js";
import { saveDoc } from "../lib/docs-writer.js";
import { findBySlug } from "../lib/local-search.js";
import { DEFAULT_SAVE_TO_DOCS, GITHUB_TOKEN, DOCS_SUBDIRS } from "../config.js";

export const libDocsSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      "Library name. Examples: `react`, `express`, `numpy`, `serde`, `github.com/gin-gonic/gin`, `owner/repo`.",
    ),
  ecosystem: z
    .enum(["auto", "npm", "pypi", "crates", "go", "github"])
    .optional()
    .describe(
      "Hint which registry to consult. Default 'auto' — tries npm, then pypi, then crates, then GitHub.",
    ),
  version: z
    .string()
    .optional()
    .describe(
      "Specific version to fetch (npm/PyPI only). Defaults to latest.",
    ),
  save: z
    .boolean()
    .optional()
    .describe(
      "If true, also write markdown to docs/libraries/<name>.md. Default: see DEFAULT_SAVE_TO_DOCS env.",
    ),
  refresh: z
    .boolean()
    .optional()
    .describe(
      "If true, skip the local docs/ lookup and force a fresh fetch from upstream. Useful when you suspect the cached doc is stale.",
    ),
};

export interface LibDocsArgs {
  name: string;
  ecosystem?: "auto" | "npm" | "pypi" | "crates" | "go" | "github";
  version?: string;
  save?: boolean;
  refresh?: boolean;
}

interface FetchedDoc {
  name: string;
  version?: string;
  description?: string;
  homepage?: string;
  repository?: string;
  readme: string;
  source: string;        // which registry produced this
  sourceUrl: string;     // URL of the registry call
}

export async function libDocs(args: LibDocsArgs): Promise<string> {
  const eco = args.ecosystem ?? "auto";
  const isOwnerRepo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.name);
  const isGoPath = args.name.startsWith("github.com/") ||
    args.name.startsWith("golang.org/");

  // ---- Step 0: LOCAL-FIRST lookup ----------------------------------------
  // Try several candidate slugs since the user might pass "owner/repo",
  // "github.com/x/y", or just "name" — all of which should match a doc
  // previously saved under docs/libraries/<something>.md.
  if (!args.refresh) {
    const candidates = candidateSlugs(args.name);
    for (const slug of candidates) {
      const local = findBySlug(slug, DOCS_SUBDIRS.libraries);
      if (local) {
        return formatLocalDoc(local);
      }
    }
    // Also try matching by frontmatter `title` or repository name.
    // (cheap way to find owner/repo docs when user types just the repo name)
  }

  // ---- Steps 1-5: network fallback ---------------------------------------
  let doc: FetchedDoc | undefined;

  if (eco === "npm" || (eco === "auto" && !isOwnerRepo && !isGoPath)) {
    doc = await tryNpm(args.name, args.version).catch(() => undefined);
  }
  if (!doc && (eco === "pypi" || (eco === "auto" && !isOwnerRepo && !isGoPath))) {
    doc = await tryPypi(args.name, args.version).catch(() => undefined);
  }
  if (!doc && (eco === "crates" || (eco === "auto" && !isOwnerRepo && !isGoPath))) {
    doc = await tryCrates(args.name).catch(() => undefined);
  }
  if (!doc && (eco === "go" || (eco === "auto" && isGoPath))) {
    doc = await tryGo(args.name).catch(() => undefined);
  }
  if (!doc && (eco === "github" || (eco === "auto" && isOwnerRepo))) {
    const [owner, repo] = args.name.split("/");
    doc = await tryGithub(owner, repo).catch(() => undefined);
  }
  if (!doc && eco === "auto") {
    // Last resort: try as GitHub owner/repo even if regex didn't match.
    const parts = args.name.split("/");
    if (parts.length === 2) {
      doc = await tryGithub(parts[0], parts[1]).catch(() => undefined);
    }
  }

  if (!doc) {
    return [
      `# Library docs lookup failed: \`${args.name}\``,
      ``,
      `Tried: ${eco === "auto" ? "local docs → npm → pypi → crates → go → github" : "local docs → " + eco}.`,
      `Suggestions:`,
      `- Use \`web_search\` with query \`${args.name} documentation\`.`,
      `- Use \`fetch_url\` with the exact docs URL if you know it.`,
      `- Pass \`ecosystem\` explicitly to disambiguate.`,
    ].join("\n");
  }

  const header = [
    `# ${doc.name}${doc.version ? ` v${doc.version}` : ""}`,
    ``,
    `**Source:** ${doc.source}`,
    `**URL:** ${doc.sourceUrl}`,
    doc.description ? `**Description:** ${doc.description}` : "",
    doc.homepage ? `**Homepage:** ${doc.homepage}` : "",
    doc.repository ? `**Repository:** ${doc.repository}` : "",
    `**Fetched:** ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
  ].filter(Boolean).join("\n");

  const md = header + doc.readme;

  let savedNote = "";
  if (args.save ?? DEFAULT_SAVE_TO_DOCS) {
    const r = saveDoc(md, {
      name: doc.name,
      subdir: DOCS_SUBDIRS.libraries,
      sourceUrl: doc.sourceUrl,
      contentType: "text/markdown",
      tool: "lib_docs",
      extra: doc.version ? { version: doc.version } : undefined,
    });
    savedNote = `\n\n**Saved to:** \`${r.path}\``;
  }

  return md + savedNote;
}

/** Generate candidate slug names for a library identifier. */
function candidateSlugs(name: string): string[] {
  const out = new Set<string>();
  // Plain name
  out.add(name.toLowerCase());
  // owner/repo → just repo
  const slashParts = name.split("/");
  if (slashParts.length >= 2) {
    out.add(slashParts[slashParts.length - 1].toLowerCase());
  }
  // github.com/owner/repo → just repo
  if (name.startsWith("github.com/")) {
    const parts = name.split("/");
    if (parts.length >= 3) out.add(parts[2].toLowerCase());
  }
  // Strip @scope for npm (e.g. @babel/core → babel-core, but also try core)
  if (name.startsWith("@")) {
    const m = /^@([^/]+)\/(.+)$/.exec(name);
    if (m) {
      out.add(`${m[1]}-${m[2]}`.toLowerCase());
      out.add(m[2].toLowerCase());
    }
  }
  return Array.from(out);
}

/** Format a local Doc as a tool response, with a clear "from cache" marker. */
function formatLocalDoc(doc: import("../lib/local-search.js").Doc): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}  ·  *(from local docs)*`);
  lines.push(``);
  lines.push(`**Local path:** \`${doc.relativePath}\``);
  if (doc.frontmatter.source) {
    lines.push(`**Original source:** ${doc.frontmatter.source}`);
  }
  if (doc.frontmatter.fetched_at) {
    lines.push(`**Fetched at:** ${doc.frontmatter.fetched_at}`);
  }
  if (doc.frontmatter.version) {
    lines.push(`**Version:** ${doc.frontmatter.version}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(doc.body);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*This document was loaded from your local \`docs/libraries/\` folder.*`);
  lines.push(`*Pass \`refresh: true\` to force a fresh fetch from upstream.*`);
  return lines.join("\n");
}

// ---- npm ---------------------------------------------------------------------

interface NpmRegistryResponse {
  name: string;
  "dist-tags"?: { latest: string };
  versions?: Record<string, { readme?: string }>;
  readme?: string;
  description?: string;
  homepage?: string;
  repository?: { url?: string };
}

async function tryNpm(name: string, version?: string): Promise<FetchedDoc | undefined> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const data = await fetchJson<NpmRegistryResponse>(url);
  const ver = version ?? data["dist-tags"]?.latest ?? Object.keys(data.versions ?? {})[0];
  // npm packument no longer ships README in the root or per-version fields,
  // so fall back to jsDelivr CDN (raw file from the published tarball) and
  // then to the GitHub repo's default branch README.
  let readme: string | undefined =
    (ver && data.versions?.[ver]?.readme) ||
    data.readme ||
    undefined;
  if (!readme && ver) {
    readme = await tryReadmeFromCdn(name, ver).catch(() => undefined);
  }
  if (!readme) {
    readme = await tryGithubReadmeFromRepo(data.repository?.url).catch(() => undefined);
  }
  if (!readme) return undefined;
  return {
    name: data.name,
    version: ver,
    description: data.description,
    homepage: data.homepage,
    repository: data.repository?.url,
    readme,
    source: "npm",
    sourceUrl: url,
  };
}

/** Fetch README from jsDelivr CDN — works for any npm package without API limits. */
async function tryReadmeFromCdn(name: string, version: string): Promise<string | undefined> {
  // Cover many capitalization conventions: README.md, Readme.md, readme.md, README.MD, etc.
  const candidates = [
    "README.md", "readme.md", "Readme.md", "README.MD", "Readme.MD",
    "README.markdown", "Readme.markdown", "README.rst", "README.txt",
    "README", "readme",
  ];
  for (const f of candidates) {
    const url = `https://cdn.jsdelivr.net/npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}/${f}`;
    const res = await fetchText(url).catch(() => undefined);
    if (res && res.status === 200 && res.text && res.text.length > 50) {
      return res.text;
    }
  }
  // Last resort: query jsDelivr's file listing API and pick the first README-like file.
  const listing = await fetchJson<{ files?: Array<{ name: string; type: string }> }>(
    `https://data.jsdelivr.com/v1/packages/npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
  ).catch(() => undefined);
  if (listing?.files) {
    const readmeFile = listing.files.find(
      (f) => f.type === "file" && /^readme\.(md|markdown|rst|txt)$/i.test(f.name),
    );
    if (readmeFile) {
      const url = `https://cdn.jsdelivr.net/npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}/${readmeFile.name}`;
      const res = await fetchText(url).catch(() => undefined);
      if (res && res.status === 200 && res.text) return res.text;
    }
  }
  return undefined;
}

// ---- PyPI --------------------------------------------------------------------

interface PypiResponse {
  info?: {
    name: string;
    version: string;
    summary?: string;
    home_page?: string;
    project_url?: string;
    project_urls?: Record<string, string>;
    description?: string; // often long RST/MD
  };
}

async function tryPypi(name: string, version?: string): Promise<FetchedDoc | undefined> {
  const url = version
    ? `https://pypi.org/pypi/${encodeURIComponent(name)}/${version}/json`
    : `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  const data = await fetchJson<PypiResponse>(url);
  const info = data.info;
  if (!info) return undefined;
  return {
    name: info.name,
    version: info.version,
    description: info.summary,
    homepage: info.home_page || info.project_url ||
      info.project_urls?.Homepage || info.project_urls?.Source,
    repository: info.project_urls?.Source || info.project_urls?.Repository,
    readme: info.description || "",
    source: "pypi",
    sourceUrl: url,
  };
}

// ---- crates.io ---------------------------------------------------------------

interface CratesResponse {
  crate?: {
    name: string;
    max_stable_version?: string;
    description?: string;
    homepage?: string;
    repository?: string;
    documentation?: string;
  };
}

async function tryCrates(name: string): Promise<FetchedDoc | undefined> {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
  const data = await fetchJson<CratesResponse>(url, {
    headers: { "User-Agent": "web-docs-mcp (local MCP server)" },
  });
  const c = data.crate;
  if (!c) return undefined;
  // Fetch README from docs.rs which renders it nicely.
  let readme = "";
  const ver = c.max_stable_version;
  if (ver) {
    const docsRs = await fetchText(`https://docs.rs/${c.name}/${ver}/${c.name}/`)
      .catch(() => undefined);
    if (docsRs && /text\/html/i.test(docsRs.contentType)) {
      // docs.rs is HTML — extract the README section.
      const m = /<div[^>]*id="main-content"[^>]*>([\s\S]*?)<\/div>\s*<footer/i.exec(docsRs.text);
      readme = m ? m[1] : docsRs.text.slice(0, 8000);
    }
  }
  if (!readme && c.repository) {
    const gh = await tryGithubReadmeFromRepo(c.repository).catch(() => undefined);
    if (gh) readme = gh;
  }
  if (!readme) readme = c.description || "(no README available)";
  return {
    name: c.name,
    version: ver,
    description: c.description,
    homepage: c.homepage || c.documentation,
    repository: c.repository,
    readme,
    source: "crates.io",
    sourceUrl: url,
  };
}

// ---- Go ----------------------------------------------------------------------

async function tryGo(name: string): Promise<FetchedDoc | undefined> {
  // pkg.go.dev doesn't have a public JSON API, so we just link out.
  const url = `https://pkg.go.dev/${name}`;
  return {
    name,
    description: "Go module on pkg.go.dev",
    homepage: url,
    readme: `Go documentation is rendered at ${url}. Use \`fetch_url\` with this URL to extract the markdown.`,
    source: "pkg.go.dev",
    sourceUrl: url,
  };
}

// ---- GitHub ------------------------------------------------------------------

interface GhRepoResponse {
  name: string;
  full_name: string;
  description?: string;
  homepage?: string;
  html_url: string;
  default_branch: string;
}

async function tryGithub(owner: string, repo: string): Promise<FetchedDoc | undefined> {
  // Fast path: try README from common default branches without hitting the
  // (rate-limited) GitHub API. We only call the API if all branches miss,
  // to learn the actual default branch name.
  let readme = "";
  let defaultBranch = "main";
  for (const branch of ["main", "master", "develop", "trunk"]) {
    readme = await tryGithubReadme(owner, repo, branch).catch(() => "");
    if (readme) {
      defaultBranch = branch;
      break;
    }
  }
  if (!readme) {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "web-docs-mcp",
    };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    const repoInfo = await fetchJson<GhRepoResponse>(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers },
    ).catch(() => undefined);
    if (repoInfo?.default_branch) {
      defaultBranch = repoInfo.default_branch;
      readme = await tryGithubReadme(owner, repo, defaultBranch).catch(() => "");
    }
    if (!readme) return undefined;
    // If we have readme but no repoInfo, use fallback values
    const name = repoInfo?.full_name || `${owner}/${repo}`;
    const description = repoInfo?.description || "";
    const homepage = repoInfo?.homepage || repoInfo?.html_url || `https://github.com/${owner}/${repo}`;
    const repository = repoInfo?.html_url || `https://github.com/${owner}/${repo}`;
    return {
      name,
      description,
      homepage,
      repository,
      readme,
      source: "github",
      sourceUrl: `https://api.github.com/repos/${owner}/${repo}`,
    };
  }
  // We got README via raw URLs. Build a minimal FetchedDoc without an API call.
  const fullName = `${owner}/${repo}`;
  return {
    name: fullName,
    description: undefined,
    homepage: `https://github.com/${fullName}`,
    repository: `https://github.com/${fullName}`,
    readme,
    source: "github",
    sourceUrl: `https://github.com/${fullName}/blob/${defaultBranch}/README.md`,
  };
}

async function tryGithubReadme(owner: string, repo: string, branch: string): Promise<string> {
  // Try common README filenames on the default branch via raw.githubusercontent.
  const candidates = [
    "README.md", "readme.md", "Readme.md", "README.MD", "Readme.MD",
    "README.markdown", "README.rst", "README.txt", "README", "readme",
  ];
  for (const f of candidates) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${f}`;
    const res = await fetchText(url).catch(() => undefined);
    if (res && res.status === 200 && res.text) return res.text;
  }
  return "";
}

async function tryGithubReadmeFromRepo(repoUrl?: string): Promise<string | undefined> {
  if (!repoUrl) return undefined;
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(repoUrl);
  if (!m) return undefined;
  const owner = m[1];
  const repo = m[2];
  // raw.githubusercontent.com is served from a CDN and does NOT rate-limit
  // anonymous reads like api.github.com does. We try the two most common
  // default branch names in order; only fall back to the API if both miss.
  for (const branch of ["main", "master", "develop", "trunk"]) {
    const readme = await tryGithubReadme(owner, repo, branch).catch(() => "");
    if (readme) return readme;
  }
  // Last resort: ask the API for the default branch (rate-limited to 60/hour anon).
  const headers: Record<string, string> = { "User-Agent": "web-docs-mcp" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const info = await fetchJson<{ default_branch?: string }>(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers },
  ).catch(() => undefined);
  if (info?.default_branch) {
    const readme = await tryGithubReadme(owner, repo, info.default_branch).catch(() => "");
    if (readme) return readme;
  }
  return undefined;
}
