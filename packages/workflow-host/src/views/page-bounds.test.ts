import { readFileSync } from 'node:fs';

import { pollsPerCheckpoint } from '@on.auto/workflow-engine/dsl';
import { describe, expect, it } from 'vitest';

import { recordsInAPage } from '../pages/page-events.ts';
import { replayBounds } from '../pages/view-replay.ts';
import { projectorBounds } from '../projector/projector-settings.ts';
import { pageFolding } from './page-views.ts';

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
