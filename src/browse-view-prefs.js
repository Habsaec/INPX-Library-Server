import { getUserBrowseViewPrefs } from './db.js';

/** @returns {''|'grid'|'list'} */
export function normalizeBrowseViewMode(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'list') return 'list';
  if (v === 'grid' || v === 'covers') return 'grid';
  return '';
}

/**
 * Resolve covers/list mode for home or catalog-scoped pages.
 * Explicit `?view=` overrides the logged-in preference; guests default to grid.
 * @param {{ username?: string, queryView?: string, scope?: 'home'|'catalog' }} opts
 * @returns {'grid'|'list'}
 */
export function resolveBrowseViewMode({ username = '', queryView = '', scope = 'catalog' } = {}) {
  const fromQuery = normalizeBrowseViewMode(queryView);
  if (fromQuery) return fromQuery;
  if (username) {
    const prefs = getUserBrowseViewPrefs(username);
    const mode = scope === 'home' ? prefs.homeView : prefs.catalogView;
    return mode === 'list' ? 'list' : 'grid';
  }
  return 'grid';
}

export function isListBrowseView(opts) {
  return resolveBrowseViewMode(opts) === 'list';
}
