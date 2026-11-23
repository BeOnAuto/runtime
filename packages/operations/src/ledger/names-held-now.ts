import { Effect } from 'effect';

import type { HeldName } from '../definition-names/name-judgement.ts';
import type { AppendedFact, RecordedFact } from '../reading/recorded-read.ts';

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

const thePlaybookOfAKey = /^playbook\/[^/]+\/([^/]+)\/$/u;

const aPlaybookKey = /^playbook\/[^/]+\/[^/]+\//u;

export function definitionKeyOfStream(stream: string): string | undefined {
  return definitionKeyOf({ stream });
}

function playbookOfKey(playbookKey: string | undefined): string | undefined {
  return playbookKey === undefined ? undefined : thePlaybookOfAKey.exec(playbookKey)?.[1];
}

export function playbookNamedAsHeld(fact: AppendedFact, held: HeldName | undefined): AppendedFact {
  const playbook = playbookOfKey(aPlaybookKey.exec(fact.stream)?.[0] ?? held?.playbookKey);
  const named = namedAsHeld(fact, held);
  return playbook === undefined ? named : { ...named, playbook };
}

export function playbookNamedFor(
  fact: AppendedFact,
  heldBy: (definitionKey: string) => HeldName | undefined,
): AppendedFact {
  const definitionKey = definitionKeyOfStream(fact.stream);
  return playbookNamedAsHeld(fact, definitionKey === undefined ? undefined : heldBy(definitionKey));
}
