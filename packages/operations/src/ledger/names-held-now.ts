import { Effect } from 'effect';

import type { HeldName } from '../definition-names/name-judgement.ts';
import type { RecordedFact } from '../reading/recorded-read.ts';

export interface NamesHeldNow {
  readonly nameHeldBy: (definitionKey: string) => Effect.Effect<HeldName | undefined>;
}

const aDefinitionKey = /^definition\/[^/]+\/[^/]+\//u;

type Named = Pick<RecordedFact, 'stream' | 'context'>;

function definitionKeyOf({ stream }: Pick<RecordedFact, 'stream'>): string | undefined {
  return aDefinitionKey.exec(stream)?.[0];
}

export function namedAsHeld<Record extends Pick<RecordedFact, 'context'>>(
  record: Record,
  held: HeldName | undefined,
): Record {
  return held === undefined || record.context.definitionName === undefined
    ? record
    : { ...record, context: { ...record.context, definitionName: held.name } };
}

export function namedAsHeldNow({
  nameHeldBy,
}: NamesHeldNow): <Record extends Named>(records: readonly Record[]) => Effect.Effect<readonly Record[]> {
  return (records) => {
    const keys = [...new Set(records.flatMap((record) => definitionKeyOf(record) ?? []))];
    return Effect.map(
      Effect.forEach(keys, (key) => Effect.map(nameHeldBy(key), (held) => [key, held] as const)),
      (held: readonly (readonly [string, HeldName | undefined])[]) => {
        const names = new Map(held);
        return records.map((record) => namedAsHeld(record, names.get(definitionKeyOf(record) ?? '')));
      },
    );
  };
}
