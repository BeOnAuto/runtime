import { Cause, Effect, Exit, Result, Schema } from 'effect';

import type { DefinitionName, DefinitionNames, HeldName, NameAfter } from '../definition-names/name-judgement.ts';
import { ActedContextSchema } from '../ledger/context.ts';
import { factOf, type Decided, type Decider } from '../ledger/decider.ts';
import type { Ledger } from '../ledger/ledger.ts';
import { Conflict } from '../outcome/conflict.ts';

export interface NamesAtThePort {
  readonly ledger: Pick<
    Ledger['Service'],
    | 'execute'
    | 'executeMultiStream'
    | 'load'
    | 'holderOfName'
    | 'nameHeldBy'
    | 'namesHeldIn'
    | 'holderOfStream'
    | 'readRecorded'
    | 'readRecordedEvent'
    | 'readAppendedFacts'
  >;
  readonly names: () => Promise<readonly HeldName[]>;
}

export interface NamesAtThePortEntry {
  readonly keeping: (names: DefinitionNames) => Promise<NamesAtThePort>;
}

const Detail = Schema.Struct({
  definition: Schema.optionalKey(Schema.String),
  playbook: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  name: Schema.String,
  starts: Schema.optionalKey(Schema.Boolean),
});

const detailOf = Schema.decodeUnknownSync(Detail);

const noted = (type: string) => factOf(type, Detail, ActedContextSchema);

const NotedSchema = Schema.Union([
  noted('made'),
  noted('renamed'),
  noted('set_aside'),
  noted('forgotten'),
  noted('remarked'),
]);

type Noted = typeof NotedSchema.Type;

const noting: Decider<null, readonly Decided<Noted>[], Noted> = {
  initialState: null,
  evolve: (state) => state,
  eventSchema: NotedSchema,
  decide: (facts) => Result.succeed(facts),
  context: () => ({ at: '2026-11-13T09:00:00.000Z', by: 'tester' }),
};

function changed(held: DefinitionName, type: string, { name, starts }: typeof Detail.Type): NameAfter {
  const after: Readonly<Record<string, NameAfter>> = {
    renamed: { ...held, name, hasTriggers: starts ?? held.hasTriggers },
    set_aside: { ...held, status: 'retired' },
    forgotten: 'released',
  };
  return after[type];
}

function nameAfter(
  held: DefinitionName | undefined,
  { type, data }: { readonly type: string; readonly data: unknown },
) {
  const detail = detailOf(data);
  const { playbook = 'alpha', type: definitionType = 'reasoning', name, starts = false } = detail;
  if (type === 'made') {
    const playbookKey = `playbook/acme/${playbook}/`;
    return { playbookKey, definitionType, name, status: 'active', hasTriggers: starts };
  }
  return held === undefined ? undefined : changed(held, type, detail);
}

export const unbounded: DefinitionNames = {
  types: ['made', 'renamed', 'set_aside', 'forgotten', 'remarked'],
  holdsNames: () => true,
  definitionKeyOf: ({ data }) => {
    const { definition } = detailOf(data);
    return definition === undefined ? undefined : `definition/acme/${definition}/`;
  },
  nameAfter,
  takenBy: (claimed, holder) =>
    new Conflict({ detail: `${claimed.name} is held by a definition ${holder.status}`, kind: 'taken' }),
};

export const bounded: DefinitionNames = {
  ...unbounded,
  bounds: [
    {
      checkedBy: ['made', 'renamed'],
      counts: ({ status }) => status !== 'retired',
      most: () => 2,
      beyond: (claimed, type, before, most) =>
        new Conflict({ detail: `${claimed.name} ${type}: ${before} of ${most}` }),
    },
    {
      checkedBy: ['made', 'renamed'],
      counts: ({ status, hasTriggers }) => status !== 'retired' && hasTriggers,
      most: () => 1,
      beyond: (claimed, type, before, most) =>
        new Conflict({ detail: `${claimed.name} ${type}: ${before} starting of ${most}` }),
    },
  ],
};

export const shared = 'playbook/acme/alpha/definitions/reasoning';

export function fact(
  type: Noted['type'],
  name: string,
  detail: Readonly<Record<string, string | boolean>> = {},
): Decided<Noted> {
  return { type, data: { name, ...detail } };
}

export function made(definition: string, name: string, more: Readonly<Record<string, string | boolean>> = {}) {
  return fact('made', name, { definition, ...more });
}

export async function answerOf(
  { ledger }: NamesAtThePort,
  stream: string,
  ...facts: readonly Decided<Noted>[]
): Promise<unknown> {
  const exit = await Effect.runPromiseExit(ledger.execute(stream, noting, facts));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

export async function answerOfSeveral(
  { ledger }: NamesAtThePort,
  appends: readonly (readonly [string, readonly Decided<Noted>[]])[],
): Promise<unknown> {
  const decisions = appends.map(([stream, facts]) => ({ stream, decider: noting, command: facts }));
  const exit = await Effect.runPromiseExit(ledger.executeMultiStream(decisions));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit.value.map(({ version }) => version);
}

export function taken(name: string, status: string): Conflict {
  return new Conflict({ detail: `${name} is held by a definition ${status}`, kind: 'taken' });
}

export async function heldNames(port: NamesAtThePort): Promise<readonly string[]> {
  return (await port.names()).map(
    ({ definitionKey, playbookKey, definitionType, name, status }) =>
      `${definitionKey.slice('definition/acme/'.length, -1)} ${playbookKey.slice('playbook/acme/'.length)}${definitionType}/${name} ${status}`,
  );
}

export function versionOf({ ledger }: NamesAtThePort, stream: string): Promise<number> {
  return Effect.runPromise(Effect.map(ledger.load(stream, noting), ({ version }) => version));
}
