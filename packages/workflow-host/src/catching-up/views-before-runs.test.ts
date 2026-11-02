import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { counting, isLive, liveWith } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { answeredOnceFolded } from './answered-runs.ts';

describe('a run that waits for the views the projector folds', () => {
  it('waits until its view has folded every run that ended before it started', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    const projector = views.start();
    await views.until('runs', liveWith(1));
    await projector.stop();
    await views.ran('reasoning/runs', 2);

    const counted = answeredOnceFolded({
      answer: async () => (await views.until('runs', isLive)).view,
      folders: views.settingsOf({}).folders,
      database: views.store.database,
    });
    await Effect.runPromise(Effect.sleep(100));
    views.start();

    expect(await counted).toBe(2);
  });
});
