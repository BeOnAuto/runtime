import { Conflict, playbookOfStreamPrefix, streamPrefixOfPlaybook, type PlaybookAddress } from '@on.auto/operations';
import type {
  DefinitionName,
  DefinitionNames,
  NameAfter,
  NameBound,
  NamedMessage,
} from '@on.auto/operations/definition-names';
import { plainNumber } from '@on.auto/phrasing';
import { Option } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { takenWords } from '../moving/move-words.ts';
import { definitionFactOf } from '../read-model/definition-rows.ts';
import { definitionFactTypes, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { hasTriggers } from '../registry/definition-triggers.ts';
import { takenByARetiredOne } from '../renaming/rename-words.ts';

export const mostReactingDefinitions = 1024;

export function unbounded(): number {
  return Number.POSITIVE_INFINITY;
}

const aDefinitionStream = /^(definition\/([^/]+)\/[^/]+\/)definitions\/([^/]+)$/u;

interface DefinitionPlace {
  readonly definitionKey: string;
  readonly org: string;
  readonly type: string;
}

function definitionStreamOf(types: readonly string[], stream: string): DefinitionPlace | undefined {
  const [, definitionKey = '', org = '', type = ''] = aDefinitionStream.exec(stream) ?? [];
  return types.includes(type) ? { definitionKey, org, type } : undefined;
}

function definitionKeyOf(types: readonly string[], { stream }: NamedMessage): string | undefined {
  return definitionStreamOf(types, stream)?.definitionKey;
}

function createdName(
  types: readonly string[],
  stream: string,
  fact: Extract<RecordedDefinitionEvent, { type: 'definition_created' }>,
): NameAfter {
  const addressed = definitionStreamOf(types, stream);
  const { playbook } = fact.data;
  return addressed === undefined || playbook === undefined
    ? undefined
    : {
        playbookKey: streamPrefixOfPlaybook({ org: addressed.org, playbook }),
        definitionType: addressed.type,
        name: fact.context.definitionName,
        status: 'active',
        hasTriggers: hasTriggers(fact.data.content),
      };
}

const statusAfter = { definition_paused: 'paused', definition_resumed: 'active', definition_retired: 'retired' };

function changedName(
  held: DefinitionName,
  fact: Exclude<RecordedDefinitionEvent, { type: 'definition_created' | 'definition_moved' }>,
) {
  if (fact.type === 'definition_renamed') {
    return { ...held, name: fact.data.to };
  }
  if (fact.type === 'definition_updated') {
    return { ...held, hasTriggers: hasTriggers(fact.data.content) };
  }
  if (fact.type === 'definition_restored') {
    return { ...held, status: 'paused', hasTriggers: hasTriggers(fact.data.content) };
  }
  return { ...held, status: statusAfter[fact.type] };
}

function movedName(
  types: readonly string[],
  stream: string,
  held: DefinitionName,
  { data }: Extract<RecordedDefinitionEvent, { type: 'definition_moved' }>,
): NameAfter {
  const addressed = definitionStreamOf(types, stream);
  return addressed === undefined
    ? undefined
    : { ...held, playbookKey: streamPrefixOfPlaybook({ org: addressed.org, playbook: data.to }) };
}

function nameChangedBy(
  types: readonly string[],
  stream: string,
  held: DefinitionName,
  fact: Exclude<RecordedDefinitionEvent, { type: 'definition_created' }>,
): NameAfter {
  return fact.type === 'definition_moved' ? movedName(types, stream, held, fact) : changedName(held, fact);
}

function nameAfterIn(types: readonly string[]): DefinitionNames['nameAfter'] {
  return (held, message) => {
    const fact = definitionFactOf(message);
    if (fact?.type === 'definition_created') {
      return createdName(types, message.stream, fact);
    }
    return held === undefined || fact === undefined ? undefined : nameChangedBy(types, message.stream, held, fact);
  };
}

const moved = 'definition_moved';

function playbookMovedInto(
  { playbookKey }: DefinitionName,
  factTypes: readonly string[],
): Option.Option<PlaybookAddress> {
  return factTypes.includes(moved) ? playbookOfStreamPrefix(playbookKey) : Option.none();
}

function renamedFrom(changedBy: readonly NamedMessage[]): string | undefined {
  const facts = changedBy.map((message) => definitionFactOf(message));
  return facts.find((fact) => fact?.type === 'definition_renamed')?.data.from;
}

function takenByTheRetired(held: { readonly type: string; readonly name: string }, changedBy: readonly NamedMessage[]) {
  const from = renamedFrom(changedBy);
  return from === undefined
    ? `The ${definitionResourceLabel(held.type)} ${held.name} was retired and keeps its name; restore_definition brings it back`
    : takenByARetiredOne(held, from);
}

function takenWhere(claimed: DefinitionName, holder: DefinitionName, changedBy: readonly NamedMessage[]): string {
  const held = { type: claimed.definitionType, name: holder.name };
  const retired = holder.status === 'retired';
  return Option.match(
    playbookMovedInto(
      claimed,
      changedBy.map(({ type }) => type),
    ),
    {
      onNone: () =>
        retired
          ? takenByTheRetired(held, changedBy)
          : `The playbook already has the ${definitionResourceLabel(held.type)} ${held.name}`,
      onSome: ({ playbook }) => takenWords(playbook, held, retired),
    },
  );
}

function takenBy(claimed: DefinitionName, holder: DefinitionName, changedBy: readonly NamedMessage[]): Conflict {
  return new Conflict({ detail: takenWhere(claimed, holder, changedBy), kind: 'taken' });
}

const checkedBy = ['definition_created', 'definition_updated', 'definition_restored', moved];

const savings: Readonly<Record<string, string>> = {
  definition_created: 'creating another',
  definition_updated: 'saving another version',
  [moved]: 'moving another into it',
};

function savingOf(factType: string): string {
  return savings[factType] ?? 'restoring one';
}

function startingOnTheirOwn(claimed: DefinitionName, factType: string): string {
  const starting = `${mostReactingDefinitions} ${definitionResourceLabel(claimed.definitionType)}s that start on their own, the most a playbook holds`;
  return Option.match(playbookMovedInto(claimed, [factType]), {
    onNone: () => `The playbook already has ${starting}; retire one, or save this one without its schedule`,
    onSome: ({ playbook }) =>
      `The playbook ${playbook} already has ${starting}; retire one there before moving another into it, or save this one without its schedule and then move it`,
  });
}

function keptBeyond(claimed: DefinitionName, factType: string, before: number, most: number): string {
  const kept = `keeps ${plainNumber(before)} ${definitionResourceLabel(claimed.definitionType)}s, and a playbook may keep at most ${plainNumber(most)}`;
  return Option.match(playbookMovedInto(claimed, [factType]), {
    onNone: () => `The playbook ${kept}; retire one before ${savingOf(factType)}`,
    onSome: ({ playbook }) => `The playbook ${playbook} ${kept}; retire one there before ${savingOf(factType)}`,
  });
}

function boundsOf(mostActiveOf: (type: string) => number): readonly NameBound[] {
  return [
    {
      checkedBy,
      counts: ({ status }) => status !== 'retired',
      most: mostActiveOf,
      beyond: (claimed, factType, before, most) =>
        new Conflict({ detail: keptBeyond(claimed, factType, before, most) }),
    },
    {
      checkedBy,
      counts: (name) => name.status !== 'retired' && name.hasTriggers,
      most: () => mostReactingDefinitions,
      beyond: (claimed, factType) => new Conflict({ detail: startingOnTheirOwn(claimed, factType) }),
    },
  ];
}

export function definitionNamesOf(types: readonly string[], mostActiveOf?: (type: string) => number): DefinitionNames {
  return {
    types: definitionFactTypes,
    holdsNames: (stream) => definitionStreamOf(types, stream) !== undefined,
    definitionKeyOf: (message) => definitionKeyOf(types, message),
    nameAfter: nameAfterIn(types),
    takenBy,
    ...(mostActiveOf === undefined ? {} : { bounds: boundsOf(mostActiveOf) }),
  };
}

export interface DefinitionBounds {
  readonly mostActiveOf: (type: string) => number;
  readonly keptFrom: (capabilities: readonly { readonly type: string; readonly mostActive: number }[]) => void;
}

export function definitionBoundsHeld(): DefinitionBounds {
  const kept = new Map<string, number>();
  return {
    mostActiveOf: (type) => kept.get(type) ?? unbounded(),
    keptFrom: (capabilities) => {
      for (const { type, mostActive } of capabilities) {
        kept.set(type, mostActive);
      }
    },
  };
}
