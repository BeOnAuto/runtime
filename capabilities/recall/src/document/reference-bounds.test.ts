import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { mebibytes, recallBounds } from '../run/recall-bounds.ts';

const page = readFileSync(new URL('../../../../docs/reference/recall-format.md', import.meta.url), 'utf8');

const counted = new Intl.NumberFormat('en');

function valueOf(bound: string): string {
  return String(
    page
      .split('\n')
      .find((line) => line.startsWith(`| ${bound} `))
      ?.split('|')[2],
  );
}

describe('the bounds on the public reference page of recall functions', () => {
  it('are the bounds the code holds a view, a fold and a run to', () => {
    expect([
      valueOf('Filters'),
      valueOf('Work of one fold'),
      valueOf('Memory of one fold'),
      valueOf('Duration of one fold'),
      valueOf('View'),
      valueOf('Depth of a value'),
      valueOf('Work of one answer'),
      valueOf('Duration and memory of a run'),
      valueOf('Recall functions a playbook keeps'),
      valueOf('Views built at once'),
      valueOf('Folding time of a page'),
      valueOf('Pages a pass'),
      valueOf('Playbooks followed at once'),
    ]).toEqual([
      expect.stringContaining(String(recallBounds.mostFilters)),
      expect.stringContaining(`${counted.format(recallBounds.budget)} checkpoints`),
      expect.stringContaining(`${recallBounds.foldMemoryBytes / mebibytes} MiB`),
      expect.stringContaining(`${recallBounds.foldDeadlineMs / 1000} seconds`),
      expect.stringContaining(`${recallBounds.mostViewBytes / 1024} KiB`),
      expect.stringContaining(`${recallBounds.mostValueDepth} levels`),
      expect.stringContaining(`${counted.format(recallBounds.budget)} checkpoints`),
      expect.stringContaining(
        `${recallBounds.deadlineMs / 1000} seconds and ${recallBounds.answerMemoryBytes / mebibytes} MiB`,
      ),
      expect.stringContaining(String(recallBounds.mostFunctions)),
      expect.stringContaining(`${recallBounds.rebuildsAtOnce} a playbook`),
      expect.stringContaining(`${recallBounds.pageBudgetMs / 1000} seconds`),
      expect.stringContaining(`${recallBounds.pagesPerWake} a playbook`),
      expect.stringContaining(String(recallBounds.playbooksAtOnce)),
    ]);
  });

  it('say a slow fold stalls its view after as many tries as the code allows', () => {
    expect(page).toContain(`stalls once it has run out of time twenty times`);
    expect(recallBounds.overtimesBeforeStall).toBe(20);
  });
});
