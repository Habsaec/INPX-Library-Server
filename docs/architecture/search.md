# Search Architecture

Requirements:

- huge library support (Flibusta-scale on NAS)
- indexed queries
- low memory usage
- deterministic SQL pagination

Avoid:

- full table scans on the hot path
- memory-heavy ranking / loading all hits into JS
- Elasticsearch / Meilisearch for catalog metadata (not used)

## Pipeline

```text
User query
  → normalize + tokenize (createSortKey / operators)
  → main search: GET /api/search (or /catalog?q without field) → overview totals
  → user picks mode: books | authors | series
  → GET /api/catalog?field=… primary matcher
  → if empty: searchHints (cross-mode + did-you-mean)
  → paginated page
```

| Mode | Matcher |
|------|---------|
| Overview | `searchOverview` — capped book COUNT (≤10k, no full FTS materialization) + authors/series totals |
| Books | FTS5-driven: `FROM books_fts JOIN active_books … WHERE books_fts MATCH ?` + `bm25`; LIKE fallback when FTS is dirty, operator is `*`, or FTS is unavailable. Never `FROM active_books LEFT JOIN books_fts` (full library scan). |
| Authors | `listAuthors` (initials, token subset, surname) |
| Series | series name + mixed author+series both orders; **not** “all series by surname” |

Suggest (`GET /api/search/suggest`) is kept for API clients but **not used by the web UI** — search runs only on form submit (unified hub).

Unified hub (`GET /api/search?q=`):

```json
{ "query": "Лукьяненко", "books": { "total": 10000, "capped": true }, "authors": { "total": 2 }, "series": { "total": 5 } }
```

Empty catalog / API results may include additive `searchHints`:

- `alternateModes[]` — counts/samples in other modes for the same `q` (no auto-jump)
- `didYouMean[]` — 1–3 typo hints from compact `authors` / `series_catalog` (Levenshtein ≤ 1–2 on tokens length ≥ 4)

## Operators

| Operator | Meaning |
|----------|---------|
| (default) | Prefix (`token*` in FTS; `token%` in LIKE fallback) |
| `=` | Exact token / field equality |
| `*` | Contains (`%token%` via LIKE fallback) |
| `~` | Regex over a capped 5k-row scan (documented trade-off) |

## What we do not do (this wave)

- Meilisearch / Elasticsearch for catalog metadata
- Trigram FTS over all books (index size on NAS)
- Russian Snowball morphology (prefix FTS covers many stems)

Full-text of book **content** would be a separate epic if ever needed.

## Performance notes

- Pagination stays in SQL (`LIMIT` / `OFFSET`); no full-result materialization for normal queries
- Hot path must not use leading `%…%` on million-book LIKE scans
- Keep `books_fts_dirty=0` after index/FTS rebuild; dirty forces LIKE fallback
