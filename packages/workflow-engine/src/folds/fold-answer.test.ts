import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { freshInstance } from '../instances/fresh-instances.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { foldAnswerOf, foldPageData } from './fold-answer.ts';
import type { FoldHost } from './fold-page.ts';
import { foldProgress, progressOf } from './fold-progress.ts';

async function hostOf(views: number, more: Partial<FoldHost> = {}): Promise<FoldHost> {
  const instances = await Promise.all(
    Array.from({ length: views }, () => freshInstance(shippedFilesOnDisk, unitMemoryBytes)),
  );
  return {
    now: () => 0,
    folding: Function.constVoid,
    checkOf: () => passing,
    instances,
    ...more,
  };
}

const someWork: unknown = expect.any(Number);

function passing(): undefined {
  return undefined;
}

const adding = {
  fold: 'export function fold(view, event) {\n  return view + event.data;\n}',
  filters: [{ type: 'noted' }],
  view: 1,
  events: [0],
};

const page = {
  events: [{ type: 'noted', data: 2 }],
  views: [adding],
  budget: 500,
  memoryBytes: unitMemoryBytes,
  stackBytes: threadStackBytes,
  foldDeadlineMs: 10_000,
  pageBudgetMs: 2000,
  mostViewBytes: 1000,
};

describe('the answer of a worker that folds a page', () => {
  it('folds the page it is given, as the page crosses to it, and answers each view as JSON text', async () => {
    expect(foldAnswerOf(foldPageData(page), await hostOf(1))).toEqual({
      ran: 'folded',
      early: false,
      views: [{ view: '3', folded: 1, lastFolded: 0, through: 0, work: someWork }],
    });
  });

  it('answers that it could not read a page whose events or views are not the JSON a page crosses as', async () => {
    const data = foldPageData(page);
    const host = await hostOf(1);
    const tooDeep = `[{"data":${'['.repeat(600)}${']'.repeat(600)}}]`;

    expect([
      foldAnswerOf({ ...data, events: 'not JSON' }, host),
      foldAnswerOf({ ...data, events: '[1]' }, host),
      foldAnswerOf({ ...data, events: tooDeep }, host),
      foldAnswerOf({ ...data, views: [{ ...adding, view: 'not JSON' }] }, host),
    ]).toEqual([{ ran: 'unreadable' }, { ran: 'unreadable' }, { ran: 'unreadable' }, { ran: 'unreadable' }]);
  });
});

describe('the budget of a page a worker folds', () => {
  it('counts from its first fold, so what the worker does before it folds never spends it', async () => {
    const time = { now: 0 };
    const slowToPrepare = await hostOf(1, {
      now: () => time.now,
      checkOf: () => {
        time.now += 5000;
        return passing;
      },
    });
    const view = { ...adding, schema: {}, events: [0, 1] };
    const twice = { ...page, events: [...page.events, ...page.events], views: [view] };

    expect(foldAnswerOf(foldPageData(twice), slowToPrepare)).toMatchObject({
      early: false,
      views: [{ view: '5', folded: 2, through: 1 }],
    });
  });
});

describe('the progress of a page of folds', () => {
  it('names the last fold marked, through memory shared with the worker, and nothing before one was', () => {
    const progress = foldProgress();
    const seen = progressOf(progress.shared);

    const before = progress.last();
    seen.mark(4, 2);

    expect([before, progress.last()]).toEqual([undefined, { event: 4, view: 2 }]);
  });
});
