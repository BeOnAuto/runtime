import { sha256Of, textOfContent, type KeptContentHead } from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import type { ProjectedRowsQuery, RecordedPageRequest } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { plainJsonOf } from './canonical-json.ts';
import { onTheLedgerOf, type OpenedLedgerFile } from './opened-ledger-file.ts';
import { factReads } from './pinned-facts.ts';
import {
  alpha,
  keptBy,
  longAfter,
  pinnedContents,
  pinnedCorrelation,
  pinnedMoment,
  pinnedSecrets,
} from './pinned-scenario.ts';

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

const everyRecord: RecordedPageRequest = { order: 'asc', limit: 100 };

const projected: readonly string[] = ['run_tallies', 'topics', 'label_sets', 'label_notes', 'labelled_rows'];

function done<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

async function recordedReads({ ledger }: OpenedLedgerFile) {
  const everything = await done(ledger.readRecorded(alpha, { kind: 'everything' }, everyRecord));
  return {
    everything,
    correlated: await done(
      ledger.readRecorded(alpha, { kind: 'correlated', correlation: pinnedCorrelation }, everyRecord),
    ),
    byId: await Promise.all(everything.records.map(({ id }) => done(ledger.readRecordedEvent(alpha, id)))),
    head: await done(ledger.readAppendedFacts({ kind: 'playbook', playbook: alpha }, { most: 100, dataOf: [] })),
  };
}

function projectedReads({ ledger }: OpenedLedgerFile) {
  return done(
    Effect.all({
      rows: Effect.all(projected.map((name) => ledger.readProjectedRows(name, alpha, everyRow))),
      openRuns: ledger.countProjectedRows('run_tallies', alpha, [{ column: 'open', equals: true }]),
      dueRuns: ledger.readDueRows('run_tallies', { column: 'due_at', through: longAfter, limit: 10 }),
      nextTopicDue: ledger.nextDueOf('topics', 'due_at', 0),
      outcomes: ledger.readRunOutcomes(alpha, { from: '2026-11-16', to: '2026-11-16' }, {}),
    }),
  );
}

interface ContentRead {
  readonly head: KeptContentHead | undefined;
  readonly text: string | undefined;
}

async function contentRead({ ledger }: OpenedLedgerFile, text: string): Promise<ContentRead> {
  const sha256 = sha256Of(text);
  const content = await done(ledger.content.get(alpha, sha256));
  return {
    head: await done(ledger.content.getHead(alpha, sha256)),
    text: content === undefined ? undefined : await done(textOfContent(content)),
  };
}

function contentReads(open: OpenedLedgerFile): Promise<readonly ContentRead[]> {
  return Promise.all(Object.values(pinnedContents).map((text) => contentRead(open, text)));
}

function secretReads({ secretRows }: OpenedLedgerFile) {
  return at(
    pinnedMoment,
    Effect.all({
      sealed: secretRows.read(pinnedSecrets.sealed),
      plain: secretRows.read(pinnedSecrets.plain),
      endings: Effect.map(secretRows.endingsOf(Object.values(pinnedSecrets)), (endings) => [...endings]),
      held: secretRows.heldBy({ keptBy }, 10),
    }),
  );
}

async function ledgerReadsOf(open: OpenedLedgerFile): Promise<Schema.Json> {
  return plainJsonOf({
    streams: await factReads(open),
    recorded: await recordedReads(open),
    projected: await projectedReads(open),
    content: await contentReads(open),
    secrets: await secretReads(open),
  });
}

export function readAsALedger(fileName: string): Promise<Schema.Json> {
  return onTheLedgerOf(fileName, ledgerReadsOf);
}
