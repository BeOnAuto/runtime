import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Function } from 'effect';

import type { Json, JsonObject } from '../dsl/json.ts';
import {
  foldPage,
  type FoldHost,
  type FoldPage,
  type FoldedPage,
  type FoldingView,
  type ViewCheck,
} from '../folds/fold-page.ts';
import { freshInstance } from '../instances/fresh-instances.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';

export type Timing = Pick<FoldHost, 'now' | 'folding'>;

const reviewed = { type: 'run_succeeded', subject: 'reasoning/review-brief' };

export function succeeded(campaign: Json, verdict: Json, time: string): JsonObject {
  return { ...reviewed, source: '/runs/run', time, data: { output: { campaign, verdict } } };
}

export const springApproved = succeeded('spring', 'approve', '2026-10-01T09:00:00Z');

const reviewEvents: readonly JsonObject[] = [
  springApproved,
  { type: 'run_started', subject: 'reasoning/review-brief', time: '2026-10-01T09:00:01Z', data: {} },
  succeeded('summer', 'reject', '2026-10-01T09:00:02Z'),
  succeeded('spring', 'reject', '2026-10-01T09:00:03Z'),
];

export const byCampaign = [
  'export function fold(view, event) {',
  '  const { campaign, verdict } = event.data.output;',
  '  return { ...view, [campaign]: [...(view[campaign] ?? []), { at: event.time, verdict }] };',
  '}',
].join('\n');

export const adding = 'export function fold(view) {\n  return view + 1;\n}';

export function viewOf(fold: string, more: Partial<FoldingView> = {}): FoldingView {
  return { fold, filters: [reviewed], view: {}, events: [0, 1, 2, 3], ...more };
}

export function pageOf(views: readonly FoldingView[], more: Partial<FoldPage> = {}): FoldPage {
  return {
    events: reviewEvents,
    views,
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: threadStackBytes,
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    ...more,
  };
}

function entriesAtMost(schema: JsonObject): ViewCheck {
  const most = Number(schema['maxProperties']);
  return (view) =>
    typeof view === 'object' && view !== null && Object.keys(view).length > most
      ? `the view: Expected a value with at most ${most} entry`
      : undefined;
}

export function stillTiming(mark: (text: string) => void = Function.constVoid): Timing {
  return {
    now: () => 0,
    folding: (event, view) => {
      mark(`${event}:${view}`);
    },
  };
}

export function runningClock(stepMs: number): Timing {
  const time = { now: 0 };
  return {
    now: () => {
      time.now += stepMs;
      return time.now;
    },
    folding: Function.constVoid,
  };
}

export function slowFirstFold(stepMs: number): Timing {
  const time = { now: 0, slow: false };
  return {
    now: () => {
      time.now += time.slow ? stepMs : 0;
      return time.now;
    },
    folding: (event, view) => {
      time.slow = event === 0 && view === 0;
    },
  };
}

export async function folded(page: FoldPage, timing: Timing = stillTiming()): Promise<FoldedPage> {
  const instances = await Promise.all(page.views.map(() => freshInstance(shippedFilesOnDisk, page.memoryBytes)));
  return foldPage(page, { ...timing, checkOf: entriesAtMost, instances });
}
