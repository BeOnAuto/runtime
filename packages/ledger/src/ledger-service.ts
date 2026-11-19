import { Ledger, keptContentGraceMs, type StreamReader, type StreamWriter } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { appendedFactsReaderOf } from './appended/appended-reader.ts';
import { decisionLoop } from './decision-loop.ts';
import { refusableAppenderOf } from './event-appender.ts';
import type { DefinitionNamesStore, LedgerContent, LedgerStore, StreamMessagesStore, Streams } from './event-store.ts';
import { multiStreamExecutorOf } from './multi-stream/multi-stream-decisions.ts';
import { runOutcomesReaderOf } from './outcomes/run-outcomes-reader.ts';
import { recordedEventReaderOf, recordedReaderOf } from './recorded/recorded-reader.ts';
import { factReaderOf, streamReaderOf, type LastPositionOf } from './stream-reader.ts';

export function streamPortsOf(
  streams: Streams & StreamMessagesStore,
  lastPositionOf?: LastPositionOf,
): StreamReader & StreamWriter {
  const load = streamReaderOf(streams, lastPositionOf);
  return {
    load,
    factAt: factReaderOf(streams),
    execute: (stream, decider, command, lineage) =>
      decisionLoop(
        (named: string) => load(named, decider),
        (named, events, place) =>
          refusableAppenderOf(streams, decider.eventSchema)(named, events, {
            ...place,
            ...(lineage === undefined ? {} : { lineage }),
          }),
        decider,
      )(stream, command).pipe(
        Effect.map(({ state, version, loaded }) => ({ state, version, decidedOn: loaded.state })),
      ),
  };
}

function definitionNamesReaderOf(
  store: DefinitionNamesStore,
): Pick<Ledger['Service'], 'holderOfName' | 'nameHeldBy' | 'namesHeldIn' | 'holderOfStream'> {
  return {
    holderOfName: (named) => Effect.promise(() => store.holderOfName(named)),
    nameHeldBy: (definitionKey) => Effect.promise(() => store.nameHeldBy(definitionKey)),
    namesHeldIn: (kind) => Effect.promise(() => store.namesHeldIn(kind)),
    holderOfStream: (named) => Effect.promise(() => store.holderOfStream(named)),
  };
}

function runIdsReaderOf(store: Pick<LedgerStore, 'holderOfRunId'>): Pick<Ledger['Service'], 'holderOfRunId'> {
  return { holderOfRunId: (claimed) => Effect.promise(() => store.holderOfRunId(claimed)) };
}

export function ownContentOf(store: LedgerStore): LedgerContent {
  return {
    content: store.content,
    found: store.contentFound,
    removedKeptBefore: (owner, sha256, before) =>
      Effect.promise(() => store.unlessHeld(owner, sha256, store.removalWithin(owner, sha256, before))),
    eraseExpired: (most) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.promise(() => store.eraseExpired(now, most))),
  };
}

export function makeLedger(store: LedgerStore, kept: LedgerContent = ownContentOf(store)): Ledger['Service'] {
  const ports = streamPortsOf(store, store.lastPositionOf);
  return Ledger.of({
    ...ports,
    executeMultiStream: multiStreamExecutorOf(store, ports.load),
    scrubFact: store.scrubFact,
    ageOfLastAppend: (stream) => Effect.promise(() => store.ageOfLastAppend(stream)),
    ...definitionNamesReaderOf(store),
    ...runIdsReaderOf(store),
    readRecorded: recordedReaderOf(store),
    readRecordedEvent: recordedEventReaderOf(store),
    ...appendedFactsReaderOf(store),
    readRunOutcomes: runOutcomesReaderOf(store),
    readProjectedRows: store.readProjectedRows,
    countProjectedRows: store.countProjectedRows,
    readDueRows: store.readDueRows,
    nextDueOf: store.nextDueOf,
    advanceRow: store.advanceRow,
    content: kept.content,
    removeUnheld: (playbook, sha256) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        kept.removedKeptBefore(playbook, sha256, now - keptContentGraceMs),
      ),
  });
}
