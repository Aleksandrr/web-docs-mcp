#!/usr/bin/env node
/**
 * Standalone launcher & health check for web-docs-mcp.
 *
 * Run this DIRECTLY with Node.js (no tsx, no build step) to see what's
 * killing the server BEFORE Kilo Code tries to spawn it via JSON-RPC.
 *
 * Common Windows-specific issues this surfaces:
 *
 *   - Node.js version too old (< 18.17, no built-in fetch)
 *   - node_modules/ missing (npm install wasn't run)
 *   - build/ missing (npm run build wasn't run)
 *   - Path with non-ASCII characters causing resolution failures
 *   - DOCS_DIR / CACHE_DIR not writable
 *   - Missing required dependencies
 *
 * Usage:
 *   node check.js              # health check only
 *   node check.js --serve      # health check + start MCP server
 *
 * If --serve fails or the server crashes, the full stack trace will be
 * printed to stderr instead of being swallowed by Kilo Code's MCP wrapper.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SKIP = "\x1b[90mSKIP\x1b[0m";
const OK = "\x1b[32mOK\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const WARN = "\x1b[33mWARN\x1b[0m";

// Disable ANSI colors if stdout/stderr isn't a TTY (cleaner logs in Kilo Code panel)
const isTTY = process.stderr.isTTY === true;
const color = (s) => (isTTY ? s : s.replace(/\x1b\[[0-9;]*m/g, ""));

function line(label, status, detail) {
  const padded = label.padEnd(40);
  process.stderr.write(`  ${padded} [${color(status)}]${detail ? " " + detail : ""}\n`);
}

async function main() {
  process.stderr.write("\n");
  process.stderr.write("=== web-docs-mcp health check ===\n");
  process.stderr.write("\n");

  // 1. Node.js version
  const nodeVersion = process.versions.node;
  const parts = nodeVersion.split(".");
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const versionOk = major > 18 || (major === 18 && minor >= 17);
  line("Node.js version", versionOk ? OK : FAIL, `v${nodeVersion} (need >=18.17)`);

  // 2. fetch() available (Node 18+)
  const fetchOk = typeof fetch === "function";
  line("global fetch()", fetchOk ? OK : FAIL, fetchOk ? "available" : "MISSING — upgrade Node.js");

  // 3. __dirname sanity (catches non-ASCII path issues)
  const here = __dirname;
  const hasNonAscii = /[^\x00-\x7F]/.test(here);
  line(
    "Install path (ASCII only)",
    !hasNonAscii ? OK : WARN,
    hasNonAscii ? `non-ASCII chars in: ${here}` : here,
  );

  // 4. build/ exists
  const buildIndexPath = path.join(here, "build", "index.js");
  const buildOk = fs.existsSync(buildIndexPath);
  line("build/index.js exists", buildOk ? OK : FAIL, buildOk ? "" : "run `npm run build` first");

  // 5. node_modules/ exists
  const nmOk = fs.existsSync(path.join(here, "node_modules"));
  line("node_modules/ exists", nmOk ? OK : FAIL, nmOk ? "" : "run `npm install` first");

  // 6. MCP SDK import works (most common failure: missing or wrong version)
  let mcpSdkOk = false;
  let mcpSdkErr = "";
  try {
    await import("@modelcontextprotocol/sdk/server/index.js");
    mcpSdkOk = true;
  } catch (e) {
    mcpSdkErr = e instanceof Error ? e.message : String(e);
  }
  line("MCP SDK loads", mcpSdkOk ? OK : FAIL, mcpSdkOk ? "" : mcpSdkErr.slice(0, 120));

  // 7. cheerio + turndown import
  let depsOk = false;
  let depsErr = "";
  try {
    await import("cheerio");
    await import("turndown");
    depsOk = true;
  } catch (e) {
    depsErr = e instanceof Error ? e.message : String(e);
  }
  line("cheerio + turndown load", depsOk ? OK : FAIL, depsOk ? "" : depsErr.slice(0, 120));

  // 8. DOCS_DIR resolves & is creatable
  const docsDir = process.env.DOCS_DIR
    ? path.resolve(process.env.DOCS_DIR)
    : path.resolve(process.cwd(), "docs");
  let docsOk = false;
  let docsDetail = docsDir;
  try {
    fs.mkdirSync(docsDir, { recursive: true });
    const probe = path.join(docsDir, ".web-docs-mcp-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    docsOk = true;
  } catch (e) {
    docsDetail = e instanceof Error ? e.message : String(e);
  }
  line("DOCS_DIR creatable & writable", docsOk ? OK : FAIL, docsDetail);

  // 9. CACHE_DIR resolves & is creatable
  const cacheDir = process.env.CACHE_DIR
    ? path.resolve(process.env.CACHE_DIR)
    : path.resolve(process.cwd(), ".cache", "web-docs");
  let cacheOk = false;
  let cacheDetail = cacheDir;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const probe = path.join(cacheDir, ".probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    cacheOk = true;
  } catch (e) {
    cacheDetail = e instanceof Error ? e.message : String(e);
  }
  line("CACHE_DIR creatable & writable", cacheOk ? OK : FAIL, cacheDetail);

  // 10. Try a real DuckDuckGo search to confirm network works
  let netOk = false;
  let netDetail = "";
  if (fetchOk) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
        body: new URLSearchParams({ q: "test", kl: "us-en" }).toString(),
        signal: controller.signal,
      });
      clearTimeout(timer);
      netOk = res.ok;
      netDetail = `HTTP ${res.status}`;
    } catch (e) {
      netDetail = e instanceof Error ? e.message : String(e);
    }
  } else {
    netDetail = "fetch() unavailable";
  }
  line("DuckDuckGo reachable", netOk ? OK : WARN, netDetail.slice(0, 120));

  process.stderr.write("\n");

  const allOk = versionOk && fetchOk && buildOk && nmOk && mcpSdkOk && depsOk && docsOk && cacheOk;
  if (allOk) {
    process.stderr.write(color("\x1b[32m") + "✓ All checks passed." + color("\x1b[0m") + " Server should start cleanly.\n");
  } else {
    process.stderr.write(color("\x1b[31m") + "✗ Some checks failed." + color("\x1b[0m") + " Fix the issues above before connecting Kilo Code.\n");
  }

  // Optionally launch the server
  if (process.argv.includes("--serve")) {
    if (!allOk) {
      process.stderr.write("\nRefusing to start server because checks failed.\n");
      process.exit(1);
    }
    process.stderr.write("\n=== starting MCP server (JSON-RPC over stdio) ===\n");
    process.stderr.write("Send `initialize` request on stdin to begin.\n\n");
    try {
      await import(pathToFileURL(buildIndexPath).href);
    } catch (e) {
      process.stderr.write(
        "\n\x1b[31mFATAL: server crashed during startup:\x1b[0m\n" +
          (e instanceof Error ? e.stack : String(e)) +
          "\n",
      );
      process.exit(1);
    }
  } else if (!allOk) {
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write("\n\x1b[31mHealth check itself crashed:\x1b[0m\n");
  process.stderr.write(e instanceof Error ? e.stack : String(e));
  process.stderr.write("\n");
  process.exit(1);
});
