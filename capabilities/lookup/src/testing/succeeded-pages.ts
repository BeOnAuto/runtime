import type { SucceededRunsReader } from '@on.auto/definitions';
import { keptArmOf } from '@on.auto/definitions/testing';
import type { ContentKeeper, RecordedEvent, RecordedPageRequest } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Array, Effect, Option, type Schema } from 'effect';

import { runsRead, type RunsAsked } from '../runs/runs-read.ts';

const definition = { type: 'computation', name: 'campaign-pace' };

export const theStart = 'the-start-of-the-run-that-reads';

const asked: RunsAsked = {
  place: { org: 'acme', playbook: 'alpha' },
  definition,
  start: theStart,
  since: undefined,
  words: [],
};

export function runOf(
  day: number,
  output: Schema.Json,
  startedAt = `2026-10-${String(day).padStart(2, '0')}T09:00:00.000Z`,
) {
  return {
    run_id: `0199a3c4-0000-7000-8000-${String(day).padStart(12, '0')}`,
    definition_version: 1,
    started_at: startedAt,
    finished_at: startedAt,
    output,
  };
}

export interface RunShown {
  readonly run_id: string;
  readonly definition_version: number;
  readonly started_at: string;
  readonly finished_at: string;
  readonly output: Schema.Json;
  readonly kept?: true;
}

function outputMembersOf({ output, kept }: RunShown) {
  if (kept === undefined) {
    return { output };
  }
  const { sha256, bytes } = keptArmOf(output);
  return { output_sha256: sha256, output_bytes: bytes };
}

function headsOf(run: RunShown) {
  const { run_id: runId, definition_version: version, started_at, finished_at } = run;
  const context = {
    by: 'acme-admin',
    runId,
    definitionType: definition.type,
    definitionName: definition.name,
    definitionVersion: version,
  };
  const head = {
    causationId: null,
    correlationId: runId,
    stream: `runs/${runId}`,
    cursor: runId,
    recordedAt: started_at,
  };
  const heads: readonly RecordedEvent[] = [
    {
      ...head,
      id: `${runId}/1`,
      version: 1,
      globalPosition: 1,
      type: 'run_started',
      data: undefined,
      context: { ...context, at: started_at },
    },
    {
      ...head,
      id: `${runId}/2`,
      version: 2,
      globalPosition: 2,
      type: 'run_succeeded',
      data: { ...outputMembersOf(run), record: {} },
      context: { ...context, at: finished_at },
    },
  ];
  return heads;
}

export interface Page {
  readonly runs: readonly RunShown[];
  readonly reached?: string;
}

export interface PagedReader {
  readonly reader: SucceededRunsReader;
  readonly asked: () => readonly RecordedPageRequest[];
}

export function pagedReader(
  pages: readonly Page[],
  content: ContentKeeper['content'] = memoryLedger().service.content,
): PagedReader {
  const requests: RecordedPageRequest[] = [];
  return {
    reader: {
      content,
      readRecorded: (_, __, page) =>
        Effect.sync(() => {
          requests.push(page);
          const index = page.cursor === theStart ? 0 : Number(page.cursor);
          const { runs, reached } = Option.getOrThrow(Array.get(pages, index));
          const later = index + 1 < pages.length;
          return {
            records: runs.flatMap((run) => headsOf(run)),
            hasMore: later,
            nextCursor: later ? String(index + 1) : null,
            lastExamined: reached === undefined ? null : { cursor: 'the-place-it-reached', recordedAt: reached },
          };
        }),
    },
    asked: () => requests,
  };
}

export function failedRead(reader: SucceededRunsReader, mostMs?: number) {
  return Effect.runPromise(Effect.flip(runsRead(reader, asked, 10, mostMs)));
}

export function read(
  reader: SucceededRunsReader,
  mostPages: number,
  changed: Partial<RunsAsked> = {},
  mostMs?: number,
) {
  return Effect.runPromise(runsRead(reader, { ...asked, ...changed }, mostPages, mostMs));
}

export function readingEachPageFor(reader: SucceededRunsReader, ms: number): SucceededRunsReader {
  return {
    ...reader,
    readRecorded: (playbook, selection, page) =>
      Effect.andThen(Effect.sleep(ms), reader.readRecorded(playbook, selection, page)),
  };
}
