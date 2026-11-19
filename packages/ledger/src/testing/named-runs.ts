import { Conflict } from '@on.auto/operations';
import { Schema } from 'effect';

import type { DefinitionNames } from '../definition-names/definition-names.ts';
import { happen, noted, type AnyLedger } from './happenings.ts';

export function takenByAnother({ name }: { readonly name: string }): Conflict {
  return new Conflict({ detail: `${name} is held by another definition`, kind: 'taken' });
}

const NamedDetail = Schema.Struct({ detail: Schema.Struct({ type: Schema.String, name: Schema.String }) });

export const namesOfTheRuns: DefinitionNames = {
  types: ['named'],
  holdsNames: (stream) => stream.startsWith('definition/'),
  definitionKeyOf: ({ stream }) => `${stream.split('/').slice(0, 3).join('/')}/`,
  nameAfter: (_held, { data }) => {
    const { type, name } = Schema.decodeUnknownSync(NamedDetail)(data).detail;
    return { playbookKey: 'playbook/acme/alpha/', definitionType: type, name, status: 'active', hasTriggers: false };
  },
  takenBy: takenByAnother,
};

export function keyOf(type: string, name: string): string {
  return `definition/acme/${type}-${name}/`;
}

export function definitionsHolding(ledger: AnyLedger, named: readonly (readonly [string, string])[]): Promise<unknown> {
  return Promise.all(
    named.map(([type, name]) =>
      happen(ledger, `${keyOf(type, name)}definitions/${type}`, noted('named', { type, name })),
    ),
  );
}
