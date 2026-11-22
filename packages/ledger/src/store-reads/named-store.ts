import { projectedTableOf } from '@on.auto/operations';

import { definitionNamesTableName } from '../definition-names/definition-names-table.ts';
import type { LedgerStore, LedgerStreams, RecordedStream, StreamPage } from '../event-store.ts';
import type { OpenedLedger } from '../ledger-layer.ts';
import { runOutcomesVersioned } from '../outcomes/run-outcome-projection.ts';
import { runIdsTableName } from '../run-ids/run-ids-table.ts';
import { readNamed, readNameOfStream } from './store-reads.ts';

type Read<Args extends readonly unknown[], A> = (...args: Args) => Promise<A>;

function namedBy<Args extends readonly unknown[], A>(
  nameOf: (args: Args) => string,
  read: Read<Args, A>,
  eventsOf?: (answer: A) => number,
): Read<Args, A> {
  return (...args) => readNamed(nameOf(args), () => read(...args), eventsOf);
}

function named<Args extends readonly unknown[], A>(name: string, read: Read<Args, A>): Read<Args, A> {
  return namedBy(() => name, read);
}

const ofTheStream =
  (prefix: string) =>
  ([stream]: readonly [string, ...unknown[]]): string =>
    readNameOfStream(prefix, stream);

const eventsFolded = ({ messages }: RecordedStream | StreamPage): number => messages.length;

export function namedStreamsOf<Streams extends LedgerStreams>(streams: Streams): Streams {
  const names = definitionNamesTableName;
  const { lastPositionOf } = streams;
  return {
    ...streams,
    read: namedBy(ofTheStream('fold'), streams.read, eventsFolded),
    readPage: namedBy(ofTheStream('fold'), streams.readPage, eventsFolded),
    append: namedBy(ofTheStream('append'), streams.append),
    messageAt: namedBy(ofTheStream('fact'), streams.messageAt),
    lastMessageOf: namedBy(ofTheStream('fact'), streams.lastMessageOf),
    readRecorded: named('recorded', streams.readRecorded),
    readRecordedOfKeys: named('recorded', streams.readRecordedOfKeys),
    readRecordedOfOrg: named('recorded', streams.readRecordedOfOrg),
    readRecordedEvent: named('recorded', streams.readRecordedEvent),
    readRecordedEventOfKeys: named('recorded', streams.readRecordedEventOfKeys),
    readAppended: named('appended', streams.readAppended),
    readAppendedFacts: named('appended', streams.readAppendedFacts),
    definitionStreams: named('definition_streams', streams.definitionStreams),
    orgStreams: named('org_streams', streams.orgStreams),
    holderOfName: named(names, streams.holderOfName),
    nameHeldBy: named(names, streams.nameHeldBy),
    namesHeldIn: named(names, streams.namesHeldIn),
    holdersOfName: named(names, streams.holdersOfName),
    definitionsIn: named(names, streams.definitionsIn),
    holderOfStream: named(names, streams.holderOfStream),
    holderOfRunId: named(runIdsTableName, streams.holderOfRunId),
    ageOfLastAppend: named('stream_ages', streams.ageOfLastAppend),
    ...(lastPositionOf === undefined ? {} : { lastPositionOf: named('stream_ages', lastPositionOf) }),
    versionOf: named('stream_versions', streams.versionOf),
  };
}

function namedReadsOf(store: LedgerStore): LedgerStore {
  return {
    ...namedStreamsOf(store),
    multiStreamAppend: named('append:multi', store.multiStreamAppend),
    readRunOutcomes: named(projectedTableOf(runOutcomesVersioned), store.readRunOutcomes),
    lastPositionOf: named('stream_ages', store.lastPositionOf),
  };
}

export function namedLedgerOf({ store, connection }: OpenedLedger): OpenedLedger {
  return { store: namedReadsOf(store), connection: { ...connection, streams: namedStreamsOf(connection.streams) } };
}
