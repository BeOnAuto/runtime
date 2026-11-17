import { Conflict } from '@on.auto/operations';
import type { DefinitionNames } from '@on.auto/operations/definition-names';
import { labelReadModelOf, noteHolders, runTallies, runTallyRows, topicRows } from '@on.auto/operations/testing';
import { Schema } from 'effect';

import { carryingOnToTheLayoutKept } from '../layout/carrying-on-behaviour.ts';
import type { StoreLayerOptions } from '../ledger-layer.ts';

const decodeNamed = Schema.decodeUnknownSync(Schema.Struct({ detail: Schema.Struct({ name: Schema.String }) }));

const definitionNames: DefinitionNames = {
  types: ['named'],
  holdsNames: () => true,
  definitionKeyOf: ({ stream }) => `${stream.split('/').slice(0, 3).join('/')}/`,
  nameAfter: (_held, { data }) => ({
    playbookKey: 'playbook/acme/alpha/',
    definitionType: 'reasoning',
    name: decodeNamed(data).detail.name,
    status: 'active',
    hasTriggers: true,
  }),
  takenBy: (claimed) => new Conflict({ detail: `${claimed.name} is held by another definition`, kind: 'taken' }),
};

export const pinnedTables: StoreLayerOptions = {
  runOutcomes: runTallies,
  projections: [runTallyRows, topicRows],
  streamProjections: [labelReadModelOf()],
  holders: noteHolders,
  definitionNames,
  layoutSteps: carryingOnToTheLayoutKept.steps,
};
