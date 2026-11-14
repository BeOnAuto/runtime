import { Conflict } from '@on.auto/operations';
import type {
  DefinitionName,
  DefinitionNames,
  NameAfter,
  NameBound,
  NamedMessage,
} from '@on.auto/operations/definition-names';
import { plainNumber } from '@on.auto/phrasing';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { definitionFactOf } from '../read-model/definition-rows.ts';
import { definitionFactTypes, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { hasTriggers } from '../registry/definition-triggers.ts';
import { definitionKeyOfId, earlierDefinitionIdOf } from './definition-ids.ts';

export const mostReactingDefinitions = 1024;

export function unbounded(): number {
  return Number.POSITIVE_INFINITY;
}

const aDefinitionStream = /^(playbook\/([^/]+)\/([^/]+)\/)definitions\/([^/]+)$/u;

interface DefinitionPlace {
  readonly prefix: string;
  readonly org: string;
  readonly playbook: string;
  readonly type: string;
}

function definitionStreamOf(types: readonly string[], stream: string): DefinitionPlace | undefined {
  const [, prefix = '', org = '', playbook = '', type = ''] = aDefinitionStream.exec(stream) ?? [];
  return types.includes(type) ? { prefix, org, playbook, type } : undefined;
}

function definitionKeyOf(types: readonly string[], { stream, context }: NamedMessage): string | undefined {
  const place = definitionStreamOf(types, stream);
  if (place === undefined || context.definitionName === undefined) {
    return undefined;
  }
  const { org, playbook, type } = place;
  return definitionKeyOfId(
    org,
    context.definitionId ?? earlierDefinitionIdOf({ org, playbook, type, name: context.definitionName }),
  );
}

function createdName(
  types: readonly string[],
  stream: string,
  fact: Extract<RecordedDefinitionEvent, { type: 'definition_created' }>,
): NameAfter {
  const addressed = definitionStreamOf(types, stream);
  return addressed === undefined
    ? undefined
    : {
        playbookKey: addressed.prefix,
        definitionType: addressed.type,
        name: fact.context.definitionName,
        status: 'active',
        hasTriggers: hasTriggers(fact.data.content),
      };
}

const statusAfter = { definition_paused: 'paused', definition_resumed: 'active', definition_retired: 'retired' };

function changedName(held: DefinitionName, fact: Exclude<RecordedDefinitionEvent, { type: 'definition_created' }>) {
  if (fact.type === 'definition_updated') {
    return { ...held, hasTriggers: hasTriggers(fact.data.content) };
  }
  if (fact.type === 'definition_restored') {
    return { ...held, status: 'paused', hasTriggers: hasTriggers(fact.data.content) };
  }
  return { ...held, status: statusAfter[fact.type] };
}

function nameAfterIn(types: readonly string[]): DefinitionNames['nameAfter'] {
  return (held, message) => {
    const fact = definitionFactOf(message);
    if (fact?.type === 'definition_created') {
      return createdName(types, message.stream, fact);
    }
    return held === undefined || fact === undefined ? undefined : changedName(held, fact);
  };
}

function takenBy(claimed: DefinitionName, holder: DefinitionName): Conflict {
  const label = definitionResourceLabel(claimed.definitionType);
  return new Conflict({
    detail:
      holder.status === 'retired'
        ? `The ${label} ${holder.name} was retired and keeps its name; restore_definition brings it back`
        : `The playbook already has the ${label} ${holder.name}`,
    kind: 'taken',
  });
}

const checkedBy = ['definition_created', 'definition_updated', 'definition_restored'];

function savingOf(factType: string): string {
  if (factType === 'definition_created') {
    return 'creating another';
  }
  return factType === 'definition_updated' ? 'saving another version' : 'restoring one';
}

function boundsOf(mostActiveOf: (type: string) => number): readonly NameBound[] {
  return [
    {
      checkedBy,
      counts: ({ status }) => status !== 'retired',
      most: mostActiveOf,
      beyond: ({ definitionType }, factType, before, most) =>
        new Conflict({
          detail: `The playbook keeps ${plainNumber(before)} ${definitionResourceLabel(definitionType)}s, and a playbook may keep at most ${plainNumber(most)}; retire one before ${savingOf(factType)}`,
        }),
    },
    {
      checkedBy,
      counts: (name) => name.status !== 'retired' && name.hasTriggers,
      most: () => mostReactingDefinitions,
      beyond: ({ definitionType }) =>
        new Conflict({
          detail: `The playbook already has ${mostReactingDefinitions} ${definitionResourceLabel(definitionType)}s that start on their own, the most a playbook holds; retire one, or save this one without its schedule`,
        }),
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
