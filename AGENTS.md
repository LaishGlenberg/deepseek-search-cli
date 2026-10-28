# AGENTS.md

## Project

`deepseek-search-cli` is a zero-runtime-dependency TypeScript CLI (`dsearch`) for
DeepSeek's native Search and Fetch APIs. See the [README](README.md) for user-facing
usage and [docs/deepseek-search-api.md](docs/deepseek-search-api.md) for a local copy
of the official API guide.

## Layout

```text
src/
  index.ts      entry point (shebang, exit code)
  cli.ts        argument parsing, help text, command runner
  client.ts     Search/Fetch HTTP client and DeepSeekApiError
  config.ts     env, .env, and `dsearch auth` key resolution, ConfigError
  format.ts     terminal output
  usage.ts      local billable-request ledger and cost summary
  types.ts      API request/response types
  version.ts    reads version from package.json
tests/
  *.test.ts          unit tests
  integration/       local mock HTTP server + spawned CLI tests
  e2e/               installs the published npm package, bills one real search
  live/              billed tests, opt-in only
.github/workflows/
  ci.yml             lint, typecheck, build, test on Node 20/22/24
  tag.yml            tag-only release automation
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile `src/` to `dist/` with tsc |
| `npm run typecheck` | Typecheck sources and tests |
| `npm run lint` | oxlint with warnings denied |
| `npm test` | Build, then run all tests (live tests skipped) |
| `npm run test:watch` | Watch mode |
| `RUN_LIVE_TESTS=1 npm run test:live` | Billed tests against the real API (2 requests max) |
| `npm run test:e2e` | Installs the published package from npm, runs a real search, uninstalls (billed) |
| `npm publish` | Runs `prepublishOnly`: lint + typecheck + build + test |

## Conventions

- ESM only; `tsconfig` uses `NodeNext`, so relative imports need a `.js` extension.
  Tests import `../src/cli.js` and vitest resolves it to the TypeScript source.
- No runtime dependencies. Use native `fetch`; keep argument parsing hand-rolled.
- Keep the CLI cheap and scriptable: every command supports `--json`.
- Validate user input in `cli.ts` before calling the API (count 1–50, query ≤128
  characters, http(s) URLs).
- Exit codes are part of the interface: `0` success, `1` runtime/API error, `2`
  usage or config error. New errors must follow this.
- Record only billable successes in `usage.jsonl`: search with a non-empty
  `results` array, fetch with non-empty content. Tracking is best-effort and must
  never fail an already-billed request.
- `dsearch cost` is local-only and runs before `loadConfig`, so it needs no API key.
- Tests must not hit the network unless they are in `tests/live/` and gated by
  `RUN_LIVE_TESTS=1`. Do not add e2e tests without the user's permission.
- Use `rg` for searching. Keep logging minimal; errors go to stderr.

## Release

Publishing is manual and deliberately separate from tagging:

1. Bump `version` in `package.json` (or let the workflow do a patch bump) and merge
   to `main`.
2. `.github/workflows/tag.yml` verifies the build, then:
   - tags `v<version>` if that tag does not exist (user already bumped), or
   - bumps a patch version, commits `chore: release v<new>`, and tags it when the
     current version was already tagged.
3. The workflow creates a GitHub Release for the new tag with auto-generated notes and
   never runs `npm publish`. Publish manually with `npm publish`.

A `chore: release v*` HEAD commit is skipped to prevent bump loops. All workflows
push with `GITHUB_TOKEN` and `permissions: contents: write`.
