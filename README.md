# web-docs-mcp

Local MCP server for Kilo Code / Cline / Claude Desktop — free web search + library docs fetcher with local-first caching.

## Features

- 🔍 **web_search** — Free DuckDuckGo HTML search (no API key required)
- 🌐 **fetch_url** — Fetch any URL and convert to clean markdown (cached locally)
- 📚 **lib_docs** — Auto-fetch README/docs from npm, PyPI, crates.io, Go, or GitHub
- 📖 **search_docs** — Language & API documentation search biased to official docs (MDN, docs.python.org, etc.)
- 📂 **list_docs** — Browse and search your local `docs/` folder first (local-first approach)

## Installation

```bash
npm install
npm run build
```

## Usage

### As MCP Server

Add to your MCP client configuration (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "web-docs-mcp": {
      "command": "node",
      "args": ["/path/to/web-docs-mcp/build/index.js"],
      "env": {
        "DOCS_DIR": "/path/to/your/docs",
        "CACHE_TTL_HOURS": "168",
        "DEFAULT_SAVE_TO_DOCS": "true"
      }
    }
  }
}
```

### Direct Execution

```bash
# Development mode
npm run dev

# Production mode
npm run start

# Build
npm run build

# Clean build artifacts
npm run clean
```

## Configuration

All settings are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCS_DIR` | `./docs` | Directory where fetched markdown docs are saved |
| `CACHE_DIR` | `./.cache/web-docs` | Directory for TTL cache (raw HTML + fetched markdown) |
| `CACHE_TTL_HOURS` | `168` (7 days) | Cache time-to-live in hours |
| `HTTP_TIMEOUT_MS` | `20000` | HTTP timeout per request in milliseconds |
| `USER_AGENT` | Chrome-like UA | User-Agent sent to upstream servers |
| `DEFAULT_SAVE_TO_DOCS` | `true` | Default behavior for saving docs to `docs/` folder |
| `DISABLE_CACHE` | `false` | Disable caching (useful for debugging) |
| `GITHUB_TOKEN` | _none_ | Optional GitHub token to lift rate limits |

## Tools

### web_search

Free web search via DuckDuckGo HTML. Returns a list of `{title, url, snippet}`.

```typescript
{
  query: string,      // Search query
  limit?: number      // Number of results (default: 8, max: 20)
}
```

### fetch_url

Fetch a single URL and return clean markdown. Handles HTML (via turndown+GFM), JSON (pretty-printed), and plain text.

```typescript
{
  url: string,                    // URL to fetch
  save?: boolean,                 // Save to docs/ folder (default: true)
  subdir?: string                 // Subdirectory under docs/ (optional)
}
```

### lib_docs

Fetch README/docs for a library by name. Tries npm → PyPI → crates.io → Go → GitHub automatically.

```typescript
{
  name: string,                   // Library name (e.g., "react", "numpy", "serde", "owner/repo")
  save?: boolean,                 // Save to docs/libraries/ (default: true)
  subdir?: string                 // Custom subdirectory (optional)
}
```

### search_docs

Language & API documentation search. Biases results to official docs sites. LOCAL-FIRST: searches your `docs/` folder first.

```typescript
{
  query: string,                  // Search query
  language?: string,              // Programming language (e.g., "python", "rust", "go")
  fetch_top?: boolean,            // Fetch full markdown of top result (default: false)
  save?: boolean,                 // Save fetched content (default: true)
  subdir?: string                 // Subdirectory under docs/api/ (optional)
}
```

### list_docs

Browse and search the local `docs/` folder. Three modes:
1. No args = list all saved docs
2. `{ query }` = keyword search across docs/
3. `{ path }` = read full body of a specific doc by relative path or slug

```typescript
{
  query?: string,                 // Keyword search (optional)
  path?: string                   // Relative path to specific doc (optional)
}
```

## Directory Structure

```
web-docs-mcp/
├── src/
│   ├── index.ts          # Main entry point
│   ├── config.ts         # Configuration & env vars
│   ├── lib/              # Core utilities
│   │   ├── anubis.ts     # Anubis PoW solver (anti-bot bypass)
│   │   ├── cache.ts      # Local caching logic
│   │   ├── ddg.ts        # DuckDuckGo search
│   │   ├── fetcher.ts    # HTTP fetching
│   │   ├── html-to-md.ts # HTML to markdown conversion
│   │   └── ...
│   └── tools/            # MCP tool implementations
│       ├── web_search.ts
│       ├── fetch_url.ts
│       ├── lib_docs.ts
│       ├── search_docs.ts
│       └── list_docs.ts
├── docs/                 # Saved documentation (created on demand)
│   ├── libraries/        # Library READMEs
│   ├── api/              # API documentation
│   ├── guides/           # Tutorials & how-tos
│   └── ...
├── .cache/               # TTL cache (auto-managed)
├── build/                # Compiled JavaScript
└── package.json
```

## Supported Ecosystems

- **npm** — JavaScript/TypeScript packages
- **PyPI** — Python packages
- **crates.io** — Rust crates
- **pkg.go.dev** — Go modules
- **GitHub** — Any repository (owner/repo format)

## Local-First Approach

This server implements a local-first strategy:
1. All fetched content is cached with configurable TTL
2. `search_docs` checks your local `docs/` folder before going to the web
3. Subsequent calls return cached results in <5ms instead of re-fetching
4. Perfect for offline work or rate-limited environments

## Requirements

- Node.js >= 18.17
- npm or yarn

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Empty search results from DuckDuckGo

The User-Agent might be blocked. Try setting a custom one:

```bash
export USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
```

### Rate limiting on GitHub

Add a GitHub token to lift the 60 req/hour anonymous limit:

```bash
export GITHUB_TOKEN=your_token_here
```

### Cache issues

To disable cache temporarily:

```bash
export DISABLE_CACHE=true
```

Or clean the cache:

```bash
npm run clean
```
