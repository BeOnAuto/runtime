import { Cause, Effect, Exit, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionName, DefinitionNames, HeldName, NameAfter } from '../definition-names/name-judgement.ts';
import { ActedContextSchema } from '../ledger/context.ts';
import { factOf, type Decided, type Decider } from '../ledger/decider.ts';
import type { Ledger } from '../ledger/ledger.ts';
import { Conflict } from '../outcome/conflict.ts';

export interface NamesAtThePort {
  readonly ledger: Pick<Ledger['Service'], 'execute' | 'load'>;
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

const unbounded: DefinitionNames = {
  types: ['made', 'renamed', 'set_aside', 'forgotten', 'remarked'],
  definitionKeyOf: ({ data }) => {
    const { definition } = detailOf(data);
    return definition === undefined ? undefined : `definition/acme/${definition}/`;
  },
  nameAfter,
  takenBy: (claimed, holder) =>
    new Conflict({ detail: `${claimed.name} is held by a definition ${holder.status}`, kind: 'taken' }),
};

const bounded: DefinitionNames = {
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

const shared = 'playbook/acme/alpha/definitions/reasoning';

function fact(
  type: Noted['type'],
  name: string,
  detail: Readonly<Record<string, string | boolean>> = {},
): Decided<Noted> {
  return { type, data: { name, ...detail } };
}

function made(definition: string, name: string, more: Readonly<Record<string, string | boolean>> = {}) {
  return fact('made', name, { definition, ...more });
}

async function answerOf(
  { ledger }: NamesAtThePort,
  stream: string,
  ...facts: readonly Decided<Noted>[]
): Promise<unknown> {
  const exit = await Effect.runPromiseExit(ledger.execute(stream, noting, facts));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

function taken(name: string, status: string): Conflict {
  return new Conflict({ detail: `${name} is held by a definition ${status}`, kind: 'taken' });
}

async function heldNames(port: NamesAtThePort): Promise<readonly string[]> {
  return (await port.names()).map(
    ({ definitionKey, playbookKey, definitionType, name, status }) =>
      `${definitionKey.slice('definition/acme/'.length, -1)} ${playbookKey.slice('playbook/acme/'.length)}${definitionType}/${name} ${status}`,
  );
}

function versionOf({ ledger }: NamesAtThePort, stream: string): Promise<number> {
  return Effect.runPromise(Effect.map(ledger.load(stream, noting), ({ version }) => version));
}

function claimedOnce(entry: NamesAtThePortEntry): void {
  it('keeps the name a definition claims, and refuses one another holds with the conflict, keeping nothing of the append', async () => {
    const port = await entry.keeping(unbounded);
    await answerOf(port, shared, made('a', 'triage'));

    const refused = await answerOf(port, shared, made('b', 'triage'), fact('remarked', '-'));

    expect(refused).toEqual(taken('triage', 'active'));
    expect(await versionOf(port, shared)).toBe(1);
    expect(await heldNames(port)).toEqual(['a alpha/reasoning/triage active']);
  });

  it('holds a name unique among the definitions of its type in its playbook alone, and claims none for a fact of no definition', async () => {
    const port = await entry.keeping(unbounded);
    await answerOf(port, shared, made('a', 'triage'));

    const answers = [
      await answerOf(port, shared, made('b', 'triage', { type: 'workflow' })),
      await answerOf(port, shared, made('c', 'triage', { playbook: 'beta' })),
      await answerOf(port, shared, fact('made', 'triage')),
      await answerOf(port, shared, fact('renamed', 'loose', { definition: 'z' })),
    ];

    expect(answers).toEqual([null, null, null, null]);
    expect(await heldNames(port)).toEqual([
      'a alpha/reasoning/triage active',
      'b alpha/workflow/triage active',
      'c beta/reasoning/triage active',
    ]);
  });
}

function changes(entry: NamesAtThePortEntry): void {
  it('frees a name given up or released at once, keeps a retired one, and judges a whole append as one change', async () => {
    const port = await entry.keeping(unbounded);
    await answerOf(port, shared, made('a', 'triage'), made('b', 'brief'), made('c', 'old'));

    const answers = [
      await answerOf(
        port,
        shared,
        fact('renamed', 'brief', { definition: 'a' }),
        fact('renamed', 'triage', { definition: 'b' }),
      ),
      await answerOf(port, shared, fact('forgotten', '-', { definition: 'c' }), made('d', 'old')),
      await answerOf(port, shared, fact('set_aside', '-', { definition: 'd' })),
      await answerOf(port, shared, made('e', 'old')),
    ];

    expect(answers).toEqual([null, null, null, taken('old', 'retired')]);
    expect(await heldNames(port)).toEqual([
      'a alpha/reasoning/brief active',
      'b alpha/reasoning/triage active',
      'd alpha/reasoning/old retired',
    ]);
  });

  it('answers one of two claims made at once on one name and refuses the other as taken', async () => {
    const port = await entry.keeping(unbounded);

    const answers = await Promise.all([
      answerOf(port, `${shared}-one`, made('a', 'triage')),
      answerOf(port, `${shared}-two`, made('b', 'triage')),
    ]);

    expect(answers.filter((answer) => answer !== null)).toEqual([taken('triage', 'active')]);
    expect(await port.names()).toHaveLength(1);
  });
}

function bounds(entry: NamesAtThePortEntry): void {
  it('refuses a checked fact that leaves more counted than a bound, with the count before, in the order the bounds are declared', async () => {
    const port = await entry.keeping(bounded);
    await answerOf(port, shared, made('a', 'triage', { starts: true }), made('b', 'brief'));

    const answers = [
      await answerOf(port, shared, made('c', 'review')),
      await answerOf(port, shared, fact('renamed', 'digest', { definition: 'b', starts: true })),
      await answerOf(port, shared, fact('set_aside', '-', { definition: 'b' })),
      await answerOf(port, shared, made('c', 'review')),
    ];

    expect(answers).toEqual([
      new Conflict({ detail: 'review made: 2 of 2' }),
      new Conflict({ detail: 'digest renamed: 1 starting of 1' }),
      null,
      null,
    ]);
    expect(await port.names()).toHaveLength(3);
  });

  it('keeps one of two appends made at once that each add the last definition a bound allows, and refuses the other with the bound', async () => {
    const port = await entry.keeping(bounded);
    await answerOf(port, shared, made('a', 'triage'));

    const answers = await Promise.all([
      answerOf(port, `${shared}-one`, made('b', 'brief')),
      answerOf(port, `${shared}-two`, made('c', 'review')),
    ]);

    const [refused, ...more] = answers.filter((answer) => answer !== null);
    expect(more).toEqual([]);
    expect([
      new Conflict({ detail: 'brief made: 2 of 2' }),
      new Conflict({ detail: 'review made: 2 of 2' }),
    ]).toContainEqual(refused);
    expect(await port.names()).toHaveLength(2);
  });
}

export function namesAtThePortBehaviour(entry: NamesAtThePortEntry): void {
  describe('the names of definitions, judged at the port', () => {
    claimedOnce(entry);
    changes(entry);
    bounds(entry);
  });
}
