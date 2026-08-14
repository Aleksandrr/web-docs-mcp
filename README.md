# web-docs-mcp

Локальный MCP-сервер для [Kilo Code](https://kilocode.ai), [Cline](https://github.com/cline/cline), [Roo Code](https://github.com/RooCodeInc/Roo-Code), [Claude Desktop](https://claude.ai/desktop) и любого другого клиента с поддержкой Model Context Protocol. Даёт агенту четыре инструмента для бесплатного поиска в вебе и подтягивания документации библиотек — **без платных API-ключей**, в противовес дорогому штатному поиску OpenRouter.

## Что внутри

| Tool | Что делает | Local-first? | Стоимость |
|---|---|---|---|
| `list_docs` | Листать / искать / читать локальные `docs/` | ✅ Только локально | $0 |
| `web_search` | Поиск через DuckDuckGo HTML-эндпоинт | ❌ | $0 |
| `fetch_url` | Тянет URL и возвращает markdown (HTML/JSON/plain) | ✅ Сначала `docs/` (по source URL в frontmatter) | $0 |
| `lib_docs` | README библиотек: `npm`→`PyPI`→`crates`→`go`→`GitHub` | ✅ Сначала `docs/libraries/` | $0 |
| `search_docs` | Поиск по официальным докам (MDN, docs.python.org, …) | ✅ Сначала все `docs/**/*.md` | $0 |

**Принцип local-first:** каждый инструмент, которому нужны внешние данные, СНАЧАЛА проверяет локальную папку `docs/`. Если документ уже сохранён — возвращается локальная копия за <5 мс, в сеть не лезем. Если нет — идёт обычный фетч + (по умолчанию) сохранение в `docs/`. Таким образом `docs/` становится самообучающимся кешем: чем больше пользуешься, тем меньше ходишь в интернет.

## Структура `docs/`

```
docs/
├── libraries/   ← README библиотек (lib_docs tool)
├── api/         ← Доки языков/API: MDN, docs.python.org, pkg.go.dev (search_docs tool)
├── guides/      ← Туториалы, статьи, how-to (fetch_url tool, default)
├── specs/       ← RFC, стандарты (fetch_url с subdir="specs")
└── snippets/    ← Cheat sheets, короткие референсы (fetch_url с subdir="snippets")
```

Каждый файл имеет YAML frontmatter:

```yaml
---
title: "express"
source: "https://registry.npmjs.org/express"
content_type: "text/markdown"
fetched_by: "lib_docs"
fetched_at: "2026-06-18T16:38:58.448Z"
version: "5.2.1"
---
```

Локальный поиск использует `source` для match-by-URL, `title`/slug для keyword search, `version` для отображения.

## Установка

```bash
git clone <this-repo> ~/web-docs-mcp
cd ~/web-docs-mcp
npm install
npm run build
```

Требуется **Node.js ≥ 18.17** (нужен встроенный `fetch`).

### Если Kilo Code выдаёт «MCP error -32000: Connection closed»

Это значит: сервер запустился, тут же упал, и Kilo Code потерял stdio-пайп. Запусти health-check напрямую, чтобы увидеть реальную ошибку:

```bash
cd D:/aleks/Yandex.Disk/кодинг/web-docs-mcp
node check.cjs
```

Скрипт проверяет 10 вещей: версию Node, наличие `fetch()`, существование `build/` и `node_modules/`, загружаемость MCP SDK / cheerio / turndown, доступность `DOCS_DIR` и `CACHE_DIR` на запись, и даже живость DuckDuckGo. Каждый пункт помечается `[OK]` / `[FAIL]` / `[WARN]`.

Если все 10 проверок проходят — добавь `--serve`, чтобы запустить сервер с теми же env-переменными, что использует Kilo Code:

```bash
node check.cjs --serve
```

В этом режиме health-check отрабатывает, потом запускается MCP-сервер. Любая ошибка старта падает на stderr с полным stack trace, а не проглатывается Kilo Code.

**Самые частые причины на Windows:**

1. **Не выполнен `npm install`** — `build/index.js` есть, а `node_modules/` пустой. Первый же `import "@modelcontextprotocol/sdk/..."` падает с `Cannot find module`. Решение: `npm install`.

2. **Не выполнен `npm run build`** — `build/` папка отсутствует. Решение: `npm run build` (или используй `examples/kilo-code-mcp-dev.json` с `npx tsx src/index.ts`).

3. **Старый Node.js (< 18.17)** — `fetch()` undefined. Сервер падает при первой попытке поиска. Решение: обнови Node.js с [nodejs.org](https://nodejs.org/).

4. **Кириллица или пробелы в пути** (`Yandex.Disk/кодинг/`) — Node.js на Windows обычно справляется, но некоторые версии `tsx` ломаются. Решение: либо используй production-конфиг (`node build/index.js`), либо перенеси папку в путь без не-ASCII (например `C:/tools/web-docs-mcp`).

5. **`DOCS_DIR=docs` не раскрывается** — Kilo Code на некоторых версиях не делает `cd` в workspace перед запуском MCP, и относительный `docs` резолвится в текущую директорию процесса, которая может быть недоступной на запись. Решение: используй **абсолютный путь** в env:
   ```jsonc
   "environment": {
     "DOCS_DIR": "D:/aleks/Yandex.Disk/ZeroChat/docs",
     "CACHE_DIR": "D:/aleks/Yandex.Disk/ZeroChat/.cache/web-docs",
     ...
   }
   ```

6. **Антивирус / Defender блокирует spawn** — иногда Windows Defender блокирует `node.exe` от запуска дочерних процессов. Решение: добавь папку проекта в исключения Defender.

## Подключение к Kilo Code

1. В Kilo Code открой **Settings → MCP Servers → Add Server**.
2. Вставь конфиг из [`examples/kilo-code-mcp.json`](examples/kilo-code-mcp.json), заменив `/absolute/path/to/web-docs-mcp` на реальный путь.
3. Перезапусти Kilo Code (или нажми *Reconnect* у сервера).
4. В любом режиме попроси агента: «поищи через web-docs, как использовать useEffect».

Для разработки удобно запускать через `tsx` без сборки — см. [`examples/kilo-code-mcp-dev.json`](examples/kilo-code-mcp-dev.json).

### Системный промпт

Чтобы агент правильно использовал инструменты (сначала local, потом web, и сохранял в нужные подпапки), положи содержимое [`examples/system-prompt.md`](examples/system-prompt.md) в **Kilo Code → Settings → Custom Instructions**. Там описаны: дерево решений «какой инструмент когда звать», правила сохранения в подпапки, антипаттерны и примеры потоков.

### Минимальный конфиг (Kilo Code ≥ 4.x, новая схема)

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "mcp": {
    "web-docs": {
      "type": "local",
      "command": ["node", "/home/z/web-docs-mcp/build/index.js"],
      "environment": {
        "DOCS_DIR": "docs",
        "CACHE_DIR": ".cache/web-docs",
        "GITHUB_TOKEN": ""
      },
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

Поля в новой схеме:
- `type: "local"` — обязательно (альтернатива `"remote"` для HTTP-MCP).
- `command` — **массив** из команды + её аргументов (раньше было `command` + `args` отдельно).
- `environment` — env-переменные (раньше `env`).
- `enabled: true` — позитивная логика (раньше `disabled: false`).
- `timeout` — в миллисекундах, **дефолт всего 5000** (5 сек). Для нас мало — выставляй `60000` минимум, потому что `lib_docs` делает до 4 последовательных HTTP-запросов.
- `alwaysAllow` больше не существует — автоапрув инструментов настраивается в UI: Settings → MCP → сервер → Auto-approve tools.

Пути `DOCS_DIR` и `CACHE_DIR` можно указывать **относительно workspace'а** (Kilo Code раскроет их от корня проекта).

## Переменные окружения

| Имя | По умолчанию | Описание |
|---|---|---|
| `DOCS_DIR` | `./docs` | Куда писать markdown при `save: true`. |
| `CACHE_DIR` | `./.cache/web-docs` | Директория TTL-кеша (sha1-ключи). |
| `CACHE_TTL_HOURS` | `168` (7 дней) | TTL записей кеша. |
| `HTTP_TIMEOUT_MS` | `20000` | Таймаут одного HTTP-запроса. |
| `HTTP_MAX_REDIRECTS` | `5` | Лимит редиректов. |
| `USER_AGENT` | реалистичный Chrome UA | Передаётся во все запросы. |
| `DEFAULT_SAVE_TO_DOCS` | `false` | Если `true`, инструменты пишут в `docs/` по умолчанию. |
| `DISABLE_CACHE` | `false` | Слей быстрого тестирования — каждый запрос идёт в upstream. |
| `GITHUB_TOKEN` | — | Опционально, поднимает GitHub API-лимит с 60 до 5000 запросов/час. |
| `DEFAULT_SEARCH_LIMIT` | `8` | Сколько результатов `web_search` возвращает по умолчанию. |
| `MAX_SEARCH_LIMIT` | `20` | Жёсткий потолок даже если агент просит больше. |
| `MAX_MD_CHARS` | `60000` | Лимит длины возвращаемого markdown. |

## Примеры использования в Kilo Code

### 1. Поискать библиотеку и подтянуть её доку

```
Пользователь:   Хочу использовать fastapi для нового API. Подтяни доку.
Агент:          [вызывает lib_docs { name: "fastapi" }]
                → получает README с pypi.org
                → если просишь "сохрани в docs/" — вызовет с save:true
```

### 2. Найти свежий гайд

```
Пользователь:   Что нового в Next.js 16 app router?
Агент:          [вызывает web_search { query: "Next.js 16 app router tutorial 2026", limit: 5 }]
                → читает список
                → [вызывает fetch_url { url: "<топ-результат>", save: true, subdir: "guides" }]
```

### 3. Посмотреть MDN по конкретному API

```
Пользователь:   Напомни, какие аргументы принимает Array.prototype.toSorted
Агент:          [вызывает search_docs { query: "Array.prototype.toSorted", target: "mdn", fetch_top: true }]
```

### 4. Просто зафетчить конкретный URL

```
Пользователь:   Вот ссылка: https://react.dev/reference/react/useEffect — вытащи текст
Агент:          [вызывает fetch_url { url: "...", save: true, name: "react-useeffect" }]
                → docs/react-useeffect.md готов
```

## Архитектура

```
src/
├── index.ts              # entry: создаёт MCP-сервер, регистрирует 4 инструмента
├── config.ts             # env-переменные, пути, дефолты
├── lib/
│   ├── cache.ts          # файловый TTL-кеш (sha1-ключи, JSON-конверт)
│   ├── fetcher.ts        # обёртка над fetch: кеш+таймаут+редиректы
│   ├── ddg.ts            # парсер DDG HTML (cheerio)
│   ├── html-to-md.ts     # turndown + GFM, выкидывает nav/footer/ads
│   ├── docs-writer.ts    # сохранение в docs/<subdir>/<slug>.md с frontmatter
│   └── zod-to-json.ts    # конвертация zod-схем в JSON Schema для MCP
└── tools/
    ├── web_search.ts     # DDG поиск
    ├── fetch_url.ts      # URL → markdown
    ├── lib_docs.ts       # npm/pypi/crates/go/github
    └── search_docs.ts    # док-сайты (MDN, docs.python.org, …)
```

Поток данных:

```
Agent → MCP tool call → tool handler → lib/fetcher (cache check)
                                              ↓ miss
                                          fetch() upstream
                                              ↓
                                          cacheSet()
                                              ↓
                                          parse / convert
                                              ↓
                                  optional saveDoc() to docs/
                                              ↓
                                       text → MCP → agent context
```

## Smoke test

```bash
npm run smoke
```

Проверяет каждый инструмент отдельно, без MCP-транспорта. Удобно для дебага и проверки что upstream живой.

## Ограничения и подводные камни

- **DuckDuckGo rate-limit.** При агрессивном дёрганьи (десятки запросов в минуту с одного IP) DDG может показать капчу. Кеш + `CACHE_TTL_HOURS` сильно смягчают проблему, но не исключают. Для production-нагрузки подними SearXNG инстанс и подключи его (потребует минорной правки `src/lib/ddg.ts`).
- **GitHub API.** Анонимный лимит — 60 запросов/час с IP. Если часто зовёшь `lib_docs` для GitHub-репозиториев, положи `GITHUB_TOKEN` (любой fine-grained PAT без скоупов подойдёт для публичных репо).
- **JavaScript-only сайты.** `fetch_url` не рендерит JS. Если страница строится клиентом (React/Vue SPA без SSR), markdown будет пустой. В таких случаях агенту стоит искать альтернативный источник (raw README на GitHub, API docs и т.п.).
- **Конвертация HTML→MD.** Turndown отлично справляется с большинством док-сайтов, но на нестандартной разметке могут оставаться куски хрома. Шумодав в `html-to-md.ts` покрывает основные паттерны (sidebar, cookie-баннер, related-posts).

## Anubis (anti-bot PoW)

`fetch_url` умеет автоматически обходить **Anubis** — open-source proof-of-work защиту, которую используют `wiki.altlinux.org`, `codeberg.org`, многие Gitea/Forgejo инстансы и т.д. Алгоритм:

1. Сервер отдаёт HTML с встроенным JSON-челленджем (`{challenge: {id, randomData}, rules: {difficulty}}`).
2. `src/lib/anubis.ts` вычисляет `sha256(randomData + nonce)` для `nonce = 0, 1, 2, …` пока хэш не начнётся с `difficulty` нулей.
3. Решение отправляется на `/.within.website/x/cmd/anubis/api/pass-challenge`, полученная кука прикрепляется к повторному запросу.

Solver написан на чистом Node.js (`crypto.createHash`), **без headless-браузера**. На difficulty=3 (типичный "fast" уровень) решение находится за ~5ms, на difficulty=4 — за ~50ms, на difficulty=5 — до 5 секунд.

### Но: Anubis DENY ≠ PoW challenge

Anubis также имеет `action: DENY` правила для IP-диапазонов облачных провайдеров (Alibaba Cloud, Huawei Cloud, и т.д.) и AI-scraper User-Agent'ов. При срабатывании DENY-правила сервер **вообще не выдаёт челлендж** — отдаёт страницу "Oh noes! Access Denied" с `anubis_challenge: null`. Solver тут бессилен: нет PoW → нечего решать.

В этом случае `fetch_url` возвращает понятное сообщение:

```
# Anubis DENY: https://wiki.altlinux.org/

The site is protected by Anubis and refused to issue a proof-of-work challenge.
This is a flat deny, NOT a solvable challenge.

**Why this happens:**
- Client IP is on a cloud-provider blocklist (Alibaba Cloud, Huawei Cloud, etc.)
- User-Agent matches an AI-scraper deny rule
...
```

**Если попал в DENY**, варианты:
1. Запускай MCP-сервер с машины с residential IP (домашний интернет, не VPS).
2. Если обязательно с VPS — выбери провайдера не в блэклисте (Hetzner, OVH, DigitalOcean обычно проходят, Alibaba/Huawei — нет).
3. Прокинь через прокси: добавь опцию в `fetcher.ts` (однострочник — `fetch(url, { dispatcher: new ProxyAgent(...) })` с `undici`).
4. Используй `web_search` + зеркало (archive.org, Google cache).

Чтобы проверить, попадает ли твой IP в блоклист, глянь `data/crawlers/alibaba-cloud.yaml` и `data/crawlers/huawei-cloud.yaml` в [репо Anubis](https://github.com/TecharoHQ/anubis).

### Отключение обхода

Если хочешь получить сырую страницу челленджа (для дебага), передай `no_anubis: true` в `fetch_url`:

```json
{
  "url": "https://wiki.altlinux.org/",
  "no_anubis": true
}
```

## Лицензия

MIT.
