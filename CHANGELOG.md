# Changelog

All notable changes to `deepseek-search-cli` are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release is a tag on `main` (`v<version>`) plus a GitHub Release generated from the
commits listed under it. Entries link to the commit that introduced them.

## [1.1.0] - 2026-10-28

*Tagged `v1.1.0` on the next push to `main`.*

### Added

- `dsearch cost` reports billable requests (searches and fetches) for today, the last
  7 days, the last 30 days, and all time, with an estimated cost at DeepSeek's
  $0.75 per 1,000 requests and a weekly average. It reads a local ledger only, so it
  runs without an API key. ([902e256])
- Local usage ledger at `<config dir>/usage.jsonl`, one JSON line per billable success
  (a search with results, a fetch with content), written mode `0600` and best-effort so
  tracking can never fail an already-billed request. ([902e256])
- `--json` output for `dsearch cost`. ([902e256])
- End-to-end suite against the published npm package: it installs the tarball into a
  temporary prefix, runs a real search, then uninstalls. Run it with
  `npm run test:e2e`, or opt the full suite in with `RUN_E2E_TESTS=1`. ([841c927])

### Changed

- `configPath()` now derives from a new `configDir()`, which also hosts the usage
  ledger. ([902e256])

## [1.0.2] - 2026-10-28

### Security

- `DEEPSEEK_BASE_URL` is read from the process environment only, so a
  repository-controlled `./.env` can no longer send a saved API key to another origin.
- API requests set `redirect: 'error'`, so credentials are never forwarded through a
  redirect. ([5fcc7b7])

## [1.0.1] - 2026-10-27

### Fixed

- CLI tests isolate the config file, so a developer's real stored key can no longer leak
  into a test run. ([5f73073])

## [1.0.0] - 2026-10-27

First stable release.

### Added

- Terminal recording GIF in the README. ([47bbc88])

### Fixed

- Output confirmation messages are preceded by a blank line instead of running into the
  results above them. ([4b5077e])
- Package version aligned to `1.0.0` in `package.json` and `package-lock.json`. ([e916335])

## [0.1.4] - 2026-10-27

### Added

- `dsearch auth` saves an API key to the user config file and prints its path. It
  prompts with echo disabled on a TTY or reads the key from stdin; `DEEPSEEK_API_KEY`
  and `./.env` still take precedence. ([2082b7e])
- Repository, homepage, and issue tracker metadata for the package. ([2082b7e])

### Fixed

- An existing config file is tightened to `0600` after writing, since `writeFileSync`
  only applies its mode when it creates the file. ([49373bd])
- The key file is written atomically: a private temp file in the same directory is
  renamed over the config, so a crash mid-save cannot leave a truncated key. ([ddeccec])

## [0.1.3] - 2026-10-27

### Changed

- The tag workflow now creates a GitHub Release with auto-generated notes for the tag it
  pushes, and leaves an existing release alone. npm publishing stays manual. ([eb482cf])

## [0.1.2] - 2026-10-27

### Added

- `--clean` removes the fetch endpoint's backslash escapes outside fenced code blocks, so
  headings, tables, and links render normally. `--json` still returns the raw
  response. ([a400ed4])

## [0.1.1] - 2026-10-27

### Added

- `-j` as an alias for `--json`. ([dbef2b0])
- `--json`/`-j` can be combined with `-o`/`--output` to write the raw API response to a
  file; stdout output stays Markdown unless `--json` is set. ([dbef2b0])

## [0.1.0] - 2026-10-27

Initial release.

### Added

- TypeScript CLI project scaffold and a local copy of the official DeepSeek Search and
  Fetch API guide. ([91806bf])
- `dsearch` CLI with `search` and `fetch`, `--json`, result count, and built-in help and
  version output. ([3a79737])
- Search and Fetch HTTP client, API key resolution from the environment, `./.env`, or the
  user config file, and terminal plus Markdown formatters. ([b407bb2])
- `-o`/`--output` writes Markdown to a file and creates parent directories. ([9c2b0de])
- A bare URL argument short-circuits to `fetch`, and leading options are accepted before a
  shorthand query. ([f536421], [48b5753])
- Fetch output shows the source URL under the title, and search headers wrap the query in
  backticks. ([46f5c53], [8ac0ea9])
- Unit tests, an integration suite against a local mock HTTP server, spawned-CLI tests,
  and opt-in live API tests. ([15294b4])
- CI workflow for lint, typecheck, build, and test, plus a tag-only release workflow. ([f9c5a63])
- README, AGENTS.md, `.env.example`, and example files. ([fb54749], [3c5f43f])

### Fixed

- The release workflow sets a git identity before creating annotated tags. ([bc4761f])

[1.1.0]: https://github.com/LaishGlenberg/deepseek-search-cli/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/LaishGlenberg/deepseek-search-cli/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/LaishGlenberg/deepseek-search-cli/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/LaishGlenberg/deepseek-search-cli/compare/v0.1.4...v1.0.0
[0.1.4]: https://github.com/LaishGlenberg/deepseek-search-cli/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/LaishGlenberg/deepseek-search-cli/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LaishGlenberg/deepseek-search-cli/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LaishGlenberg/deepseek-search-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/LaishGlenberg/deepseek-search-cli/releases/tag/v0.1.0

[902e256]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/902e256
[841c927]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/841c927
[5fcc7b7]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/5fcc7b7
[5f73073]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/5f73073
[e916335]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/e916335
[4b5077e]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/4b5077e
[47bbc88]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/47bbc88
[ddeccec]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/ddeccec
[49373bd]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/49373bd
[2082b7e]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/2082b7e
[eb482cf]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/eb482cf
[a400ed4]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/a400ed4
[dbef2b0]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/dbef2b0
[f536421]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/f536421
[46f5c53]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/46f5c53
[8ac0ea9]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/8ac0ea9
[3c5f43f]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/3c5f43f
[91806bf]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/91806bf
[bc4761f]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/bc4761f
[9c2b0de]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/9c2b0de
[48b5753]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/48b5753
[fb54749]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/fb54749
[f9c5a63]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/f9c5a63
[15294b4]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/15294b4
[3a79737]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/3a79737
[b407bb2]: https://github.com/LaishGlenberg/deepseek-search-cli/commit/b407bb2
