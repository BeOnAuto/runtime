import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { filterSandboxOf } from '../instances/host-sandboxes.ts';
import {
  playbookWideFilterOf,
  listenFiltersOf,
  listenerFilterOf,
  literalFilterOf,
  type FilterVerdict,
  type LiteralFilter,
} from './event-filter.ts';
import { filterVerdictsOf, type FilterSandbox } from './filter-verdicts.ts';

const at = '/schedule/on/one';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const sandbox: FilterSandbox = filterSandboxOf(shippedFilesOnDisk, () => 0);

const monthClosed: JsonObject = {
  specversion: '1.0',
  id: 'm-2026-09',
  source: '/ledger/eu',
  type: 'com.acme.ledger.month-closed',
  subject: 'september',
  time: '2026-10-01T08:59:00Z',
  data: { region: 'eu', totals: { revenue: 120, costs: 80 } },
};

function filterOf(filter: Json): LiteralFilter {
  const reading = literalFilterOf(filter, at);
  if ('rejections' in reading) {
    throw new Error(`The filter was refused: ${JSON.stringify(reading.rejections)}`);
  }
  return reading.filter;
}

async function matched(attributes: JsonObject, event: JsonObject = monthClosed): Promise<FilterVerdict | undefined> {
  const [verdict] = await filterVerdictsOf([filterOf({ with: attributes })], event, sandbox, now);
  return verdict;
}

function rejectionsOf(filter: Json) {
  const reading = literalFilterOf(filter, at);
  return 'rejections' in reading ? reading.rejections : [];
}

function inRegion(region: string): { readonly reference: string; readonly attributes: JsonObject } {
  return {
    reference: at,
    attributes: { type: 'com.acme.ledger.month-closed', data: `\${ $data.region == "${region}" }` },
  };
}

describe('an event filter matched over the event alone', () => {
  it('reads as the attributes it tests, at its place in the document', () => {
    expect(
      literalFilterOf(
        { with: { type: 'com.acme.ledger.month-closed', source: '/ledger/eu', data: '${ $data.region == "eu" }' } },
        at,
      ),
    ).toEqual({
      filter: {
        reference: at,
        type: 'com.acme.ledger.month-closed',
        attributes: { type: 'com.acme.ledger.month-closed', source: '/ledger/eu', data: '${ $data.region == "eu" }' },
      },
    });
  });
});

describe('matching an event over the event alone', () => {
  it('matches the type, the source and the subject as written', async () => {
    expect(await matched({ type: 'com.acme.ledger.month-closed' })).toBe(true);
    expect(await matched({ type: 'com.acme.ledger.month-closed', source: '/ledger/eu', subject: 'september' })).toBe(
      true,
    );
    expect(await matched({ type: 'com.acme.ledger.month-opened' })).toBe(false);
    expect(await matched({ type: 'com.acme.ledger.month-closed', source: '/ledger/us' })).toBe(false);
    expect(await matched({ type: 'com.acme.ledger.month-closed', subject: 'october' })).toBe(false);
  });

  it('matches no event that lacks an attribute it names', async () => {
    const { subject: _subject, ...withoutSubject } = monthClosed;

    expect(await matched({ type: 'com.acme.ledger.month-closed', subject: 'september' }, withoutSubject)).toBe(false);
  });

  it('evaluates a data expression over the data of the event, as a listen task does', async () => {
    expect(await matched({ type: 'com.acme.ledger.month-closed', data: '${ $data.region == "eu" }' })).toBe(true);
    expect(
      await matched({ type: 'com.acme.ledger.month-closed', data: '${ $data.totals.revenue > $data.totals.costs }' }),
    ).toBe(true);
    expect(await matched({ type: 'com.acme.ledger.month-closed', data: '${ $data.region == "us" }' })).toBe(false);
    expect(await matched({ type: 'com.acme.ledger.month-closed', data: '${ $data.missing }' })).toBe(false);
  });

  it('evaluates with the time it is given as the moment of Date', async () => {
    expect(
      await matched({
        type: 'com.acme.ledger.month-closed',
        data: '${ new Date().toISOString() == "2026-10-01T09:00:00.000Z" }',
      }),
    ).toBe(true);
  });

  it('compares written data as JSON, in any order of keys', async () => {
    const data = { totals: { costs: 80, revenue: 120 }, region: 'eu' };

    expect(await matched({ type: 'com.acme.ledger.month-closed', data })).toBe(true);
    expect(await matched({ type: 'com.acme.ledger.month-closed', data: { region: 'eu' } })).toBe(false);
  });

  it('takes filters of their place and their attributes alone, as a trigger keeps them, and matches them in one batch', async () => {
    expect(await filterVerdictsOf([inRegion('eu'), inRegion('us'), inRegion('eu')], monthClosed, sandbox, now)).toEqual(
      [true, false, true],
    );
  });
});

describe('matching an event whose data expression fails', () => {
  it('answers the error a run would raise, at the place of the filter', async () => {
    const verdict = await matched({ type: 'com.acme.ledger.month-closed', data: '${ $data.totals.missing.value }' });

    expect(verdict).toMatchObject({
      error: {
        type: 'https://open-workflow-specification.org/spec/1.0.0/errors/expression',
        status: 400,
        title: 'An expression failed',
        instance: at,
      },
    });
    expect(JSON.stringify(verdict)).toContain('$data.totals.missing.value');
  });

  it('answers an error for a data expression that does more work than an expression of a workflow may', async () => {
    const verdict = await matched({ type: 'com.acme.ledger.month-closed', data: '${ (() => { for (;;) {} })() }' });

    expect(verdict).toMatchObject({
      error: { type: 'https://open-workflow-specification.org/spec/1.0.0/errors/runtime', status: 500, instance: at },
    });
    expect(JSON.stringify(verdict)).toContain(
      'an expression of a filter may do 250 checkpoints of work, and those of one filter 500 together',
    );
  });

  it('answers an error for a filter whose context did not freeze in time', async () => {
    const ticking = { at: 0 };
    const late = filterSandboxOf(shippedFilesOnDisk, () => {
      ticking.at += 5000;
      return ticking.at;
    });
    const verdicts = await filterVerdictsOf(
      [filterOf({ with: { type: 'com.acme.ledger.month-closed', data: '${ $data.region == "eu" }' } })],
      monthClosed,
      late,
      now,
    );

    expect(verdicts).toMatchObject([{ error: { status: 500 } }]);
  });
});

describe('an event filter that cannot be matched over the event alone', () => {
  it('is refused when it is not a mapping with with', () => {
    const notAFilter = [
      {
        pointer: at,
        detail: 'An event filter is a mapping whose with holds the attributes to match',
        forbidden: false,
      },
    ];

    expect(rejectionsOf(null)).toEqual(notAFilter);
    expect(rejectionsOf('com.acme.ledger.month-closed')).toEqual(notAFilter);
    expect(rejectionsOf({ type: 'com.acme.ledger.month-closed' })).toEqual(notAFilter);
  });

  it('is refused without a type written out as text', () => {
    expect(rejectionsOf({ with: { source: '/ledger/eu' } })).toEqual([
      {
        pointer: `${at}/with/type`,
        detail: 'An event filter matched over the event alone names the type of the events it takes',
        forbidden: false,
      },
    ]);
    expect(rejectionsOf({ with: { type: '' } })).toEqual([
      { pointer: `${at}/with/type`, detail: 'type is text that is not empty', forbidden: false },
    ]);
    expect(rejectionsOf({ with: { type: 7 } })).toEqual([
      { pointer: `${at}/with/type`, detail: 'type is text that is not empty', forbidden: false },
    ]);
  });
});

describe('an event filter that tests what cannot be matched as it is', () => {
  it('is refused when its type, source or subject is an expression', () => {
    expect(
      rejectionsOf({ with: { type: '${ "com.acme" }', source: '${ $data }', subject: '${ $data.subject }' } }),
    ).toEqual(
      ['type', 'source', 'subject'].map((name) => ({
        pointer: `${at}/with/${name}`,
        detail: `${name} is written out, not computed by an expression, so that it is matched as it is`,
        forbidden: true,
      })),
    );
  });
});

describe('an event filter that names the attributes of the context', () => {
  it('is refused as a listen filter is, for correlate, and for what an event filter does not take', () => {
    const rejections = rejectionsOf({
      with: { type: 'com.acme.ledger.month-closed', data: '${ $data.region }' },
      correlate: { region: { from: '${ $data.region }' } },
      until: true,
    });

    expect(rejections).toEqual([
      { pointer: `${at}/correlate`, detail: 'Correlating events is not supported in this version', forbidden: true },
      { pointer: `${at}/until`, detail: 'until is not part of an event filter, which takes with', forbidden: true },
    ]);
  });
});

async function matchedIfRead(filter: LiteralFilter | undefined): Promise<FilterVerdict | undefined> {
  return filter === undefined ? undefined : (await filterVerdictsOf([filter], monthClosed, sandbox, now))[0];
}

describe('a filter of a listen task that reaches events beyond its run', () => {
  it('is one whose type is written out, and none whose type is computed, missing or empty', () => {
    const filters: readonly Json[] = [
      { with: { type: 'com.acme.closed', source: '/ledger' } },
      { with: { type: '${ "com.acme.closed" }' } },
      { with: { source: '/ledger' } },
      { with: { type: '' } },
      'not a filter',
    ];

    expect(filters.map((filter) => playbookWideFilterOf(filter))).toEqual([
      { type: 'com.acme.closed', source: '/ledger' },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('is matched by its literal attributes and its expressions, which name the data alone', async () => {
    const listener = listenerFilterOf(
      { type: 'com.acme.ledger.month-closed', subject: 'september', data: '${ $data.region == "eu" }' },
      '/do/0/await/listen/to/one',
    );
    const closed = listenerFilterOf({ type: 'com.acme.ledger.month-closed', data: '${ $data.region == "us" }' }, '/x');

    expect(listener).toEqual({
      reference: '/do/0/await/listen/to/one',
      type: 'com.acme.ledger.month-closed',
      attributes: { type: 'com.acme.ledger.month-closed', subject: 'september', data: '${ $data.region == "eu" }' },
    });
    expect(await Promise.all([listener, closed].map((filter) => matchedIfRead(filter)))).toEqual([true, false]);
    expect(listenerFilterOf({ type: '${ "x" }' }, '/x')).toBeUndefined();
  });
});

describe('the filters of a listen task that reach events beyond its run', () => {
  it('are those whose type is written out, of one, any or all, and none of a task that is no listen', () => {
    expect([
      listenFiltersOf({ listen: { to: { one: { with: { type: 'a' } } } } }),
      listenFiltersOf({ listen: { to: { all: [{ with: { type: 'a' } }, { with: { source: '/b' } }] } } }),
      listenFiltersOf({ set: {} }),
      listenFiltersOf(null),
    ]).toEqual([[{ type: 'a' }], [{ type: 'a' }], [], []]);
  });
});
