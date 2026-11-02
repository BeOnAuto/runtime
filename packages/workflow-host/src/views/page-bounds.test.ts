import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { projectorBounds } from '../projector/projector-settings.ts';
import { pageFolding, pageViewsBounds } from './page-views.ts';

const page = readFileSync(new URL('../../../../docs/reference/page-format.md', import.meta.url), 'utf8');

const counted = new Intl.NumberFormat('en');

const mebibytes = 1_048_576;

function valueOf(bound: string): string {
  return String(
    page
      .split('\n')
      .find((line) => line.startsWith(`| ${bound} `))
      ?.split('|')[2],
  );
}

describe('the bounds on the public reference page of pages', () => {
  it('are the bounds the code holds the views and a fold to', () => {
    expect([
      valueOf('The views together'),
      valueOf('Work, memory and duration of one fold'),
      valueOf('Views built at once'),
    ]).toEqual([
      expect.stringContaining(`${pageFolding.mostViewBytes / 1024} KiB`),
      expect.stringContaining(
        `${counted.format(pageFolding.budget)} checkpoints, ${pageFolding.memoryBytes / mebibytes} MiB and ${pageFolding.foldDeadlineMs / 1000} seconds`,
      ),
      expect.stringContaining(`${pageViewsBounds.rebuildsAtOnce} pages a playbook`),
    ]);
  });

  it('say a fold that runs out of time or crashes stalls the views after as many tries as the code allows', () => {
    expect([valueOf('`time`'), valueOf('`crash`')]).toEqual([
      expect.stringContaining(`its ${pageFolding.foldDeadlineMs / 1000} seconds twenty times`),
      expect.stringContaining('twenty times'),
    ]);
    expect(projectorBounds.triesBeforeStall).toBe(20);
  });
});
