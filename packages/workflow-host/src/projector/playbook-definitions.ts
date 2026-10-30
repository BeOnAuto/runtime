import {
  DefinitionEventSchema,
  definitionTypeStreamOf,
  type RecordedDefinitionEvent,
  type StrippedForms,
} from '@on.auto/definitions';
import { recordedDecoder } from '@on.auto/operations';
import { Option } from 'effect';

export interface KeptFunction {
  readonly version: number;
  readonly saved: number;
  readonly details: unknown;
}

export interface PlaybookDefinitions {
  readonly version: number;
  readonly functions: ReadonlyMap<string, KeptFunction>;
}

export type KeptOf = (details: unknown, stripped?: StrippedForms) => unknown;

export const noDefinitions: PlaybookDefinitions = { version: 0, functions: new Map() };

const decodeDefinitionEvent = recordedDecoder(DefinitionEventSchema);

export function definitionStreamOf(playbookKey: string, definitionType: string): string {
  return `${playbookKey}${definitionTypeStreamOf(definitionType)}`;
}

export function playbookKeyOfDefinitions(stream: string, definitionType: string): string {
  return stream.slice(0, stream.length - definitionTypeStreamOf(definitionType).length);
}

function evolved(
  functions: ReadonlyMap<string, KeptFunction>,
  event: RecordedDefinitionEvent,
  saved: number,
  keptOf: KeptOf,
) {
  const kept = new Map(functions);
  const { definitionName: name, definitionVersion: version } = event.context;
  if (event.type === 'definition_retired') {
    kept.delete(name);
  } else {
    const { content } = event.data;
    kept.set(name, { version, saved, details: keptOf(content.details, content.stripped) });
  }
  return kept;
}

export function definitionsAfter(
  previous: PlaybookDefinitions,
  events: readonly unknown[],
  keptOf: KeptOf,
): PlaybookDefinitions {
  const functions = events.reduce<ReadonlyMap<string, KeptFunction>>(
    (kept, stored, index) =>
      Option.match(decodeDefinitionEvent(stored), {
        onNone: () => kept,
        onSome: (event) => evolved(kept, event, previous.version + index + 1, keptOf),
      }),
    previous.functions,
  );
  return { version: previous.version + events.length, functions };
}
