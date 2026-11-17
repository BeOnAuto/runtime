import { readFileSync } from 'node:fs';

import { pollsPerCheckpoint } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordsInAPage } from '../pages/page-events.ts';
import { replayBounds } from '../pages/view-replay.ts';
import { noDefinitions } from '../projector/playbook-definitions.ts';
import { projectorBounds } from '../projector/projector-settings.ts';
import { onSQLite } from '../testing/host-files.ts';
import { alpha } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { pageKeeping } from './page-keeping.ts';
import { pageFolding } from './page-views.ts';
import { viewsPortOn } from './views-port.ts';

const page = readFileSync(new URL('../../../../docs/reference/page-format.md', import.meta.url), 'utf8');

const counted = new Intl.NumberFormat('en');

const aMillion = 1_000_000;

function valueOf(bound: string): string | undefined {
  return page
    .split('\n')
    .find((line) => line.startsWith(`| ${bound} `))
    ?.split('|')[2];
}

describe('the bounds on the public reference page of pages', () => {
  it('are the bounds the code holds the views and a fold to', () => {
    expect([valueOf('The views together'), valueOf('Work and duration of one fold')]).toEqual([
      expect.stringContaining(`${pageFolding.mostViewBytes / 1024} KiB`),
      expect.stringContaining(
        `About ${(pageFolding.budget * pollsPerCheckpoint) / aMillion} million steps and ${pageFolding.foldDeadlineMs / 1000} seconds`,
      ),
    ]);
  });

  it('name no count of the views a playbook builds at once, which a server’s settings choose', () => {
    expect(valueOf('Views built at once')).toMatch(/^\D+$/u);
  });

  it('say how far a replay as of a run reads', () => {
    expect(valueOf('A replay [as of a run](#as-of-a-run)')).toContain(
      `${counted.format(replayBounds.pages * recordsInAPage)} records`,
    );
  });

  it('say a fold that runs out of time or crashes stalls the views after as many tries as the code allows', () => {
    expect([valueOf('`time`'), valueOf('`crash`')]).toEqual([
      expect.stringContaining(`its ${pageFolding.foldDeadlineMs / 1000} seconds twenty times`),
      expect.stringContaining('twenty times'),
    ]);
    expect(projectorBounds.triesBeforeStall).toBe(20);
  });
});

describe('the pages saved as definitions of their own that the views keep', () => {
  it('pass over a record of their stream that is no definition’s, counting it as a version of the stream', () => {
    const kept = pageKeeping.keptAfter(noDefinitions, 'page', [
      { type: 'definition_renamed', data: {}, context: { by: 'acme-admin', at: '2026-10-06T09:00:00.000Z' } },
    ]);

    expect([kept.version, kept.savedAsDefinitions?.size]).toEqual([1, 0]);
  });
});

describe('the pages the views keep', () => {
  it('pass over a record of a subject’s stream they cannot read, counting it as a version of the stream', () => {
    const kept = pageKeeping.keptAfter(noDefinitions, 'workflow', [{ type: 'page_saved', data: {}, context: {} }]);
    const ofThePlaybook = pageKeeping.keptAfter(noDefinitions, 'playbook', [{ type: 'page_removed', data: {} }]);

    expect([kept.version, kept.functions.size, ofThePlaybook.functions.size]).toEqual([1, 0, 0]);
  });

  it('are none before any stream is read', () => {
    expect(pageKeeping.together('playbook/acme/alpha/', new Map()).functions.size).toBe(0);
  });
});

describe('the port to the views a host keeps', () => {
  it('tells, on the database of the store, when the playbook last recorded anything, and of no view a playbook does not keep', async () => {
    const views = await viewHarness(await onSQLite());
    const port = viewsPortOn(views.store.database);
    const newestAt = () => Effect.runPromise(port.newestRecordAt(alpha));

    const before = await newestAt();
    await views.ran('reasoning/runs', 1);
    const after = await newestAt();

    expect(before).toBeUndefined();
    expect(after).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(await views.viewOf('missing')).toBeUndefined();
  });
});
