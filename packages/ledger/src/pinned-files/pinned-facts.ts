import { labelFacts, runFacts, topicFacts, type RunFact } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { happenings, noted } from '../testing/happenings.ts';
import { journal } from '../testing/journal.ts';
import { tally } from '../testing/tally.ts';
import type { OpenedLedgerFile } from './opened-ledger-file.ts';
import { pinnedLineage, pinnedMoment, pinnedStreams, scrubbedContext } from './pinned-scenario.ts';

interface Refused {
  readonly _tag: string;
  readonly detail: string;
}

function refusedAs({ _tag, detail }: Refused): Refused {
  return { _tag, detail };
}

function done<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

function began(startedAt: string): RunFact {
  return { type: 'run_began', data: { at: startedAt, fn: 'tally' } };
}

async function runsRecorded({ ledger }: OpenedLedgerFile): Promise<void> {
  await done(
    ledger.execute(
      pinnedStreams.endedRun,
      runFacts,
      [
        began('2026-11-16T09:00:00.000Z'),
        { type: 'run_noted', data: {} },
        {
          type: 'run_ended',
          data: { status: 'succeeded', ms: 1234, tokens: 2_147_483_648, cost: Number.MAX_SAFE_INTEGER },
        },
      ],
      pinnedLineage,
    ),
  );
  await done(ledger.execute(pinnedStreams.openRun, runFacts, [began('2026-11-16T09:30:00.000Z')]));
}

async function notesRecorded({ ledger }: OpenedLedgerFile): Promise<void> {
  await done(
    ledger.execute(pinnedStreams.topics, topicFacts, [
      { type: 'topic_opened', data: { topic: 'shared', at: pinnedMoment } },
      { type: 'topic_noted', data: { topic: 'shared', note: 'first' } },
    ]),
  );
  await done(
    ledger.execute(pinnedStreams.labels, labelFacts, [
      { type: 'labels_set', data: { note: 'n1', labels: ['billing', 'urgent'] } },
      { type: 'label_added', data: { note: 'n1', label: 'later' } },
    ]),
  );
}

async function orgAndDefinitionRecorded({ ledger }: OpenedLedgerFile): Promise<void> {
  await done(
    ledger.execute(pinnedStreams.journal, journal, [
      {
        type: 'entry_written',
        data: {
          at: new Date('2026-11-16T09:15:00.000Z'),
          amount: 9_007_199_254_740_993n,
          ratio: 0.1,
          tags: ['first', 'second'],
          memo: 'kept',
          source: null,
        },
      },
      { type: 'entry_struck', data: { reason: 'written twice' } },
    ]),
  );
  await done(ledger.execute(pinnedStreams.tallies, tally, [3, -1]));
  await done(ledger.execute(pinnedStreams.named, happenings, [noted('named', { name: 'triage' })]));
}

export async function factsAppended(open: OpenedLedgerFile): Promise<void> {
  await runsRecorded(open);
  await notesRecorded(open);
  await orgAndDefinitionRecorded(open);
}

export async function factScrubbed({ ledger }: OpenedLedgerFile): Promise<void> {
  await done(
    ledger.scrubFact(pinnedStreams.topics, 2, {
      eventSchema: topicFacts.eventSchema,
      data: { topic: 'shared', note: 'scrubbed' },
      erasure: { type: 'topic_noted', data: { topic: 'erased', note: '' } },
      context: scrubbedContext,
    }),
  );
}

export function factReads({ ledger }: OpenedLedgerFile) {
  return done(
    Effect.all({
      journal: ledger.load(pinnedStreams.journal, journal),
      tallies: ledger.load(pinnedStreams.tallies, tally),
      endedRun: ledger.load(pinnedStreams.endedRun, runFacts),
      lastOfTheEndedRun: ledger.factAt(pinnedStreams.endedRun, 3, runFacts.eventSchema),
      nameClaimedAgain: Effect.map(
        Effect.flip(ledger.execute(pinnedStreams.namedAgain, happenings, [noted('named', { name: 'triage' })])),
        refusedAs,
      ),
    }),
  );
}
