# Build Plan — `deepseek-search-cli`

Approved plan for the first npm CLI covering DeepSeek's native Search & Fetch APIs
(`POST /v1/tools/search`, `POST /v1/tools/fetch`).

Reference copy of the upstream guide: [docs/deepseek-search-api.md](docs/deepseek-search-api.md)
(https://api-docs.deepseek.com/guides/search).

## Decisions

- Package name: `deepseek-search-cli` (available on npm), binary: `dsearch`
- Zero runtime dependencies (native `fetch`, hand-rolled arg parser and `.env` reader)
- ESM, Node >= 20, TypeScript, vitest, oxlint
- Commands: `search`, `fetch`; JSON mode for agents/scripts
- Release workflow tags only, never publishes

## 1. Scaffold

- `package.json`: ESM, `bin.dsearch -> dist/index.js`, `files: ["dist"]`, `exports`,
  `engines.node >= 20`, MIT, scripts for build/typecheck/lint/test, `prepublishOnly`
  runs lint + build + test
- `tsconfig.json` (typecheck, includes tests) and `tsconfig.build.json` (emit `dist/` from `src/`)
- `.oxlintrc.json` with correctness errors, suspicious warnings, ignore `dist/`
- `.gitignore`: `node_modules/`, `dist/`, `.env`, logs, OS junk
- `LICENSE` (MIT)

## 2. Core (`src/`)

- `types.ts` — request/response shapes from the docs
- `config.ts` — API key from `DEEPSEEK_API_KEY`, fallback to `./.env`; `DEEPSEEK_BASE_URL`
  override; parser handles comments, quotes, `export `
- `client.ts` — `search()` / `fetchPage()`, bearer auth, 30s timeout,
  `DeepSeekApiError` with HTTP status + API error code/message; injectable `fetch` for tests
- `format.ts` — human output (rank, title, URL, site/date, score, summary or snippet,
  optional page content) and `--json` raw passthrough
- `version.ts` — read version from `package.json`

## 3. CLI (`src/cli.ts`, `src/index.ts`)

- `dsearch search <query...> [-n|--count <1-50>] [--content] [--ori-question <q>] [--localization <ip>] [--json]`
- `dsearch fetch <url> [--json]`
- `dsearch "query"` shorthand; `--help`/`-h`, `--version`/`-v`
- `--` ends flag parsing; query operators (`site:`, `after:`, `lang:`, ...) pass through
- Client-side validation mirrors API limits: count 1–50, query 1–128 chars non-blank,
  http(s) URL
- Exit codes: `0` ok, `1` runtime/API error, `2` usage error; usage on stderr
- `index.ts` keeps the shebang, sets `process.exitCode`, never throws raw

## 4. Tests (vitest, no network)

- Parser: help/version, shorthand search, flag forms (`-n 5`, `--count=5`), invalid
  count/query, `--`, unknown flags, fetch URL validation
- Client (mocked fetch): correct URL/headers/body, empty results, 401/402/429/500
  mapping with API error bodies, non-JSON error body, network failure
- Config: `.env` parsing, env precedence, missing key
- Format: idempotent human output incl. `--content`, JSON passthrough
- No e2e tests

## 5. CI (`.github/workflows/ci.yml`)

- Push to `main` + PRs, Node 20/22/24 matrix
- `npm ci` → lint → typecheck → build → test

## 6. Auto-tag (`.github/workflows/tag.yml`) — tags only

- Push to `main` + `workflow_dispatch`, `permissions: contents: write`
- Read version from `package.json`; skip if HEAD is already a `chore: release v*` commit
  (loop guard)
- If tag `v<version>` is missing (user bumped the version) → tag that commit
- If `v<version>` already exists (no version bump on merge) → `npm version patch`,
  commit `chore: release v<new>`, push tag then branch
- Never runs `npm publish`

## 7. Docs

- `README.md`: install, quick start, command/flag tables, JSON output, env setup,
  query operators, errors/billing/rate limits, release flow
- `AGENTS.md`: layout, commands, conventions, release rules, testing policy

## 8. Verification

- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`
- `node dist/index.js --help`, `--version`, and an offline error path
- Optional live smoke test with the local `.env` key
- Initial git commit (no remote push unless requested)
