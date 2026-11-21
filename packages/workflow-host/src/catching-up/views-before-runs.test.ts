import { describe, expect, it } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { steppedClock } from '../testing/stepped-clock.ts';
import { counting, isLive, liveWith } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { answeredOnceFolded } from './answered-runs.ts';

describe('a run that waits for the views the projector folds', () => {
  it('waits until its view has folded every run that ended before it started', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    const projector = views.start();
    await views.folded('runs', liveWith(1));
    await projector.stop();
    await views.ran('reasoning/runs', 2);

    const clock = steppedClock(Date.now());
    const counted = answeredOnceFolded({
      answer: async () => (await views.folded('runs', isLive)).view,
      folders: views.settingsOf({}).folders,
      database: views.store.database,
      clock,
    });
    await clock.asleepAtLeast(1);
    views.start();
    await views.folded('runs', liveWith(2));
    clock.step(60_000);

    expect(await counted).toBe(2);
  });
});
