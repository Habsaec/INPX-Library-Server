/** Locale keys for bulk-import DB index names (UI progress). */
const BULK_INDEX_LABEL_KEYS = {
  idx_book_authors_author_id: 'index.dbLabel.book_authors_author_id',
  idx_book_authors_book_id: 'index.dbLabel.book_authors_book_id',
  idx_book_genres_genre_id: 'index.dbLabel.book_genres_genre_id',
  idx_book_genres_book_id: 'index.dbLabel.book_genres_book_id',
  idx_book_series_series_id: 'index.dbLabel.book_series_series_id',
  idx_book_series_book_id: 'index.dbLabel.book_series_book_id',
  idx_books_title_sort: 'index.dbLabel.books_title_sort',
  idx_books_author_sort: 'index.dbLabel.books_author_sort',
  idx_books_series_sort_series_index: 'index.dbLabel.books_series_sort_series_index',
  idx_books_imported_at: 'index.dbLabel.books_imported_at',
  idx_books_date_imported_at: 'index.dbLabel.books_date_imported_at',
  idx_books_title_search: 'index.dbLabel.books_title_search',
  idx_books_authors_search: 'index.dbLabel.books_authors_search',
  idx_books_series_search: 'index.dbLabel.books_series_search',
  idx_books_genres_search: 'index.dbLabel.books_genres_search',
  idx_books_keywords_search: 'index.dbLabel.books_keywords_search',
  idx_books_source_id: 'index.dbLabel.books_source_id',
  idx_books_deleted: 'index.dbLabel.books_deleted',
  idx_books_deleted_source: 'index.dbLabel.books_deleted_source',
  idx_books_lang: 'index.dbLabel.books_lang',
  idx_books_ext: 'index.dbLabel.books_ext',
  idx_books_lang_norm: 'index.dbLabel.books_lang_norm',
  idx_books_series_index_title: 'index.dbLabel.books_series_index_title',
  idx_books_deleted_deleted0: 'index.dbLabel.books_deleted_deleted0',
  idx_books_deleted_lang: 'index.dbLabel.books_deleted_lang',
  idx_books_deleted_ext: 'index.dbLabel.books_deleted_ext',
  idx_books_recent_sort: 'index.dbLabel.books_recent_sort',
  idx_books_author_title_id: 'index.dbLabel.books_author_title_id',
  idx_books_series_full: 'index.dbLabel.books_series_full',
  idx_books_rating: 'index.dbLabel.books_rating',
  idx_books_title_sort_authors: 'index.dbLabel.books_title_sort_authors',
  idx_authors_sort_name: 'index.dbLabel.authors_sort_name',
  idx_authors_search_name: 'index.dbLabel.authors_search_name',
  idx_authors_book_count: 'index.dbLabel.authors_book_count',
  idx_authors_name: 'index.dbLabel.authors_name',
  idx_series_catalog_sort_name: 'index.dbLabel.series_catalog_sort_name',
  idx_series_catalog_search_name: 'index.dbLabel.series_catalog_search_name',
  idx_series_catalog_book_count: 'index.dbLabel.series_catalog_book_count',
  idx_series_catalog_name: 'index.dbLabel.series_catalog_name',
  idx_genres_catalog_sort_name: 'index.dbLabel.genres_catalog_sort_name',
  idx_genres_catalog_search_name: 'index.dbLabel.genres_catalog_search_name',
  idx_genres_catalog_book_count: 'index.dbLabel.genres_catalog_book_count',
  idx_genres_catalog_name: 'index.dbLabel.genres_catalog_name',
};

export function getBulkIndexLabelKey(name) {
  const key = String(name || '');
  if (BULK_INDEX_LABEL_KEYS[key]) return BULK_INDEX_LABEL_KEYS[key];
  if (key.startsWith('idx_books_')) return 'index.dbLabel.fallback_books';
  if (key.startsWith('idx_book_authors_')) return 'index.dbLabel.fallback_book_authors';
  if (key.startsWith('idx_book_genres_')) return 'index.dbLabel.fallback_book_genres';
  if (key.startsWith('idx_book_series_')) return 'index.dbLabel.fallback_book_series';
  if (key.startsWith('idx_authors_')) return 'index.dbLabel.fallback_authors';
  if (key.startsWith('idx_series_catalog_')) return 'index.dbLabel.fallback_series_catalog';
  if (key.startsWith('idx_genres_catalog_')) return 'index.dbLabel.fallback_genres_catalog';
  return 'index.dbLabel.fallback_db';
}

/**
 * @param {{ key?: string, params?: Record<string, unknown> } | null | undefined} stage
 * @param {(key: string) => string} t
 * @param {(key: string, vars: Record<string, unknown>) => string} tp
 */
export function resolveIndexStageLine(stage, t, tp) {
  if (!stage?.key) return '';
  const params = { ...(stage.params || {}) };
  if (params.labelKey) {
    params.label = t(String(params.labelKey));
    delete params.labelKey;
  }
  if (params.phaseKey) {
    params.phase = t(String(params.phaseKey));
    delete params.phaseKey;
  }
  return tp(stage.key, params);
}
