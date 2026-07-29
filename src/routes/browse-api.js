/**
 * JSON API каталога и подсказок поиска (браузерный каталог).
 */
import { ApiErrorCode, apiFail } from '../api-errors.js';
import { PAGE_CACHE_TTL_MS } from '../constants.js';
import { getCachedPageData, getStaleOrSchedule } from '../services/cache.js';
import { safePage } from '../utils/safe-int.js';
import {
  getAuthorBooksGroupedCoalesced,
  getAuthorFlibustaSourceId,
  getSourceRoot,
  getBooksByFacetCoalesced,
  getBookById,
  getLibraryView,
  getSuggestions,
  listAuthors,
  listGenresGrouped,
  listSeries,
  resolveAuthorName,
  searchCatalog,
  searchOverview,
  listSearchGenres,
  parseGenreList,
  parseHasSeries
} from '../inpx.js';
import {
  readFlibustaAuthorBioHtml,
  readFlibustaAuthorPortraitForAuthorName
} from '../flibusta-sidecar.js';
import { getGenreGroups } from '../genre-map.js';
import { getLocale } from '../i18n.js';
import { getRecommendedLibraryView } from '../services/recommendations.js';
import { requireBrowseAuth } from '../middleware/auth.js';
import { t } from '../i18n.js';

/**
 * @param {import('express').Application} app
 */
export function registerBrowseApiRoutes(app) {
  app.get('/api/search/suggest', requireBrowseAuth, (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ books: [], authors: [], series: [] });
    const field = ['books', 'authors', 'series'].includes(String(req.query.field || ''))
      ? String(req.query.field)
      : 'books';
    res.json(getSuggestions(q, 5, field));
  });

  /** Unified search hub: totals for books / authors / series before field drilldown. */
  app.get('/api/search', requireBrowseAuth, (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.json({
        query: '',
        books: { total: 0 },
        authors: { total: 0 },
        series: { total: 0 }
      });
    }
    const cacheKey = `api:search:overview:${q}`;
    const result = getCachedPageData(cacheKey, () => searchOverview({ query: q }), PAGE_CACHE_TTL_MS);
    res.json(result);
  });

  /** Genres present in books matching q + filters (excludes genre filter for faceting). */
  app.get('/api/search/genres', requireBrowseAuth, (req, res) => {
    const q = String(req.query.q || '').trim();
    const lang = String(req.query.lang || '').trim();
    const format = String(req.query.format || '').trim();
    const year = Number(req.query.year) || 0;
    const minRate = Math.min(5, Math.max(0, Math.floor(Number(req.query.minRate) || 0)));
    const hasSeries = parseHasSeries(req.query.hasSeries);
    const cacheKey = `api:search:genres:${q}:${lang}:${format}:${year}:${minRate}:${hasSeries}`;
    const result = getCachedPageData(
      cacheKey,
      () => listSearchGenres({ query: q, lang, format, year, minRate, hasSeries }),
      PAGE_CACHE_TTL_MS
    );
    res.json(result);
  });

  app.get('/api/library/:view(recent|continue|read|recommended)', requireBrowseAuth, (req, res) => {
    const view = String(req.params.view);
    const page = safePage(req.query.page);
    const pageSizeRaw = Number(req.query.pageSize);
    const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 && pageSizeRaw <= 24
      ? Math.floor(pageSizeRaw)
      : 24;
    const type = String(req.query.type || '').trim();
    const requestedSort = String(req.query.sort || '');
    const defaultSort = view === 'recent' ? 'recent' : 'title';
    const sort = ['recent', 'title', 'author', 'series', 'rating'].includes(requestedSort) ? requestedSort : defaultSort;
    const order = String(req.query.order || '');
    const user = req.user || null;
    const canUseSharedCache = view === 'recent';
    const username = user?.username || '';
    const result = canUseSharedCache
      ? getStaleOrSchedule(`library:${view}:sort:${sort}:${order}:page:${page}:size:${pageSize}`, () => getLibraryView(view, { page, pageSize, sort, order }), PAGE_CACHE_TTL_MS, { total: 0, items: [] })
      : view === 'recommended'
        ? getRecommendedLibraryView({ page, pageSize, username })
        : view === 'continue' || view === 'read'
          ? getStaleOrSchedule(`library:${view}:${username}:sort:${sort}:${order}:p${page}:s${pageSize}`, () => getLibraryView(view, { page, pageSize, username, type, sort, order }), PAGE_CACHE_TTL_MS, { total: 0, items: [] })
          : getLibraryView(view, { page, pageSize, username, type, sort, order });
    const json = { items: result.items, total: result.total, page, pageSize };
    if (result.computing) json.computing = true;
    res.json(json);
  });

  app.get('/api/catalog', requireBrowseAuth, (req, res) => {
    const query = String(req.query.q || '');
    const field = ['books', 'authors', 'series'].includes(String(req.query.field || '')) ? String(req.query.field) : 'books';
    const isBookField = field === 'books';
    const bookSorts = ['recent', 'title', 'author', 'series', 'rating'];
    const entitySorts = ['name', 'count'];
    const allowedSorts = isBookField ? bookSorts : entitySorts;
    const sort = allowedSorts.includes(String(req.query.sort || '')) ? String(req.query.sort) : (isBookField ? 'title' : 'name');
    const order = String(req.query.order || '');
    const genres = parseGenreList(req.query.genre);
    const genre = genres.join(',');
    const letter = String(req.query.letter || '').trim().slice(0, 2);
    const lang = String(req.query.lang || '').trim();
    const format = String(req.query.format || '').trim();
    const year = Number(req.query.year) || 0;
    const minRate = Math.min(5, Math.max(0, Math.floor(Number(req.query.minRate) || 0)));
    const hasSeries = parseHasSeries(req.query.hasSeries);
    const page = safePage(req.query.page);
    const pageSize = 24;
    const cacheKey = `api:catalog:${field}:${sort}:${order}:${genre}:${letter}:${lang}:${format}:${year}:${minRate}:${hasSeries}:${query}:p${page}:s${pageSize}`;
    const result = getCachedPageData(
      cacheKey,
      () => searchCatalog({ query, page, pageSize, field, sort, order, genre, letter, lang, format, year, minRate, hasSeries }),
      PAGE_CACHE_TTL_MS
    );
    const payload = { items: result.items, total: result.total, page, pageSize, field: result.field };
    if (result.searchHints) payload.searchHints = result.searchHints;
    res.json(payload);
  });

  app.get('/api/browse/authors', requireBrowseAuth, (req, res) => {
    const page = safePage(req.query.page);
    const pageSize = 50;
    const sort = ['name', 'count'].includes(String(req.query.sort || '')) ? String(req.query.sort) : 'count';
    const query = String(req.query.q || '');
    const letter = String(req.query.letter || '').trim().slice(0, 2);
    const result = listAuthors({ query, page, pageSize, sort, order: '', letter });
    res.json({ ...result, page, pageSize });
  });

  app.get('/api/browse/series', requireBrowseAuth, (req, res) => {
    const page = safePage(req.query.page);
    const pageSize = 50;
    const sort = ['name', 'count'].includes(String(req.query.sort || '')) ? String(req.query.sort) : 'count';
    const query = String(req.query.q || '');
    const letter = String(req.query.letter || '').trim().slice(0, 2);
    const result = listSeries({ query, page, pageSize, sort, order: '', letter });
    res.json({ ...result, page, pageSize });
  });

  app.get('/api/browse/genres', requireBrowseAuth, (req, res) => {
    const sort = ['name', 'count'].includes(String(req.query.sort || '')) ? String(req.query.sort) : 'count';
    const allGenres = listGenresGrouped({ sort });
    const groups = getGenreGroups();
    const grouped = [];
    const entries = sort === 'name'
      ? Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], getLocale()))
      : Object.entries(groups);
    for (const [groupName, codes] of entries) {
      const codesSet = new Set(codes);
      const items = allGenres.filter((g) => codesSet.has(g.name));
      if (items.length) grouped.push({ groupName, items });
    }
    const allGrouped = new Set(Object.values(groups).flat());
    const uncategorized = allGenres.filter((g) => !allGrouped.has(g.name));
    if (uncategorized.length) grouped.push({ groupName: t('genre.other'), items: uncategorized });
    // groups — иерархия [{ groupName, items }], как genreGroups в HTML /genres
    // (не сырой map из getGenreGroups — его Android-клиент не умеет рендерить)
    res.json({ total: allGenres.length, items: allGenres, groups: grouped, page: 1, pageSize: allGenres.length });
  });

  app.get('/api/browse/authors/:value/grouped', requireBrowseAuth, async (req, res, next) => {
    try {
      let value = decodeURIComponent(String(req.params.value || '')).trim();
      const resolved = resolveAuthorName(value);
      if (resolved) value = resolved;
      const sort = ['recent', 'title', 'author', 'series', 'rating'].includes(String(req.query.sort || ''))
        ? String(req.query.sort)
        : 'title';
      const order = String(req.query.order || '');
      const flibSourceId = getAuthorFlibustaSourceId(value);
      const facetRoot = flibSourceId != null ? getSourceRoot(flibSourceId) : '';
      const [grouped, bioHtml, portrait] = await Promise.all([
        getAuthorBooksGroupedCoalesced(value, sort, order, { page: 1, pageSize: 48 }),
        flibSourceId != null
          ? readFlibustaAuthorBioHtml(value, facetRoot, flibSourceId).catch(() => '')
          : Promise.resolve(''),
        flibSourceId != null
          ? readFlibustaAuthorPortraitForAuthorName(value, facetRoot).catch(() => null)
          : Promise.resolve(null),
      ]);
      res.json({
        series: grouped.series,
        standaloneBooks: grouped.standaloneBooks,
        total: grouped.total,
        bioHtml: bioHtml || '',
        hasPortrait: !!(portrait?.data?.length),
        authorName: value,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/facet-books', requireBrowseAuth, async (req, res, next) => {
    try {
      const facet = String(req.query.facet || '').trim();
      const value = String(req.query.value ?? '').trim();
      const sort = String(req.query.sort || (facet === 'series' ? 'series' : 'title')).trim();
      const order = String(req.query.order || '');
      const page = safePage(req.query.page);
      const pageSize = 24;
      const allowed = new Set(['authors', 'series', 'genres', 'languages']);
      if (!allowed.has(facet) || !value) {
        return apiFail(res, 400, ApiErrorCode.FACET_INVALID, t('api.facet.invalid'), { items: [], total: 0, page, pageSize });
      }
      let author = facet === 'series' ? String(req.query.author || '').trim() : '';
      if (author) {
        const canonical = resolveAuthorName(author);
        author = canonical ?? author.toLowerCase();
      }
      const result = await getBooksByFacetCoalesced({ facet, value, page, pageSize, sort, order, author });
      res.json({ items: result.items, total: result.total, page, pageSize });
    } catch (error) {
      next(error);
    }
  });

  /** Метаданные книги для мобильного клиента (серия, автор, ext). */
  app.get('/api/books/:id/meta', requireBrowseAuth, (req, res) => {
    const book = getBookById(req.params.id);
    if (!book) {
      return apiFail(res, 404, ApiErrorCode.BOOK_NOT_FOUND, t('book.notFound'));
    }
    res.json({
      id: book.id,
      title: book.title,
      authors: book.authors,
      authorsList: book.authorsList,
      genres: book.genres,
      genresDisplayList: book.genresDisplayList,
      series: book.series || '',
      seriesNo: book.seriesNo || '',
      seriesList: book.seriesList || [],
      ext: book.ext,
      date: book.date,
      libRate: book.libRate,
      size: book.size,
    });
  });
}
