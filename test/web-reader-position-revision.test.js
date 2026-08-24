import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptPositionSave,
  acceptServerPosition,
  decidePositionOnOpen,
  dismissServerPosition,
  markPositionDirty,
  normalizeSeenContext,
  observeServerConflict,
  positionFields,
  shouldPromptLiveCrossDevice,
  shouldRetryPositionConflict,
} from '../public/reader-shared/position-revision.js';
import { createSuppressionCounter } from '../public/reader-shared/suppression-counter.js';

function local(overrides = {}) {
  return {
    positionVersion: 4,
    baseRevision: 2,
    serverRevision: 2,
    positionDirty: false,
    position: 'epubcfi(/6/4)',
    progress: 20,
    fraction: 0.2,
    sectionIndex: 1,
    sectionPageFraction: 0.25,
    paginatorPage: 2,
    paginatorPages: 8,
    layoutMode: 'paginated',
    textOffset: 120,
    textQuote: 'local exact quote',
    textSectionLength: 1000,
    updatedAt: '2026-07-12T10:00:00.000Z',
    ...overrides,
  };
}

function server(overrides = {}) {
  return {
    positionVersion: 4,
    revision: 3,
    position: 'epubcfi(/6/12)',
    progress: 60,
    fraction: 0.6,
    sectionIndex: 4,
    sectionPageFraction: 0.5,
    paginatorPage: 5,
    paginatorPages: 12,
    layoutMode: 'paginated',
    textOffset: 450,
    textQuote: 'server exact quote',
    textSectionLength: 1200,
    updatedAt: '2026-07-12T11:00:00.000Z',
    ...overrides,
  };
}

describe('web reader position revision state', () => {
  it('prompts for a newer differing server revision when local state has a position', () => {
    assert.equal(decidePositionOnOpen(local(), server()), 'prompt');
    const accepted = acceptServerPosition(local(), server());
    assert.equal(accepted.position, server().position);
    assert.equal(accepted.fraction, 0.6);
    assert.equal(accepted.sectionIndex, 4);
    assert.equal(accepted.paginatorPage, 5);
    assert.equal(accepted.baseRevision, 3);
    assert.equal(accepted.serverRevision, 3);
    assert.equal(accepted.positionDirty, false);
    assert.equal(accepted.positionVersion, 4);
    assert.equal(accepted.textOffset, 450);
    assert.equal(accepted.textQuote, 'server exact quote');
    assert.equal(accepted.textSectionLength, 1200);
  });

  it('silently pulls a newer server revision on a fresh client without a local position', () => {
    assert.equal(decidePositionOnOpen(local({
      position: '',
      progress: 0,
      fraction: 0,
      sectionIndex: null,
      textOffset: null,
      paginatorPage: null,
      sectionPageFraction: null,
    }), server()), 'server');
  });

  it('defers a newer differing server revision when local state is dirty', () => {
    const dirty = local({ positionDirty: true });
    assert.equal(decidePositionOnOpen(dirty, server()), 'prompt');
    const observed = observeServerConflict(dirty, server());
    assert.equal(observed.baseRevision, 2);
    assert.equal(observed.serverRevision, 3);
    assert.equal(observed.positionDirty, true);
    assert.equal(observed.position, dirty.position);
    assert.equal(observed.pendingServerPosition.position, server().position);
    assert.equal(observed.pendingServerPosition.sectionIndex, 4);
    assert.equal(observed.pendingServerPosition.paginatorPage, 5);
    assert.equal(observed.pendingServerPosition.textOffset, 450);
    assert.equal(observed.pendingServerPosition.textQuote, 'server exact quote');
  });

  it('treats different exact text anchors as different positions', () => {
    const dirty = local({ positionDirty: true, fraction: 0.5, textOffset: 100 });
    const remote = server({ fraction: 0.5, textOffset: 101 });
    assert.equal(decidePositionOnOpen(dirty, remote), 'prompt');
  });

  it('resets legacy FB2 state but keeps legacy EPUB state dirty', () => {
    const legacy = {
      positionVersion: 3,
      position: 'epubcfi(/6/8)',
      progress: 42,
      fraction: 0.42,
      fb2Href: '9#2',
    };
    assert.deepEqual(
      normalizeSeenContext(legacy, { isFb2: true }),
      {
        positionVersion: 4,
        baseRevision: 0,
        serverRevision: 0,
        positionDirty: false,
        position: '',
        progress: 0,
        fraction: 0,
        fb2Href: null,
        sectionIndex: null,
        sectionPageFraction: null,
        paginatorPage: null,
        paginatorPages: null,
        layoutMode: null,
        textOffset: null,
        textQuote: null,
        textSectionLength: null,
        updatedAt: null,
        serverUpdatedAt: null,
        dismissedUpdatedAt: null,
        dismissedServerRevision: null,
        dismissedServerSessionId: null,
      },
    );
    const migratedEpub = normalizeSeenContext(legacy, { isFb2: false });
    assert.match(migratedEpub.position, /^epubcfi/);
    assert.equal(migratedEpub.progress, 0);
    assert.equal(migratedEpub.fraction, 0);
    assert.equal(migratedEpub.fb2Href, null);
    assert.equal(migratedEpub.sectionIndex, null);
    assert.equal(migratedEpub.paginatorPage, null);
    assert.equal(migratedEpub.layoutMode, null);
    assert.equal(migratedEpub.positionVersion, 4);
    assert.equal(migratedEpub.positionDirty, true);
  });

  it('marks dirty before CAS and clears it only for the accepted mutation', () => {
    const changedAt = '2026-07-12T12:00:00.000Z';
    const sent = server({ revision: undefined, updatedAt: undefined });
    const dirty = markPositionDirty(local(), sent, changedAt);
    assert.equal(dirty.baseRevision, 2);
    assert.equal(dirty.positionDirty, true);
    assert.equal(dirty.paginatorPages, 12);
    assert.equal(dirty.textOffset, 450);
    assert.equal(dirty.textQuote, 'server exact quote');

    const accepted = acceptPositionSave(
      dirty,
      sent,
      { revision: 3, updatedAt: '2026-07-12T12:00:01.000Z' },
      changedAt,
    );
    assert.equal(accepted.baseRevision, 3);
    assert.equal(accepted.serverRevision, 3);
    assert.equal(accepted.positionDirty, false);

    const newerLocal = markPositionDirty(dirty, { ...sent, fraction: 0.7 }, '2026-07-12T12:00:00.500Z');
    const staleSuccess = acceptPositionSave(
      newerLocal,
      sent,
      { revision: 3, updatedAt: '2026-07-12T12:00:01.000Z' },
      changedAt,
    );
    assert.equal(staleSuccess.baseRevision, 3);
    assert.equal(staleSuccess.positionDirty, true);
    assert.equal(staleSuccess.fraction, 0.7);
  });

  it('declines by adopting the server revision without moving local coordinates', () => {
    const dirty = local({ positionDirty: true });
    const dismissed = dismissServerPosition(dirty, server());
    assert.equal(dismissed.position, dirty.position);
    assert.equal(dismissed.fraction, dirty.fraction);
    assert.equal(dismissed.textOffset, dirty.textOffset);
    assert.equal(dismissed.baseRevision, 3);
    assert.equal(dismissed.serverRevision, 3);
    assert.equal(dismissed.positionDirty, false);
    assert.equal(dismissed.dismissedServerRevision, 3);
    assert.equal(dismissed.dismissedServerSessionId, '');
    assert.equal(decidePositionOnOpen(dismissed, server()), 'local');

    const moved = markPositionDirty(
      dismissed,
      { ...dirty, position: 'epubcfi(/6/6)', fraction: 0.3 },
      '2026-07-12T12:30:00.000Z',
    );
    assert.equal(moved.baseRevision, 3);
    assert.equal(moved.positionDirty, true);
    assert.equal(moved.dismissedServerRevision, null);
    assert.equal(moved.dismissedServerSessionId, '');
  });

  it('falls back to progress for null and empty fractions', () => {
    assert.equal(positionFields({ progress: 42, fraction: null }).fraction, 0.42);
    assert.equal(positionFields({ progress: 37, fraction: '' }).fraction, 0.37);
    assert.equal(positionFields({ progress: 25, fraction: '  ' }).fraction, 0.25);
    assert.equal(positionFields({ progress: 90, fraction: 0 }).fraction, 0);
  });

  it('keeps suppression active across nested asynchronous restores', async () => {
    const suppression = createSuppressionCounter();
    await suppression.run(async () => {
      assert.equal(suppression.isSuppressed(), true);
      await suppression.run(async () => {
        assert.equal(suppression.isSuppressed(), true);
      });
      assert.equal(suppression.isSuppressed(), true);
    });
    assert.equal(suppression.isSuppressed(), false);
  });

  it('prompts live only for another session with different coordinates', () => {
    const localPos = local({ dismissedServerRevision: null, pendingCrossDevicePrompt: false });
    const other = server({ sessionId: 'phone', fraction: 0.6, progress: 60, position: 'epubcfi(/6/10)' });
    assert.equal(shouldPromptLiveCrossDevice('tablet', localPos, other), true);
    assert.equal(shouldPromptLiveCrossDevice('phone', localPos, other), false);
    assert.equal(shouldPromptLiveCrossDevice('tablet', localPos, { ...other, sessionId: null }), true);
    assert.equal(shouldPromptLiveCrossDevice('tablet', { ...localPos, dismissedServerRevision: 3 }, other), false);
    assert.equal(
      shouldPromptLiveCrossDevice('tablet', { ...localPos, pendingCrossDevicePrompt: true, serverRevision: 3 }, other),
      false,
    );
    assert.equal(shouldPromptLiveCrossDevice('tablet', localPos, {
      ...other,
      position: localPos.position,
      fraction: localPos.fraction,
      progress: localPos.progress,
      sectionIndex: localPos.sectionIndex,
      textOffset: localPos.textOffset,
    }), false);
  });

  it('keeps live dismiss bound to the holder session across relocates and new revisions', () => {
    const localPos = local({ dismissedServerRevision: null, pendingCrossDevicePrompt: false });
    const phone = server({ sessionId: 'phone', revision: 3 });
    const dismissed = dismissServerPosition(localPos, phone);
    assert.equal(dismissed.dismissedServerSessionId, 'phone');
    const moved = markPositionDirty(dismissed, { ...localPos, fraction: 0.25 }, '2026-07-12T12:30:00.000Z');
    assert.equal(moved.dismissedServerSessionId, 'phone');
    assert.equal(shouldPromptLiveCrossDevice('tablet', moved, {
      ...phone,
      revision: 12,
      fraction: 0.9,
      progress: 90,
      position: 'epubcfi(/6/99)',
      textOffset: 900,
    }), false);
    assert.equal(shouldPromptLiveCrossDevice('tablet', moved, server({ sessionId: 'other-phone', revision: 13 })), true);
    assert.equal(
      shouldPromptLiveCrossDevice(
        'tablet',
        dismissServerPosition(localPos, server({ sessionId: null })),
        server({ sessionId: null, revision: 8 }),
      ),
      false,
    );
  });

  it('retries 409 only for the same session or a legacy holder', () => {
    assert.equal(shouldRetryPositionConflict('tablet', { sessionId: 'tablet' }), true);
    assert.equal(shouldRetryPositionConflict('tablet', { sessionId: null }), true);
    assert.equal(shouldRetryPositionConflict('tablet', { sessionId: 'phone' }), false);
  });
});
