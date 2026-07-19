import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMergeInputFromLocalCtx,
  buildMergeInputFromOfflineStore,
  buildCrossDevicePromptLines,
  compareFb2Hrefs,
  effectiveSavedFraction,
  formatPositionProgressLabel,
  fractionFromFb2HrefWithToc,
  parseSyncTs,
  savedFraction,
  serverEditUnseenOnThisClient,
  positionsMeaningfullyDiffer,
  shouldShowCrossDevicePositionPrompt,
  shouldUseServerPosition,
} from '../public/position-sync.js';

describe('position-sync', () => {
  it('prompts when server position is newer and differs', () => {
    const input = buildMergeInputFromLocalCtx(
      {
        position: '',
        progress: 20,
        fraction: 0.2,
        updatedAt: '2026-07-11T10:00:00.000Z',
        serverUpdatedAt: '2026-07-11T08:00:00.000Z',
        serverProgress: 20,
        dismissedUpdatedAt: null,
      },
      {
        position: '',
        progress: 85,
        fraction: 0.85,
        updatedAt: '2026-07-12T14:00:00.000Z',
      },
    );
    assert.equal(shouldUseServerPosition(input), true);
    assert.equal(shouldShowCrossDevicePositionPrompt(input), true);
  });

  it('does not silently pull a server rev the user declined ("stay here")', () => {
    const input = buildMergeInputFromLocalCtx(
      {
        position: '',
        progress: 20,
        fraction: 0.2,
        fb2Href: '3#1',
        updatedAt: '2026-07-11T10:00:00.000Z',
        serverUpdatedAt: '2026-07-12T14:00:00.000Z',
        serverProgress: 20,
        dismissedUpdatedAt: '2026-07-12T14:00:00.000Z',
      },
      {
        position: '',
        progress: 85,
        fraction: 0.85,
        fb2Href: '9#2',
        updatedAt: '2026-07-12T14:00:00.000Z',
      },
    );
    assert.equal(shouldUseServerPosition(input), false);
    assert.equal(shouldShowCrossDevicePositionPrompt(input), false);
  });

  it('pulls a newer server rev once the declined one is superseded', () => {
    const input = buildMergeInputFromLocalCtx(
      {
        position: '',
        progress: 20,
        fraction: 0.2,
        fb2Href: '3#1',
        updatedAt: '2026-07-11T10:00:00.000Z',
        serverUpdatedAt: '2026-07-12T16:00:00.000Z',
        serverProgress: 20,
        dismissedUpdatedAt: '2026-07-12T14:00:00.000Z',
      },
      {
        position: '',
        progress: 90,
        fraction: 0.9,
        fb2Href: '10#1',
        updatedAt: '2026-07-12T16:00:00.000Z',
      },
    );
    assert.equal(shouldUseServerPosition(input), true);
  });

  it('does not prompt for dismissed snapshot', () => {
    const input = buildMergeInputFromLocalCtx(
      {
        position: '',
        progress: 20,
        fraction: 0.2,
        updatedAt: '2026-07-11T10:00:00.000Z',
        serverUpdatedAt: '2026-07-11T08:00:00.000Z',
        serverProgress: 20,
        dismissedUpdatedAt: '2026-07-12T14:00:00.000Z',
      },
      {
        position: '',
        progress: 85,
        fraction: 0.85,
        updatedAt: '2026-07-12T14:00:00.000Z',
      },
    );
    assert.equal(shouldShowCrossDevicePositionPrompt(input), false);
  });

  it('does not prompt when this browser already saw the same server snapshot', () => {
    const input = buildMergeInputFromLocalCtx(
      {
        position: '',
        progress: 45,
        fraction: 0.45,
        updatedAt: '2026-07-12T12:00:00.000Z',
        serverUpdatedAt: '2026-07-12T12:00:00.000Z',
        serverProgress: 45,
        dismissedUpdatedAt: null,
      },
      {
        position: '',
        progress: 45,
        fraction: 0.45,
        updatedAt: '2026-07-12T12:00:00.000Z',
      },
    );
    assert.equal(serverEditUnseenOnThisClient(input), false);
    assert.equal(shouldShowCrossDevicePositionPrompt(input), false);
  });

  it('prompts on first web open when phone advanced server position', () => {
    const input = buildMergeInputFromLocalCtx(
      {
        position: '',
        progress: 0,
        fraction: 0,
        updatedAt: null,
        serverUpdatedAt: null,
        serverProgress: -1,
        dismissedUpdatedAt: null,
      },
      {
        position: '',
        progress: 72,
        fraction: 0.72,
        fb2Href: '12#3',
        updatedAt: '2026-07-12T15:00:00.000Z',
      },
    );
    assert.equal(serverEditUnseenOnThisClient(input), true);
    assert.equal(shouldShowCrossDevicePositionPrompt(input), true);
  });

  it('compareFb2Hrefs orders section#block and fraction follows', () => {
    assert.equal(compareFb2Hrefs('9#1', '9#2'), -1);
    assert.equal(compareFb2Hrefs('9#2', '9#1'), 1);
    const toc = ['8#1', '9#1', '9#2', '10'];
    const f1 = fractionFromFb2HrefWithToc('9#1', toc);
    const f2 = fractionFromFb2HrefWithToc('9#2', toc);
    assert.ok(f2 > f1);
  });

  it('same coarse fb2Href still differs when precise fractions differ', () => {
    assert.equal(
      positionsMeaningfullyDiffer(0.94, '', '9#2', 0.84, '', '9#2'),
      true,
    );
    const input = buildMergeInputFromLocalCtx(
      {
        position: '',
        progress: 94,
        fraction: 0.94,
        fb2Href: '9#2',
        updatedAt: '2026-07-11T10:00:00.000Z',
        serverUpdatedAt: '2026-07-11T08:00:00.000Z',
        serverProgress: 94,
        dismissedUpdatedAt: null,
      },
      {
        position: '',
        progress: 84,
        fraction: 0.84,
        fb2Href: '9#2',
        updatedAt: '2026-07-12T14:00:00.000Z',
      },
    );
    assert.equal(shouldShowCrossDevicePositionPrompt(input), true);
    assert.equal(shouldUseServerPosition(input), true);
  });

  it('uses exact text anchor before display fraction', () => {
    assert.equal(
      positionsMeaningfullyDiffer(0.94, '', '9#2', 0.84, '', '9#8', 80489, 80489, 9, 9),
      false,
    );
    assert.equal(
      positionsMeaningfullyDiffer(0.94, '', '9#2', 0.94, '', '9#2', 80489, 80520, 9, 9),
      true,
    );
  });

  it('parseSyncTs accepts SQLite datetime from readerActivitySync', () => {
    const iso = '2026-07-12T14:00:00.000Z';
    const sqlite = '2026-07-12 14:00:00';
    assert.equal(parseSyncTs(sqlite), parseSyncTs(iso));
  });

  it('buildMergeInputFromOfflineStore maps bootstrap store fields', () => {
    const input = buildMergeInputFromOfflineStore({
      position: '',
      progress: 20,
      fraction: 0.2,
      fb2Href: '3#1',
      positionChangedAt: '2026-07-11T10:00:00.000Z',
      serverPositionProgress: 85,
      serverFb2Href: '8#2',
      serverPositionUpdatedAt: '2026-07-12T14:00:00.000Z',
      dismissedServerPositionUpdatedAt: null,
    });
    assert.equal(input.localFraction, 0.2);
    assert.equal(input.serverFraction, 0.85);
    assert.equal(input.serverFb2Href, '8#2');
    assert.equal(shouldUseServerPosition(input), true);
  });

  it('effectiveSavedFraction ignores TOC when stored fraction exists', () => {
    const toc = ['8#1', '9#1', '9#2', '10'];
    const saved = { fraction: 0.84, progress: 94, fb2Href: '9#2' };
    assert.equal(effectiveSavedFraction(saved, toc), 0.84);
    assert.equal(formatPositionProgressLabel(0.84, 94), '84%');
  });

  it('savedFraction falls back to progress for null and empty fractions', () => {
    assert.equal(savedFraction({ progress: 42, fraction: null }), 0.42);
    assert.equal(savedFraction({ progress: 37, fraction: '' }), 0.37);
    assert.equal(savedFraction({ progress: 25, fraction: '  ' }), 0.25);
    assert.equal(savedFraction({ progress: 90, fraction: 0 }), 0);
  });

  it('cross-device lines derive percent from fraction not stale progress', () => {
    const lines = buildCrossDevicePromptLines(
      { progress: 94, fraction: 0.84, fb2Href: '9#2' },
      { progress: 94, fraction: 0.84, fb2Href: '9#2' },
    );
    assert.equal(lines.localLine, '84% · глава 9#2');
    assert.equal(lines.serverLine, '84% · глава 9#2');
  });

  it('cross-device server line estimates chapter from TOC when fb2Href missing', () => {
    const toc = ['1', '5', '8#1', '9#1', '9#2', '9#3', '10'];
    const lines = buildCrossDevicePromptLines(
      { fraction: 0.851351, fb2Href: '9#3' },
      { fraction: 0.945521, progress: 95 },
      toc,
    );
    assert.equal(lines.localLine, '85% · глава 9#3');
    assert.match(lines.serverLine, /^95% · глава /);
  });

  it('estimates chapter by text-volume (startFraction), consistent with percent', () => {
    // 10 Foliate-секций как в реальной книге: 95% текста = Часть VI, а не Приложение.
    const toc = [
      { href: '1', label: 'Пролог', startFraction: 0.0 },
      { href: '2', label: 'Часть I', startFraction: 0.016 },
      { href: '3', label: 'Часть II', startFraction: 0.178 },
      { href: '4', label: 'Часть III', startFraction: 0.335 },
      { href: '5', label: 'Часть IV', startFraction: 0.494 },
      { href: '6', label: 'Часть V', startFraction: 0.649 },
      { href: '7', label: 'Часть VI. Недолго музыка играла', startFraction: 0.809 },
      { href: '8', label: 'Эпилог', startFraction: 0.971 },
      { href: '9', label: 'Приложение', startFraction: 1.0 },
    ];
    // Обе стороны на 94.55% → одинаковый процент И одинаковая глава (Часть VI), не Приложение.
    const lines = buildCrossDevicePromptLines(
      { fraction: 0.945521, position: 'epubcfi(/6/20!/4/2)' },
      { fraction: 0.945521, fb2Href: null },
      toc,
    );
    assert.equal(lines.localLine, '95% · Часть VI. Недолго музыка играла');
    assert.equal(lines.serverLine, '95% · Часть VI. Недолго музыка играла');
  });

  it('uses the exact text anchor for the dialog chapter, not fraction estimation', () => {
    const toc = [
      { href: '9', label: 'Часть II', startFraction: 0.8, sectionIndex: 9, textOffset: 0 },
      { href: '9#4', label: 'Глава 5', startFraction: 0.86, sectionIndex: 9, textOffset: 4000 },
      { href: '9#8', label: 'Глава 9', startFraction: 0.93, sectionIndex: 9, textOffset: 8000 },
    ];
    const lines = buildCrossDevicePromptLines(
      { fraction: 0.94, sectionIndex: 9, textOffset: 4500 },
      { fraction: 0.94, sectionIndex: 9, textOffset: 4500 },
      toc,
    );
    assert.equal(lines.localLine, '94% · Глава 5');
    assert.equal(lines.serverLine, '94% · Глава 5');
  });

  it('recomputes whole-book dialog percent from exact anchors instead of stale fraction', () => {
    const toc = [{
      href: '9#4',
      label: 'Глава 5',
      sectionIndex: 9,
      textOffset: 4000,
      sectionStartFraction: 0.8,
      sectionFraction: 0.2,
      sectionTextLength: 10000,
    }];
    const anchor = {
      fraction: 0.87,
      fb2Href: '9#4',
      sectionIndex: 9,
      textOffset: 7500,
      textSectionLength: 10000,
    };
    const lines = buildCrossDevicePromptLines(anchor, anchor, toc);
    assert.equal(lines.localLine, '95% · Глава 5');
    assert.equal(lines.serverLine, '95% · Глава 5');
  });

  it('shows real chapter titles from labeled TOC (fb2Href → chapter, not section index)', () => {
    const toc = [
      { href: '2', label: 'Часть I' },
      { href: '9', label: 'Глава 10. Место под солнцем' },
      { href: '13', label: 'Часть II' },
      { href: '17', label: 'Глава 4. И даже не Фили' },
    ];
    const lines = buildCrossDevicePromptLines(
      { fraction: 0.9508, fb2Href: '9#9' },
      { fraction: 0.9455, fb2Href: '17#2' },
      toc,
    );
    assert.equal(lines.localLine, '95% · Глава 10. Место под солнцем');
    assert.equal(lines.serverLine, '95% · Глава 4. И даже не Фили');
  });
});
