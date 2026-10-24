import { handedWorkersWithChecks, checkShippedRoots } from '@on.auto/definitions/check';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { programPool, type FoldRequest, type Json, type JsonObject } from '@on.auto/workflow-engine/dsl';
import { Effect, Result } from 'effect';

import { documentCheck } from '../src/document/document-check.ts';
import { parseRecallDocument } from '../src/document/document-parsing.ts';
import { recallBounds, recallFolding } from '../src/run/recall-bounds.ts';
import { campaignReviews } from '../src/testing/campaign-reviews.ts';

const checkFiles = shippedFilesOnDisk(checkShippedRoots());

const handed = await handedWorkersWithChecks(checkFiles);

export interface Folded {
  readonly events: number;
  readonly pages: number;
  readonly milliseconds: number;
  readonly checkpoints: number;
  readonly viewBytes: number;
  readonly sameAtEveryPageSize: boolean;
}

const document = Result.getOrThrow(parseRecallDocument(campaignReviews));

const { details } = document;

async function strippedFold(): Promise<string> {
  const pool = programPool({ handed, instances: 'fresh', workers: 1, heapMegabytes: recallBounds.heapMegabytes });
  const { module = details.fold } = await Effect.runPromise(documentCheck(pool)(document));
  await pool.close();
  return module;
}

function reviewed(index: number): JsonObject {
  return {
    specversion: '1.0',
    id: `review-${index}`,
    source: `/runs/0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}`,
    type: 'run_succeeded',
    subject: 'reasoning/review-brief',
    time: new Date(Date.UTC(2026, 9, 6) + index * 1000).toISOString(),
    data: {
      type: 'reasoning',
      name: 'review-brief',
      version: 1,
      output: { campaign: `campaign-${index % 100}`, verdict: index % 3 === 0 ? 'reject' : 'approve' },
    },
  };
}

function pageOf(fold: string, view: Json, first: number, size: number): FoldRequest {
  const events = Array.from({ length: size }, (_, index) => reviewed(first + index));
  return {
    ...recallFolding,
    pageBudgetMs: 60_000,
    events,
    views: [
      {
        fold,
        filters: details.filters,
        view,
        ...(details.schema === undefined ? {} : { schema: details.schema }),
        events: events.map((_, index) => index),
      },
    ],
    waitMs: 10_000,
    deadlineMs: 120_000,
  };
}

interface Progress {
  readonly view: Json;
  readonly checkpoints: number;
}

async function foldedInPages(
  fold: string,
  events: number,
  size: number,
): Promise<Progress & { readonly pages: number }> {
  const pool = programPool({ handed, instances: 'fresh', workers: 1, heapMegabytes: recallBounds.heapMegabytes });
  const starts = Array.from({ length: Math.ceil(events / size) }, (_, index) => index * size);
  const done = await starts.reduce<Promise<Progress>>(
    async (before, start) => {
      const { view, checkpoints } = await before;
      const page = await pool.fold(pageOf(fold, view, start, Math.min(size, events - start)));
      if (page.ran !== 'folded') {
        throw new Error(`A page of folds ended ${page.ran}`);
      }
      const [folded] = page.views;
      return { view: folded?.view ?? null, checkpoints: checkpoints + (folded?.work ?? 0) };
    },
    Promise.resolve({ view: details.initial, checkpoints: 0 }),
  );
  await pool.close();
  return { ...done, pages: starts.length };
}

export async function foldsMeasured(events: number): Promise<Folded> {
  const fold = await strippedFold();
  const started = performance.now();
  const whole = await foldedInPages(fold, events, 1000);
  const milliseconds = performance.now() - started;
  const smaller = await foldedInPages(fold, Math.min(events, 3000), 7);
  const larger = await foldedInPages(fold, Math.min(events, 3000), 1000);
  return {
    events,
    pages: whole.pages,
    milliseconds,
    checkpoints: whole.checkpoints,
    viewBytes: JSON.stringify(whole.view).length,
    sameAtEveryPageSize:
      JSON.stringify(smaller.view) === JSON.stringify(larger.view) && smaller.checkpoints === larger.checkpoints,
  };
}
