# Search Architecture

Requirements:

- huge library support (Flibusta-scale on NAS)
- indexed queries
- low memory usage
- deterministic SQL pagination

Avoid:

- full table scans on the hot path
- memory-heavy ranking / loading all hits into JS
- Elasticsearch / Meilisearch / Typesense for catalog metadata (not used)

## Pipeline

```text
User query
  → normalize + tokenize (createSortKey / operators)
  → light Russian stem expand (query-time OR variants)
  → main search: GET /api/search (or /catalog?q without field) → overview totals
  → user picks mode: books | authors | series
  → GET /api/catalog?field=… primary matcher
  → if empty: searchHints (tip + alternateModes + didYouMean)
  → paginated page
```

| Mode | Matcher |
|------|---------|
| Overview | `searchOverview` — capped book COUNT (≤10k, no full FTS materialization) + authors/series totals |
| Books | FTS5-driven: `FROM books_fts JOIN active_books … WHERE books_fts MATCH ?` + title boost then `bm25`; LIKE fallback when FTS is dirty/desynced, operator is `*`, or MATCH returns 0. Never `FROM active_books LEFT JOIN books_fts` (full library scan). |
| Authors | `listAuthors` (initials, token subset, surname) — also used by OPDS |
| Series | series name + mixed author+series both orders; **not** “all series by surname” |

Suggest (`GET /api/search/suggest`) is kept for API clients but **not used by the web UI** — search runs only on form submit (unified hub).

Unified hub (`GET /api/search?q=`):

```json
{ "query": "Лукьяненко", "books": { "total": 10000, "capped": true }, "authors": { "total": 2 }, "series": { "total": 5 } }
```

Empty catalog / API results may include additive `searchHints`:

- `tip` — `try_authors` / `try_series` / `try_books` when another mode has hits
- `alternateModes[]` — counts/samples in other modes for the same `q` (no auto-jump)
- `didYouMean[]` — 1–3 typo hints from compact `authors` / `series_catalog` (Levenshtein ≤ 1–2 on tokens length ≥ 4)

## Operators

| Operator | Meaning |
|----------|---------|
| (default) | Prefix FTS (`token*` + stem OR-expand); LIKE fallback: single token `token%`, multi-token `%token%` per token |
| `=` | Exact token / field equality |
| `*` | Contains (`%token%` via LIKE fallback) |
| `~` | Regex over a capped 5k-row scan (documented trade-off) |

## Morphology

Light Russian suffix stripping at **query time** (`src/search-stem.js`): each token ≥4 chars may expand to `( "облаками"* OR "облак"* )`. No Snowball, no external engine. Prefix FTS still covers many stems without expansion.

## FTS reliability

- Meta `books_fts_dirty=1` → FTS unusable → LIKE fallback
- Health probe (`getBooksFtsStatus`): compares `books` count vs `books_fts_docsize`; large gap → `desynced` → mark dirty + background rebuild
- Admin Operations dashboard shows FTS status chip (`ok` / `dirty` / `rebuilding` / `desynced` / `empty`)
- Exposed on `GET /api/index-status` and `/api/operations` as additive `ftsStatus`

## Ranking (books)

1. Exact `title_search` = full query sort-key
2. Prefix phrase `title_search LIKE query%`
3. `bm25(books_fts)` (FTS path) / author rank (LIKE path)
4. Requested catalog sort

## What we do not do

- Meilisearch / Elasticsearch / Typesense for catalog metadata
- Trigram FTS over all books (index size on NAS)
- Full morphological dictionaries / commercial stemmers
- Full-text of book **content** (fb2 body) — separate epic if ever needed

## Performance notes

- Pagination stays in SQL (`LIMIT` / `OFFSET`); no full-result materialization for normal queries
- Hot path must not use leading `%…%` on million-book LIKE for **single-token** default search
- Multi-token LIKE contains is only the FTS-unavailable fallback
- Keep `books_fts_dirty=0` and FTS docs ≈ book count after index/FTS rebuild
