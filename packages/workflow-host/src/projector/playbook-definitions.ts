import {
  DefinitionEventSchema,
  definitionTypeStreamOf,
  type RecordedDefinitionEvent,
  type StrippedForms,
} from '@on.auto/definitions';
import type { PagesSavedAsDefinitions } from '@on.auto/definitions/page';
import { recordedDecoder } from '@on.auto/operations';
import { Option } from 'effect';

export interface KeptFunction {
  readonly version: number;
  readonly saved: number;
  readonly details: unknown;
  readonly formerly?: string;
}

export interface PlaybookDefinitions {
  readonly version: number;
  readonly functions: ReadonlyMap<string, KeptFunction>;
  readonly savedAsDefinitions?: PagesSavedAsDefinitions;
}

export type KeptOf = (details: unknown, stripped?: StrippedForms) => unknown;

export type KeptAfter = (
  previous: PlaybookDefinitions,
  type: string,
  messages: readonly unknown[],
) => PlaybookDefinitions;

export type KeptTogether = (playbook: string, byType: ReadonlyMap<string, PlaybookDefinitions>) => PlaybookDefinitions;

export interface DefinitionsKeeping {
  readonly definitionTypes: readonly string[];
  readonly keptAfter: KeptAfter;
  readonly together: KeptTogether;
}

export const noDefinitions: PlaybookDefinitions = { version: 0, functions: new Map() };

const decodeDefinitionEvent = recordedDecoder(DefinitionEventSchema);

export function definitionStreamOf(playbookKey: string, definitionType: string): string {
  return `${playbookKey}${definitionTypeStreamOf(definitionType)}`;
}

export function keptKeyOf(folder: { readonly name: string }, definitionType: string): string {
  return JSON.stringify([folder.name, definitionType]);
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

export function keptDefinitionsOf(definitionType: string, keptOf: KeptOf): DefinitionsKeeping {
  return {
    definitionTypes: [definitionType],
    keptAfter: (previous, _, messages) => definitionsAfter(previous, messages, keptOf),
    together: (_, byType) => byType.get(definitionType) ?? noDefinitions,
  };
}
