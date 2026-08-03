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
  → normalize (createSortKey + ё→е + mixed lookalike Latin/Cyrillic)
  → optional author+title split (content tokens; no FTS peek loop)
  → light Russian stem expand (query-time OR variants)
  → web `/catalog?q` (no field): always books page + section chips (Авторы / Серии)
  → GET /api/search: totals for chips / Android (`routeField` always null)
  → typeahead: GET /api/search/suggest (web dropdown + Android)
  → GET /api/catalog?field=authors|series from chips
  → empty: recovery hints + one typo retry; weak: ≤1 did-you-mean
  → paginated page (edition dedupe by title+author)
```

| Mode | Matcher |
|------|---------|
| Overview | `searchOverview` — capped book COUNT (≤10k) + authors/series totals + soft `preferredField`; `routeField` always null |
| Books | FTS5 MATCH + title boost (exact/prefix/ordered-token) then `bm25`; author+title split when confident; phrase OR; stopwords skipped in AND; LIKE fallback when dirty/desynced/`*`/zero MATCH; free-text uses capped COUNT |
| Authors | `listAuthors` (also OPDS) |
| Series | series name + mixed author+series |

## Web navigation

Enter always opens **books** (Flibusta-like). Authors / series are chips above results — no hub screen and no smart 302 redirect. `preferredField` remains a soft API hint (series only when no author hits).

## Operators

| Operator | Meaning |
|----------|---------|
| (default) | Prefix FTS (`token*` + stem OR-expand) + multi-token phrase OR; LIKE: single `token%`, multi `%token%` |
| `=` | Exact token |
| `*` | Contains via LIKE |
| `~` | Regex over capped 5k-row scan |

## Morphology

- Query-time stem expand (`src/search-stem.js`)
- Index-time: stemmed tokens appended to `title_search` / `authors_search` (meta `search_stems_v1` backfill)
- Mixed Latin/Cyrillic lookalikes normalized at query time only (`src/search-normalize.js`)

## Hot-path speed rules

1. Overview never materializes/ranks 24 books synchronously
2. No typo dictionary on suggest / overview
3. No alternate-mode rescans except empty catalog results
4. Suggest: `totalMode: 'omit'`; multi-word book suggest uses `field: 'title'`
5. FTS when healthy; LIKE only on miss/dirty/`*`

## FTS reliability

- `books_fts_dirty`, desync probe vs `books_fts_docsize`
- Auto-recovery: desync → dirty; dirty also scheduled from search hot path
- Admin: FTS status + **Rebuild FTS** (`POST /api/operations/fts-rebuild`)
- Post-index / post-rebuild: `warmupSearchFts`

## Did-you-mean

Authors + series + `search_title_tokens` (≤50k). Empty catalog → full `searchHints`; weak books page → ≤1 suggestion. Typo retry only after a true miss at catalog layer.

## Ranking (books)

1. Exact / stemmed-prefix `title_search`
2. Ordered token contains (`%a%b%c%`)
3. Prefix phrase
4. `bm25` / author rank
5. Catalog sort; page-level edition dedupe

## UX extras

- Web suggest dropdown → `/api/search/suggest` (+ history); debounce ≥300ms, min 3 chars
- Genre facets for free-text load via `/api/search/genres` after HTML
- Section chips (Книги / Авторы / Серии) above catalog results for free-text `q`
- Helpers: `src/search-enhance.js` (warm cache, dedupe; `routeField` unused)

## What we do not do

- Meilisearch / Elasticsearch / Typesense
- Trigram FTS over all books
- Full-text of book content (fb2 body)
