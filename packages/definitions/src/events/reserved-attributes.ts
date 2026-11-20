import { connectionSourcePrefix, runtimeAttributeTypes } from '@on.auto/workflow-engine';
import { Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { composedFactsOf, type CapabilityFacts } from '../run-work/declared-facts.ts';
import { coreRunFactTypes } from '../runs/run-events.ts';
import { playbookFeedTypes } from './playbook-feed-types.ts';

export const runSourcePrefix = '/runs/';

export const definitionSourcePrefix = '/definitions/';

export const callerSourcePrefix = '/callers/';

type NamingCapability = Pick<Capability, 'type' | 'facts'> & Partial<Pick<Capability, 'runWords'>>;

function deferralTypesOf(capabilities: readonly NamingCapability[]): readonly string[] {
  return capabilities.flatMap(({ runWords }) => (runWords === undefined ? [] : [runWords.deferralType]));
}

function streamTypesOf({ streams }: CapabilityFacts): readonly string[] {
  return streams.flatMap(({ publicNames }) => Object.values(publicNames).flat());
}

function playbookTypesOf(capabilities: readonly NamingCapability[], facts: CapabilityFacts): ReadonlySet<string> {
  return new Set([
    ...coreRunFactTypes,
    ...facts.onRuns.map(({ type }) => type),
    ...deferralTypesOf(capabilities),
    ...streamTypesOf(facts),
    ...playbookFeedTypes,
  ]);
}

const reservedSourcePrefixes: readonly string[] = [
  runSourcePrefix,
  definitionSourcePrefix,
  callerSourcePrefix,
  connectionSourcePrefix,
];

export const reservedSourcesInWords = new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(
  reservedSourcePrefixes,
);

interface Attributes {
  readonly type: string;
  readonly source?: string;
  readonly [attribute: string]: unknown;
}

export function isReservedSource(source: string): boolean {
  return reservedSourcePrefixes.some((prefix) => source.startsWith(prefix));
}

const reservedAttributeNames: readonly string[] = [...runtimeAttributeTypes.keys()];

const reservedAttributesInWords = new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(reservedAttributeNames);

function lineageIssues(attributes: Attributes) {
  return reservedAttributeNames
    .filter((name) => Object.hasOwn(attributes, name))
    .map((name) => ({
      path: [name],
      issue: `Expected no ${name}: ${reservedAttributesInWords} are the lineage and context the playbook gives its own records, which no event may claim`,
    }));
}

function playbookOwnAttributesOf(types: ReadonlySet<string>) {
  const typesInWords = [...types].join(', ');
  return (attributes: Attributes) => {
    const { type, source } = attributes;
    return [
      ...lineageIssues(attributes),
      ...(types.has(type)
        ? [
            {
              path: ['type'],
              issue: `Expected a type of your own, not one the playbook records itself: ${typesInWords}`,
            },
          ]
        : []),
      ...(source !== undefined && isReservedSource(source)
        ? [
            {
              path: ['source'],
              issue: `Expected a source of your own, not one under ${reservedSourcesInWords}, which the playbook keeps for itself`,
            },
          ]
        : []),
    ];
  };
}

function refusingOf(types: ReadonlySet<string>) {
  return Schema.makeFilter(playbookOwnAttributesOf(types));
}

export interface PlaybookOwnNames {
  readonly types: ReadonlySet<string>;
  readonly refusingThePlaybooksOwnAttributes: ReturnType<typeof refusingOf>;
}

export function playbookOwnNamesOf(
  capabilities: readonly NamingCapability[],
  facts: CapabilityFacts = composedFactsOf(capabilities),
): PlaybookOwnNames {
  const types = playbookTypesOf(capabilities, facts);
  return { types, refusingThePlaybooksOwnAttributes: refusingOf(types) };
}
