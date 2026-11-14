import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { Conflict } from '../outcome/conflict.ts';
import {
  boundRefusal,
  claimsOf,
  definitionsInTheAppend,
  judgedOf,
  kindsChanged,
  takenRefusal,
  type DefinitionJudged,
  type DefinitionName,
  type DefinitionNames,
  type HeldName,
  type NameAfter,
  type NamedMessage,
} from './name-judgement.ts';

const alpha = 'playbook/acme/alpha/';

function message(
  type: string,
  data: Readonly<Record<string, string | boolean>>,
  stream = 'definitions/reasoning',
): NamedMessage {
  return {
    stream,
    type,
    data,
    id: `${type}-${JSON.stringify(data)}`,
    position: 1,
    context: { at: '2026-11-13T00:00:00.000Z', by: 'tester' },
  };
}

const Data = Schema.Struct({
  definition: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  starts: Schema.optionalKey(Schema.String),
});

const dataOf = Schema.decodeUnknownSync(Data);

function only<A>(value: A | undefined): A {
  if (value === undefined) {
    throw new Error('The case expected a value here');
  }
  return value;
}

function nameAfter(before: DefinitionName | undefined, { type, data }: Pick<NamedMessage, 'type' | 'data'>): NameAfter {
  const { name = '', type: definitionType = 'reasoning', starts } = dataOf(data);
  if (type === 'made') {
    return { playbookKey: alpha, definitionType, name, status: 'active', hasTriggers: starts === 'true' };
  }
  if (before === undefined) {
    return undefined;
  }
  const changed: Readonly<Record<string, NameAfter>> = {
    renamed: { ...before, name },
    paused: { ...before, status: 'paused' },
    set_aside: { ...before, status: 'retired' },
    forgotten: 'released',
  };
  return changed[type];
}

const names: DefinitionNames = {
  types: ['made', 'renamed', 'paused', 'set_aside', 'forgotten'],
  holdsNames: (stream) => !stream.startsWith('runs/'),
  definitionKeyOf: ({ data }) => {
    const { definition } = dataOf(data);
    return definition === undefined ? undefined : `definition/acme/${definition}/`;
  },
  nameAfter,
  takenBy: (claimed, holder) =>
    new Conflict({
      detail: `${claimed.name} is held by ${holder.name} ${holder.status}`,
      kind: 'taken',
    }),
};

const bounded: DefinitionNames = {
  ...names,
  bounds: [
    {
      checkedBy: ['made'],
      counts: ({ status }) => status !== 'retired',
      most: () => 2,
      beyond: (claimed, factType, before, most) =>
        new Conflict({ detail: `${claimed.name} ${factType} ${before}/${most}` }),
    },
    {
      checkedBy: ['made', 'renamed'],
      counts: ({ status, hasTriggers }) => status !== 'retired' && hasTriggers,
      most: () => 0,
      beyond: (claimed, factType, before, most) =>
        new Conflict({ detail: `${claimed.name} starts ${factType} ${before}/${most}` }),
    },
  ],
};

function held(definition: string, name: string, more: Partial<DefinitionName> = {}): HeldName {
  return {
    definitionKey: `definition/acme/${definition}/`,
    playbookKey: alpha,
    definitionType: 'reasoning',
    name,
    status: 'active',
    hasTriggers: false,
    ...more,
  };
}

function judged(
  declared: DefinitionNames,
  rows: readonly HeldName[],
  messages: readonly NamedMessage[],
): readonly DefinitionJudged[] {
  return definitionsInTheAppend(declared, messages).map((definition) =>
    judgedOf(
      declared,
      definition,
      rows.find(({ definitionKey }) => definitionKey === definition.definitionKey),
    ),
  );
}

describe('the names of an append, judged at once', () => {
  it('groups the facts of an append by the definition the declaration names, in the order of their keys, the stream of each its last, and none of a stream that holds no names', () => {
    const grouped = definitionsInTheAppend(names, [
      message('made', { definition: 'b', name: 'one' }),
      message('remarked', {}),
      message('made', { definition: 'c', name: 'four' }, 'runs/r1'),
      message('made', { definition: 'a', name: 'two' }),
      message('renamed', { definition: 'b', name: 'three' }, 'elsewhere'),
    ]);

    expect(grouped.map(({ definitionKey, stream, messages }) => [definitionKey, stream, messages.length])).toEqual([
      ['definition/acme/a/', 'definitions/reasoning', 1],
      ['definition/acme/b/', 'elsewhere', 2],
    ]);
  });

  it('folds each definition to the name it holds at the end, leaving it as it was for a fact that changes none and holding none once released', () => {
    const [kept, released] = judged(
      names,
      [held('a', 'triage')],
      [
        message('paused', { definition: 'a' }),
        message('renamed', { definition: 'b', name: 'lost' }),
        message('made', { definition: 'b', name: 'brief' }),
        message('forgotten', { definition: 'b' }),
      ],
    );

    expect(kept).toMatchObject({ end: { name: 'triage', status: 'paused' } });
    expect(released).toMatchObject({ end: undefined, changedBy: [{ type: 'made' }, { type: 'forgotten' }] });
  });
});

describe('the claims of an append', () => {
  it('claims the names a definition holds at the end and did not hold before, in the order of the playbook, the name and the definition', () => {
    const claims = claimsOf(
      judged(
        names,
        [held('a', 'triage')],
        [
          message('paused', { definition: 'a' }),
          message('made', { definition: 'c', name: 'zeta' }),
          message('made', { definition: 'b', name: 'alpha' }),
          message('made', { definition: 'd', name: 'gone' }),
          message('forgotten', { definition: 'd' }),
        ],
      ),
    );

    expect(claims.map(({ claimed, claimant }) => `${claimed.name} ${claimant.definitionKey}`)).toEqual([
      'alpha definition/acme/b/',
      'zeta definition/acme/c/',
    ]);
  });
});

describe('a name claimed in an append', () => {
  it('refuses a name another definition holds at the end of the append, and takes one free, held by its claimant or given up in the append', () => {
    const rows = [held('a', 'triage'), held('b', 'brief'), held('c', 'kept')];
    const facts = [
      message('renamed', { definition: 'a', name: 'brief' }),
      message('renamed', { definition: 'b', name: 'triage' }),
      message('renamed', { definition: 'd', name: 'kept' }),
      message('made', { definition: 'd', name: 'kept' }),
    ];
    const append = judged(names, rows, facts);
    const claims = claimsOf(append);
    const [toBrief, toKept, toTriage] = [only(claims[0]), only(claims[1]), only(claims[2])];

    expect([
      takenRefusal(names, append, toBrief, held('b', 'brief')),
      takenRefusal(names, append, toTriage, held('a', 'triage')),
      takenRefusal(names, append, toTriage),
      takenRefusal(names, append, toTriage, held('b', 'triage')),
      takenRefusal(names, append, toKept, held('c', 'kept'))?.conflict.detail,
    ]).toEqual([undefined, undefined, undefined, undefined, 'kept is held by kept active']);
  });

  it('refuses a name two definitions of one append claim, each in the words of the other as it stands at the end', () => {
    const append = judged(
      names,
      [],
      [
        message('made', { definition: 'a', name: 'triage' }),
        message('paused', { definition: 'a' }),
        message('made', { definition: 'b', name: 'triage' }),
        message('made', { definition: 'c', name: 'gone' }),
        message('forgotten', { definition: 'c' }),
      ],
    );

    expect(claimsOf(append).map((claim) => takenRefusal(names, append, claim))).toEqual([
      {
        conflict: new Conflict({ detail: 'triage is held by triage active', kind: 'taken' }),
        stream: 'definitions/reasoning',
      },
      {
        conflict: new Conflict({ detail: 'triage is held by triage paused', kind: 'taken' }),
        stream: 'definitions/reasoning',
      },
    ]);
  });
});

describe('the playbooks and types an append changes', () => {
  it('names every playbook and type whose names an append changes once, in order, and none of a definition it leaves as it was', () => {
    const kinds = kindsChanged(
      judged(
        names,
        [held('a', 'triage'), held('b', 'brief')],
        [
          message('renamed', { definition: 'a', name: 'first' }),
          message('remarked', { definition: 'b' }),
          message('made', { definition: 'c', name: 'flow', type: 'workflow' }),
        ],
      ),
    );

    expect(kinds).toEqual([
      { playbookKey: alpha, definitionType: 'reasoning' },
      { playbookKey: alpha, definitionType: 'workflow' },
    ]);
  });
});

describe('the bounds on the names of a playbook', () => {
  const reasoning = { playbookKey: alpha, definitionType: 'reasoning' };

  function refusalOf(
    declared: DefinitionNames,
    rows: readonly HeldName[],
    facts: readonly NamedMessage[],
  ): string | undefined {
    return boundRefusal(declared, judged(declared, rows, facts), reasoning, rows)?.conflict.detail;
  }

  it('refuses a checked fact that leaves more counted than the bound, with the count before, and checks the bounds in their order', () => {
    expect([
      refusalOf(bounded, [held('a', 'one'), held('b', 'two')], [message('made', { definition: 'c', name: 'three' })]),
      refusalOf(bounded, [held('a', 'one')], [message('made', { definition: 'c', name: 'three', starts: 'true' })]),
      refusalOf(bounded, [held('a', 'one')], [message('renamed', { definition: 'a', name: 'uno' })]),
    ]).toEqual(['three made 2/2', 'three starts made 0/0', undefined]);
  });

  it('takes an append beyond a bound that no checked fact of its kind leaves counted, and one with no bounds at all', () => {
    const over = [held('a', 'one'), held('b', 'two'), held('c', 'three')];

    expect([
      refusalOf(bounded, over, [message('paused', { definition: 'a' })]),
      refusalOf(bounded, over, [message('made', { definition: 'd', name: 'four', type: 'workflow' })]),
      refusalOf(bounded, over, [
        message('made', { definition: 'd', name: 'four' }),
        message('set_aside', { definition: 'd' }),
      ]),
      refusalOf(bounded, over, [
        message('made', { definition: 'd', name: 'four' }),
        message('forgotten', { definition: 'd' }),
      ]),
      refusalOf(names, over, [message('made', { definition: 'd', name: 'four' })]),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
