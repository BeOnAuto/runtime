import { describe, expect, it } from 'vitest';

import type { ContentDeclaration, ContentHolders } from '../held-content/content-declaration.ts';
import type { KeyedProjection, ProjectedMessage, ProjectedRow } from '../projections/keyed-projection.ts';
import type { RunOutcome, RunOutcomeMapping } from '../run-outcomes/run-outcomes.ts';
import { payloadReadsOf, type SampledFact } from './payload-reads.ts';

const context = { at: '2026-11-02T09:00:00.000Z', by: 'key_7f3a' };

const started: SampledFact = {
  type: 'run_started',
  data: { input: { lead: 'lead-1', contact: { email: 'lead@example.com' } }, started_by: { id: 'key_7f3a' } },
  context,
};

const deferred: SampledFact = { type: 'run_deferred', data: { request: 'approve' }, context };

const answered: SampledFact = { type: 'request_answered', data: { answer: { choice: 'approve' } }, context };

const succeeded: SampledFact = {
  type: 'run_succeeded',
  data: { output: { score: 0.8 }, record: { cost_usd: 0.25 } },
  context,
};

const saved: SampledFact = {
  type: 'definition_saved',
  data: { content: { source: 'kind: workflow', description: 'Plans the week' }, kept: [] },
  context,
};

const runHolders: ContentHolders = new Map<string, ContentDeclaration>([
  ['run_started', { payloads: [{ sha256: '/input_sha256', bytes: '/input_bytes' }] }],
  ['run_succeeded', { payloads: [{ sha256: '/output_sha256', bytes: '/output_bytes' }] }],
  ['request_answered', { payloads: [{ sha256: '/answer_sha256', bytes: '/answer_bytes' }] }],
  [
    'definition_saved',
    {
      payloads: [
        { sha256: '/content/source_sha256', bytes: '/content/source_bytes' },
        { sha256: '/kept/*/sha256', bytes: '/kept/*/bytes' },
      ],
    },
  ],
]);

function memberOf(data: unknown, ...path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (value, key) => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined),
    data,
  );
}

function projectionOf(name: string, rowAfter: KeyedProjection['rowAfter'], more: Partial<KeyedProjection> = {}) {
  return {
    name,
    version: 1,
    kinds: ['runs'],
    types: ['run_started', 'run_succeeded', 'definition_saved'],
    columns: [],
    indexes: [],
    rowAfter,
    ...more,
  } satisfies KeyedProjection;
}

function costOf(row: ProjectedRow | undefined, { data }: ProjectedMessage): ProjectedRow {
  const cost = memberOf(data, 'record', 'cost_usd');
  return { ...row, cost: typeof cost === 'number' ? cost : (row?.['cost'] ?? null) };
}

function lastOutputOf(row: ProjectedRow | undefined, { data }: ProjectedMessage): ProjectedRow {
  return row === undefined ? { started: true } : { ...row, score: String(memberOf(data, 'output', 'score')) };
}

function strictAboutOutputs(row: ProjectedRow | undefined, { data }: ProjectedMessage): ProjectedRow | undefined {
  if (memberOf(data, 'output_sha256') !== undefined) {
    throw new Error('An output kept outside');
  }
  return row;
}

function answerAfterADeferral(row: ProjectedRow | undefined, { type, data }: ProjectedMessage): ProjectedRow {
  const steps = `${String(row?.['steps'] ?? '')}${type};`;
  const answersTheDeferral = steps.endsWith('run_started;run_deferred;request_answered;');
  return { ...row, steps, answer: answersTheDeferral ? String(memberOf(data, 'answer', 'choice')) : null };
}

const outcome: RunOutcome = {
  startedDay: '2026-11-02',
  startedAt: context.at,
  lastStartedAt: context.at,
  definitionType: 'reasoning',
  name: 'qualify-lead',
  status: 'succeeded',
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  cachedTokens: null,
  costMicroUsd: null,
};

const answers = projectionOf('answers', answerAfterADeferral, {
  types: ['run_started', 'run_deferred', 'request_answered'],
});

function statusOf(data: unknown): string {
  return String(memberOf(data, 'input', 'status') ?? memberOf(data, 'status'));
}

const statuses = projectionOf('statuses', (row, { data }) => ({ ...row, status: statusOf(data) }));

const kinds = projectionOf(
  'kinds',
  (row, { data }) => ({
    ...row,
    email: String(memberOf(data, 'input', 'contact', 'email')),
    shown: String(memberOf(data, 'input', 'contact')),
    items: String(memberOf(data, 'items', 'length')),
  }),
  { types: ['run_started', 'listed'] },
);

const valued = projectionOf(
  'valued',
  (row, { data }) => ({ ...row, second: String(memberOf(data, 'items', '1', 'value')) }),
  { types: ['listed'] },
);

const listHolders: ContentHolders = new Map([
  ...runHolders,
  ['listed', { payloads: [{ sha256: '/items/*/value_sha256', bytes: '/items/*/value_bytes' }] }],
]);

const listed: SampledFact = {
  type: 'listed',
  data: { items: [{ value: 'text' }, { value: 3 }, { value: true }, { value: null }, { other: 1 }] },
  context,
};

const notAList: SampledFact = { type: 'listed', data: { items: 'not a list' }, context };

const everything = projectionOf('everything', (row, { data }) => ({ ...row, data: JSON.stringify(data) }));

describe('the tables kept from facts, checked against the payloads those facts may keep outside', () => {
  it('pass a table that folds only what never leaves a fact, whichever arm its payloads take', () => {
    const costs = projectionOf('costs', costOf, { keyOf: ({ context: { by } }) => by });

    expect(payloadReadsOf({ projections: [costs] }, runHolders, [started, succeeded, saved])).toEqual([]);
  });

  it("name each table, fact and payload where a table's row or key follows a payload's value, its presence or its shape", () => {
    const leads = projectionOf('leads', (row, { data }) => ({ ...row, lead: String(memberOf(data, 'input', 'lead')) }));
    const sources = projectionOf('sources', (row, { data }) => ({
      ...row,
      has_source: memberOf(data, 'content', 'source') !== undefined,
    }));
    const keyedByScore = projectionOf('scores', costOf, {
      keyOf: ({ data }) => String(memberOf(data, 'output', 'score')),
    });

    expect(
      payloadReadsOf({ projections: [leads, sources, keyedByScore] }, runHolders, [started, succeeded, saved]),
    ).toEqual([
      { table: 'leads_1', type: 'run_started', payload: '/input', because: 'folded' },
      { table: 'sources_1', type: 'definition_saved', payload: '/content/source', because: 'folded' },
      { table: 'scores_1', type: 'run_succeeded', payload: '/output', because: 'folded' },
    ]);
  });

  it('name a table whose fold of a fact after another follows a payload, or throws on a payload kept outside', () => {
    const lastOutputs = projectionOf('last_outputs', lastOutputOf);
    const strict = projectionOf('strict', strictAboutOutputs);

    expect(payloadReadsOf({ projections: [lastOutputs, strict] }, runHolders, [started, succeeded, saved])).toEqual([
      { table: 'last_outputs_1', type: 'run_succeeded', payload: '/output', because: 'folded' },
      { table: 'strict_1', type: 'run_succeeded', payload: '/output', because: 'folded' },
    ]);
  });
});

describe('the tables kept from facts, folded after the facts before them and against other values of a payload', () => {
  it('name a table that follows a payload only after several facts before it, folded in their recorded order', () => {
    const reached: SampledFact = { type: 'run_deferred', data: { request: 'reached' }, context };

    expect(payloadReadsOf({ projections: [answers] }, runHolders, [started, deferred, reached, answered])).toEqual([
      { table: 'answers_1', type: 'request_answered', payload: '/answer', because: 'folded' },
    ]);
  });

  it("name a table that reads a member its fixture's value lacks, as another value of the payload's kind holds it", () => {
    expect(payloadReadsOf({ projections: [statuses] }, runHolders, [started, succeeded, saved])).toEqual([
      { table: 'statuses_1', type: 'run_started', payload: '/input', because: 'folded' },
    ]);
  });

  it('read every value of a payload of any kind the same, but where it lacks a member, and an element of a list as the value its own, where there is a list', () => {
    expect(payloadReadsOf({ projections: [kinds, valued] }, listHolders, [started, listed, notAList])).toEqual([
      { table: 'kinds_1', type: 'run_started', payload: '/input', because: 'folded' },
      { table: 'valued_1', type: 'listed', payload: '/items/*/value', because: 'folded' },
    ]);
  });
});

describe('the outcomes of runs, and a payload no fact samples', () => {
  it('check the outcomes of runs the same way', () => {
    const byScore: RunOutcomeMapping = {
      types: ['run_succeeded'],
      rowAfter: (_row, { data }) => ({ ...outcome, name: String(memberOf(data, 'output', 'score')) }),
    };
    const byCost: RunOutcomeMapping = { types: ['run_succeeded'], rowAfter: () => outcome };

    expect([
      payloadReadsOf({ projections: [], runOutcomes: byScore }, runHolders, [succeeded]),
      payloadReadsOf({ projections: [], runOutcomes: byCost }, runHolders, [succeeded]),
    ]).toEqual([[{ table: 'run_outcomes', type: 'run_succeeded', payload: '/output', because: 'folded' }], []]);
  });

  it('name a payload of a folded type that no fact given holds inline, so its check is never left empty', () => {
    const keptAlready: SampledFact = { ...started, data: { input_sha256: 'a'.repeat(64), input_bytes: 3000 } };
    const notAnObject: SampledFact = { ...saved, data: 'not an object' };

    expect(payloadReadsOf({ projections: [everything] }, runHolders, [keptAlready, notAnObject])).toEqual([
      { table: 'everything_1', type: 'run_started', payload: '/input', because: 'unsampled' },
      { table: 'everything_1', type: 'run_succeeded', payload: '/output', because: 'unsampled' },
      { table: 'everything_1', type: 'definition_saved', payload: '/content/source', because: 'unsampled' },
    ]);
  });
});

describe('the facts the check takes', () => {
  it('check nothing of a list of digests, a type the table does not fold, or a type that declares none', () => {
    const noted: SampledFact = { type: 'noted', data: { input: 'x' }, context };
    const listOnly: SampledFact = {
      ...saved,
      data: { content: { source: 'kind: workflow' }, kept: [{ sha256: 'a'.repeat(64), bytes: 3000 }] },
    };
    const sources = projectionOf(
      'sources',
      (row, { data }) => ({ ...row, kept: JSON.stringify(memberOf(data, 'kept')) }),
      {
        types: ['definition_saved', 'noted'],
      },
    );

    expect(payloadReadsOf({ projections: [sources] }, runHolders, [listOnly, noted, started])).toEqual([]);
  });

  it('take no twin of a pair that names no member beside it: another name, or another place', () => {
    const unpaired: ContentHolders = new Map([
      [
        'run_started',
        {
          payloads: [
            { sha256: '/input_sha256', bytes: '/output_bytes' },
            { sha256: '/one/input_sha256', bytes: '/two/input_bytes' },
          ],
        },
      ],
    ]);
    const listing: SampledFact = { ...started, data: { input: 1, one: { input: 2 } } };

    expect(payloadReadsOf({ projections: [everything] }, unpaired, [listing])).toEqual([]);
  });
});

describe('the tables of a read model, checked as the tables kept from facts are', () => {
  it('name a table of a read model that follows a payload, as a keyed projection of its own is named', () => {
    const leads = projectionOf('leads', (row, { data }) => ({ ...row, lead: String(memberOf(data, 'input', 'lead')) }));
    const readModel = {
      name: 'leads',
      version: 1,
      kind: 'runs',
      streams: ['r'],
      tables: [leads],
      counted: [],
      groupwiseMaxima: [],
    };

    expect(
      payloadReadsOf({ projections: [], streamProjections: [readModel] }, runHolders, [started, succeeded, saved]),
    ).toEqual([{ table: 'leads_1', type: 'run_started', payload: '/input', because: 'folded' }]);
  });
});
