import type { NamedMessage } from '../definition-names/name-judgement.ts';
import { messageIdOf, type Conflict, type Lineage, type ProjectedMessage } from '../index.ts';
import type { AppendedFact } from '../projections/memory-projections.ts';
import { memoryAppendedReader, type MemoryAppends } from './memory-appended.ts';
import { memoryRecordedReader, type MemoryRecord } from './memory-recorded.ts';
import { keptTablesOf, type KeptTables, type MemoryTables } from './memory-tables.ts';

export interface Appended {
  readonly stream: string;
  readonly stored: readonly AppendedFact[];
  readonly lineage: Lineage;
}

export interface Kept extends KeptTables {
  readonly streams: Map<string, readonly AppendedFact[]>;
  readonly appendedAt: Map<string, number>;
  readonly log: readonly MemoryRecord[];
  readonly logged: (records: readonly MemoryRecord[]) => void;
  readonly rewritten: (stream: string, position: number, fact: AppendedFact) => void;
}

export function storedIn({ streams }: Pick<Kept, 'streams'>, stream: string): readonly AppendedFact[] {
  return streams.get(stream) ?? [];
}

export function messageOf(stream: string, position: number, { type, data, context }: AppendedFact): ProjectedMessage {
  return { id: messageIdOf(stream, position), position, type, data, context };
}

function namedMessageOf(stream: string, position: number, { type, data, context }: AppendedFact): NamedMessage {
  return { stream, id: messageIdOf(stream, position), position, type, data, context };
}

interface Staged {
  readonly appended: Appended;
  readonly version: number;
  readonly commits: readonly (() => void)[];
  readonly messages: readonly NamedMessage[];
}

function stagedIn(kept: Kept, appended: Appended): Staged {
  const { stream, stored } = appended;
  const version = storedIn(kept, stream).length;
  return {
    appended,
    version,
    commits: [
      kept.references.staged(stream, stored),
      kept.outcomes.staged(stream, stored, version + 1),
      kept.projected.staged(stream, stored, version + 1),
    ],
    messages: stored.map((fact, index) => namedMessageOf(stream, version + index + 1, fact)),
  };
}

function keptOne(kept: Kept, { appended: { stream, stored, lineage }, version }: Staged, at: number): void {
  kept.logged(
    stored.map(({ type, data, context, payloadBytes }, index) => ({
      position: kept.log.length + index + 1,
      id: messageIdOf(stream, version + index + 1),
      ...lineage,
      stream,
      streamPosition: version + index + 1,
      type,
      data,
      context,
      payloadBytes,
      recordedAt: new Date(at).toISOString(),
    })),
  );
  kept.streams.set(stream, [...storedIn(kept, stream), ...stored]);
  kept.appendedAt.set(stream, at);
}

export function appendedTo(kept: Kept, appends: readonly Appended[], at: number): Conflict | undefined {
  const staged = appends.map((appended) => stagedIn(kept, appended));
  const messages = staged.flatMap((each) => each.messages);
  const names = kept.names.staged(messages);
  if ('refused' in names) {
    return names.refused;
  }
  const runIds = kept.runIds.staged(messages);
  if ('refused' in runIds) {
    return runIds.refused;
  }
  for (const commit of [...staged.flatMap((each) => each.commits), names.commit, runIds.commit]) {
    commit();
  }
  for (const each of staged) {
    keptOne(kept, each, at);
  }
  return undefined;
}

interface KeptLedger {
  readonly kept: Kept;
  readonly appends: MemoryAppends;
  readonly recordedReader: ReturnType<typeof memoryRecordedReader>;
}

export function keptLedgerOf(tables: MemoryTables): KeptLedger {
  const log: MemoryRecord[] = [];
  const streams = new Map<string, readonly AppendedFact[]>();
  const appends = memoryAppendedReader(log, {
    definitionsIn: (playbookKey) => kept.names.definitionsIn(playbookKey),
    heldBy: (definitionKey) => kept.names.heldBy(definitionKey),
  });
  const kept: Kept = {
    streams,
    appendedAt: new Map(),
    log,
    logged: (records) => {
      log.push(...records);
      appends.appended();
    },
    rewritten: (stream, position, fact) => {
      streams.set(stream, storedIn({ streams }, stream).with(position - 1, fact));
      for (const [index, record] of log.entries()) {
        if (record.stream === stream && record.streamPosition === position) {
          log[index] = { ...record, data: fact.data, payloadBytes: fact.payloadBytes };
        }
      }
    },
    ...keptTablesOf(tables),
  };
  const names = {
    definitionsIn: (playbookKey: string) => kept.names.definitionsIn(playbookKey),
    held: () => kept.names.held(),
  };
  return { kept, appends, recordedReader: memoryRecordedReader(log, names) };
}
