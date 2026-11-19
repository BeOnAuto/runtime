import {
  Ledger,
  recordedCallerOf,
  streamPrefixOfPlaybook,
  type Decider,
  type PlaybookAddress,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { DefinitionEventSchema, type RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { acmeAdmin } from './callers.ts';
import { firstMoment, type Harness } from './harness.ts';

export interface Renamed {
  readonly type: string;
  readonly from: string;
  readonly to: string;
}

const renamings: readonly [readonly [string, string], ...(readonly [string, string])[]] = [
  ['first', 'second'],
  ['second', 'third-one'],
  ['third-one', 'first'],
];

export function renamedInTurn(type: string, turn: number): Renamed {
  const at = turn % renamings.length;
  const [from, to] = renamings.reduce((kept, each, index) => (index === at ? each : kept), renamings[0]);
  return { type, from, to };
}

interface Renaming {
  readonly from: string;
  readonly to: string;
  readonly at: string;
}

function renamingDecider(type: string): Decider<number, Renaming, RecordedDefinitionEvent> {
  return {
    initialState: 0,
    evolve: (_version, { context }) => context.definitionVersion,
    eventSchema: DefinitionEventSchema,
    decide: ({ from, to }) =>
      Result.succeed([{ type: 'definition_renamed', data: { from, to, renamed_by: recordedCallerOf(acmeAdmin) } }]),
    context: ({ to, at }, version) => ({
      at,
      by: acmeAdmin.id,
      definitionType: type,
      definitionName: to,
      definitionVersion: version,
    }),
  };
}

export function renamedOn(
  ledger: Ledger['Service'],
  playbook: PlaybookAddress,
  { type, from, to }: Renamed,
  at: string,
): Effect.Effect<void> {
  const named = { playbookKey: streamPrefixOfPlaybook(playbook), definitionType: type, name: from };
  return Effect.flatMap(ledger.holderOfName(named), (held) =>
    held === undefined
      ? Effect.void
      : Effect.ignore(
          ledger.execute(`${held.definitionKey}${definitionTypeStreamOf(type)}`, renamingDecider(type), {
            from,
            to,
            at,
          }),
        ),
  );
}

export function renamedIn(definitions: Harness, renamed: Renamed, at = firstMoment): Promise<void> {
  return definitions.run(
    Ledger.use((ledger) => renamedOn(ledger, { org: 'acme', playbook: 'alpha' }, renamed, at)),
    at,
  );
}
