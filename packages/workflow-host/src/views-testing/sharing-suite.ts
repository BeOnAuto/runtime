import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { readsWhile, watchedSystemClock } from '../testing/watched-clock.ts';
import { counting, detailsOf, foldOf, foldedAll, isLive, liveWith } from './view-documents.ts';
import { viewHarness } from './view-harness.ts';

function countingRunsOf(subject: string) {
  return detailsOf(foldOf('return view + 1;'), [{ type: 'run_succeeded', subject }], { initial: 0 });
}

function joiningTests(settingsOf: SettingsOf): void {
  it('share one read a wake once caught up, and a rebuilding view joins them without folding an event twice', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('a', countingRunsOf('reasoning/a'));
    await views.saved('b', countingRunsOf('reasoning/b'));
    await views.ran('reasoning/a', 1);
    await views.ran('reasoning/b', 1);
    const clock = watchedSystemClock();
    views.start({ sweepEveryMs: 60_000, clock });
    await views.until('a', liveWith(1));
    await views.until('b', liveWith(1));

    const sharedRead = await readsWhile(views, clock, async () => {
      await views.ran('reasoning/a', 2);
      await views.until('a', foldedAll(2));
    });
    await views.saved('c', countingRunsOf('reasoning/a'));
    await views.until('c', isLive);
    const afterJoining = await readsWhile(views, clock, async () => {
      await views.ran('reasoning/b', 2);
      await views.until('b', foldedAll(2));
    });
    const folded = await Promise.all(['a', 'b', 'c'].map(async (name) => (await views.viewOf(name))?.view));

    expect([sharedRead, afterJoining]).toEqual([1, 1]);
    expect(folded).toEqual([2, 2, 2]);
  });
}

function slotTests(settingsOf: SettingsOf): void {
  it('rebuild beside a live one a page a wake, each in its slot, every event folded once', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('live', counting);
    await views.ranInOneStream(
      'reasoning/runs',
      Array.from({ length: 1500 }, (_, run) => run),
    );
    views.start({ pagesPerWake: 2, rebuildsAtOnce: 2 });
    await views.until('live', isLive);

    await views.saved('second', counting);
    await views.saved('third', counting);
    const kept = await Promise.all(['live', 'second', 'third'].map((name) => views.until(name, liveWith(1500))));

    expect(kept.map(({ view }) => view)).toEqual([1500, 1500, 1500]);
  });
}

export function sharingSuite(settingsOf: SettingsOf): void {
  describe('the views of one playbook', () => {
    joiningTests(settingsOf);
    slotTests(settingsOf);
  });
}
