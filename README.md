# deepseek-search-cli

[![npm version](https://img.shields.io/npm/v/deepseek-search-cli.svg?logo=npm)](https://www.npmjs.com/package/deepseek-search-cli)
[![Downloads](https://img.shields.io/npm/dm/deepseek-search-cli?logo=npm)](https://www.npmjs.com/package/deepseek-search-cli)
[![Build Status](https://github.com/LaishGlenberg/deepseek-search-cli/workflows/CI/badge.svg)](https://github.com/LaishGlenberg/deepseek-search-cli/actions)

Search the web and fetch pages as Markdown from your terminal, using DeepSeek's
native [Search and Fetch APIs](https://api-docs.deepseek.com/guides/search).

`dsearch` gives you live web results with titles, URLs, dates, relevance scores, and
optional full page content. It is a small, zero-dependency wrapper around:

- `POST /v1/tools/search` — find web pages for a query
- `POST /v1/tools/fetch` — retrieve a page as Markdown

<p align="center">
  <img
    src="https://raw.githubusercontent.com/LaishGlenberg/deepseek-search-cli/main/docs/assets/search-sequence.gif"
    alt="Terminal recording of dsearch searching the web and fetching a page"
    width="800"
  />
</p>

## Quick start

```bash
npm install -g deepseek-search-cli
dsearch auth
dsearch "DeepSeek V4 release"
```

`dsearch auth` prompts for your API key (input is hidden, or pipe it in) and saves it
for every project. It prints the file it wrote. `DEEPSEEK_API_KEY` and a `.env` in the
current directory take precedence over the saved key.

The key is stored as plaintext JSON readable only by your user (`0600` on Linux and
macOS). When piping, avoid `echo`, which leaves the key in shell history:

```bash
read -rs DEEPSEEK_KEY && printf '%s' "$DEEPSEEK_KEY" | dsearch auth
```

```bash
dsearch search "DeepSeek site:github.com after:2025" -n 5
```

## Install

Requires Node.js 20 or newer.

```bash
npm install -g deepseek-search-cli
# or run without installing
npx deepseek-search-cli "DeepSeek V4 release"
```

## Usage

```text
dsearch search <query...> [options]
dsearch fetch <url> [options]
dsearch "<query>" [options]
dsearch <url> [options]
```

A bare query searches; a URL starting with `http://` or `https://` fetches that
page, so `dsearch https://example.com` is shorthand for `dsearch fetch`.

### `dsearch search`

| Option | Description |
| --- | --- |
| `-n, --count <1-50>` | Number of results to return (default `10`) |
| `--content` | Include full page content in each result |
| `--ori-question <text>` | Original user question, improves query understanding |
| `--localization <ip>` | IP address used to localize results |
| `-o, --output <file>` | Write results to a file instead of stdout (JSON with `--json`, Markdown otherwise) |
| `-j, --json` | Print the raw API response as JSON |
| `-h, --help` | Show help |
| `-v, --version` | Show the version |

Option values can also use `--count=5`. Everything after `--` is treated as query
text, which is useful for queries starting with a dash. Options may come before or
after the query in shorthand mode. Combine `--json` with `--output` to save the raw
API response to a file.

### `dsearch fetch`

Fetches a single page and prints its URL, title, and Markdown content.

| Option | Description |
| --- | --- |
| `-o, --output <file>` | Write the page to a file instead of stdout (JSON with `--json`, Markdown otherwise) |
| `-j, --json` | Print the raw API response as JSON |
| `--clean` | Unescape Markdown punctuation in the fetched content |
| `-h, --help` | Show help |

The fetch endpoint returns Markdown with every ASCII punctuation character
backslash-escaped (`\#`, `\-`, `\(`, `\.`, `\/`). That breaks headings, tables, and
links, and `\(`/`\[` are read as math delimiters by KaTeX-based renderers. `--clean`
removes those escapes outside fenced code blocks so the page renders normally;
`--json` still returns the API response unchanged.

### Examples

```bash
# Search and print the top 5 results with summaries
dsearch search "DeepSeek V4 release" -n 5

# Include the full page content of each result
dsearch "DeepSeek V4 release" --content

# Restrict results by site, language, and date
dsearch "DeepSeek site:github.com OR site:huggingface.co lang:en after:2025"

# Pipe URLs into other tools
dsearch search "DeepSeek API docs" --json | jq -r '.results[].url'

# Save results or a fetched page as Markdown (parent directories are created)
dsearch "DeepSeek V4 release" -n 5 -o notes/deepseek-v4.md
dsearch fetch https://api-docs.deepseek.com/guides/search -o docs/search-api.md

# Save the raw API response as JSON
dsearch "DeepSeek V4 release" -n 5 -j -o results.json
dsearch fetch https://api-docs.deepseek.com/guides/search --json -o docs/search-api.json

# Unescape the fetch endpoint's escaped Markdown so headings and tables render
dsearch fetch https://api-docs.deepseek.com/quick_start/pricing/ --clean -o docs/pricing.md

# Fetch a page as Markdown
dsearch fetch https://api-docs.deepseek.com/guides/search
```

Search output looks like this:

```text
2 results for `DeepSeek V4 release`

1. DeepSeek V4 model released [2.4]
   https://example.com/deepseek-v4
   Example News · 2026-06-01 · authority 3

   DeepSeek has released the V4 model. The release adds improved tool calling
   and long-context support for agent workflows.

2. DeepSeek V4 benchmark results [2.1]
   https://example.com/deepseek-v4-benchmarks
   Example Research · 2026-06-02 · authority 3

   Benchmark results for the V4 model across reasoning and coding tasks.
```

`--json` prints the API response unchanged, including `snippet`, `summary`,
`content`, `site_icon`, `authority`, and `rerank_score` for every result.

## Query operators

The query is sent to DeepSeek unchanged, so its search syntax works as documented:

| Operator | Example | Description |
| --- | --- | --- |
| `site:` | `DeepSeek site:github.com` | Restrict results to a site |
| `-site:` | `DeepSeek -site:example.com` | Exclude a site |
| `-` | `DeepSeek -advertisement` | Exclude a term |
| `"..."` | `DeepSeek "exact phrase"` | Match an exact phrase |
| `lang:` | `DeepSeek lang:zh,en` | Restrict languages |
| `after:` | `DeepSeek after:2025-01-01` | Published after a date |
| `before:` | `DeepSeek before:2026-06-01` | Published before a date |

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | Yes | API key from [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| `DEEPSEEK_BASE_URL` | No | API base URL (default `https://api.deepseek.com`) |

The key is read from the environment first, then from `./.env`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, including searches with no results |
| `1` | API or network error |
| `2` | Usage or configuration error |

A `401` means the API key is missing or invalid, `402` means the account has
insufficient balance, and `429` means the rate limit was exceeded.

Search and Fetch are billed per successful request ($0.75 per 1,000 requests at the
time of writing) and rate limited to 100 and 25 requests per second respectively.
See the [API guide](https://api-docs.deepseek.com/guides/search) for current details.

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

Tests use a local mock HTTP server; the optional live API tests are billed and only run
with `RUN_LIVE_TESTS=1 npm run test:live`. Release and repository conventions live in
[AGENTS.md](AGENTS.md).

## License

MIT
