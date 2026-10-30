import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { alpha, counting, detailsOf, foldOf, foldedAll, isStalled, liveAt, succeeded } from './view-documents.ts';
import { viewHarness } from './view-harness.ts';

function rebuildTests(settingsOf: SettingsOf): void {
  it('rebuild the view from the start of the history when a new version is saved, and drop it when it is retired', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('runs', counting);
    await views.ranEach('reasoning/runs', [1, 2]);
    views.start();
    const first = await views.until('runs', foldedAll(2));

    await views.saved('runs', detailsOf(foldOf('return view + 10;'), succeeded, { initial: 0 }));
    const second = await views.until('runs', liveAt(2));
    await views.retired('runs');
    const retired = await views.gone('runs');

    expect([first.view, second.view, second.folded, retired]).toEqual([2, 20, 2, true]);
  });

  it('replace an older version that waits, rebuilds or stalled with the newer one', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('runs', detailsOf(foldOf('throw new Error("version one");'), succeeded, { initial: 0 }));
    await views.ran('reasoning/runs', 1);
    views.start();
    await views.until('runs', isStalled);

    await views.saved('runs', counting);
    const repaired = await views.until('runs', liveAt(2));

    expect(repaired).toMatchObject({ view: 1, folded: 1 });
    expect(repaired).not.toHaveProperty('stall');
  });
}

function discoveryTests(settingsOf: SettingsOf): void {
  it('find the first recall function of a playbook and a playbook created after the projector started, woken by the append, without a restart', async () => {
    const views = await viewHarness(await settingsOf());
    views.start({ sweepEveryMs: 60_000 });
    const beta = { org: 'acme', playbook: 'beta' };

    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    await views.saved('runs', counting, beta);
    await views.ran('reasoning/runs', 1, { playbook: beta });
    const [inAlpha, inBeta] = await Promise.all([
      views.until('runs', foldedAll(1), alpha),
      views.until('runs', foldedAll(1), beta),
    ]);

    expect([inAlpha.view, inBeta.view]).toEqual([1, 1]);
  });
}

export function versionsSuite(settingsOf: SettingsOf): void {
  describe('the versions of a recall function', () => {
    rebuildTests(settingsOf);
    discoveryTests(settingsOf);
  });
}
