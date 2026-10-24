import { describe, expect, it } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import { watchedClock } from '../testing/watched-clock.ts';
import { failingOnce } from '../views-testing/pool-faults.ts';
import { steppedClock } from '../views-testing/stepped-sweeps.ts';
import { counting, foldedAll, liveWith } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { firstSeenOf } from './projector.ts';

const anyText: unknown = expect.any(String);

describe('the records a projector reports', () => {
  it('are told once each, remembering only the newest as many as it may', () => {
    const firstSeen = firstSeenOf(2);

    expect(['a', 'a', 'b', 'c', 'a', 'c'].map((record) => firstSeen(record))).toEqual([
      true,
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('include a record passed over once, though a view rebuilt later reads it again', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('first', counting);
    await views.ran('reasoning/runs', 1);
    await views.append('playbook/acme/alpha/runs/broken', [{ type: 'run_succeeded', data: { type: 'run_succeeded' } }]);
    views.start();
    await views.until('first', liveWith(1));

    await views.saved('second', counting);
    await views.until('second', liveWith(1));

    expect(views.reports.notes()).toEqual([
      { kind: 'record_passed_over', playbook: 'playbook/acme/alpha/', record: anyText, reason: 'unreadable' },
    ]);
  });
});

describe('a projector that fails', () => {
  it('reports a sweep that failed, and sweeps again', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    views.failingDiscovery(true);
    views.start({ sweepEveryMs: 20 });

    const troubles = await until(views.reports.troubles, (reported) => reported.length > 0);
    views.failingDiscovery(false);
    const kept = await views.until('runs', foldedAll(1));

    expect(troubles[0]).toBe('A sweep of the views failed; the next sweep tries again');
    expect(kept).toMatchObject({ phase: 'live', view: 1 });
  });

  it('tries a sweep that failed again at the next sweep, a whole interval later, not at once', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    views.failingDiscovery(true);
    const clock = watchedClock(steppedClock(Date.now()));
    views.start({ sweepEveryMs: 1000, clock });

    const asked = await until(clock.asked, (sleeps) => sleeps.length > 0);

    expect([asked, views.reports.troubles()]).toEqual([
      [1000],
      ['A sweep of the views failed; the next sweep tries again'],
    ]);
  });

  it('reports a pass of a playbook that failed, and passes again', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    views.start({ sweepEveryMs: 20, pool: failingOnce(views.pool).pool });

    const kept = await views.until('runs', foldedAll(1));

    expect(views.reports.troubles()).toEqual(['A pass of the views of a playbook failed; the next sweep tries again']);
    expect(kept).toMatchObject({ phase: 'live', view: 1 });
  });
});
