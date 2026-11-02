import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  addressOfStreamPrefix,
  addressedStreamOf,
  advancedColumnsLeftBy,
  advancedColumnsOf,
  requireAdvancedColumns,
  rowKeyOf,
  streamPrefixOfAddress,
  type AddressedStream,
} from './keyed-projection.ts';
import { remarkRows } from './remark-rows.ts';
import { runTallyRows } from './tally-rows.ts';
import { topicRows } from './topic-rows.ts';

const alphaRuns: AddressedStream = {
  scope: 'playbook',
  prefix: 'playbook/acme/alpha/',
  address: { org: 'acme', playbook: 'alpha' },
  kind: 'runs',
  id: 'r1',
};

const acmeRemarks: AddressedStream = {
  scope: 'org',
  prefix: 'org/acme/',
  address: { org: 'acme' },
  kind: 'remarks',
  id: 'r1',
};

describe('the stream a fact was appended to', () => {
  it('is read as the prefix, the playbook or the org, the kind and the id, and nothing that names no kind and id', () => {
    expect([
      addressedStreamOf('playbook/acme/alpha/runs/r1'),
      addressedStreamOf('org/acme/remarks/r1'),
      addressedStreamOf('playbook/acme/alpha/runs'),
      addressedStreamOf('playbook/acme/alpha/runs/r1/nested'),
      addressedStreamOf('org/acme/remarks'),
      addressedStreamOf('org/acme/alpha/runs/r1'),
    ]).toEqual([alphaRuns, acmeRemarks, undefined, undefined, undefined, undefined]);
  });

  it('is of neither a playbook nor an org outside them, though it names a kind and an id', () => {
    expect([addressedStreamOf('runs/acme/alpha/runs/r1'), addressedStreamOf('orgs/acme/remarks/r1')]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('the address of a projected row', () => {
  it('is the playbook or the org its prefix names, and names that prefix again', () => {
    const addresses = ['playbook/acme/alpha/', 'org/acme/', 'org/acme/alpha/', 'playbook/acme/'].map((prefix) =>
      addressOfStreamPrefix(prefix),
    );

    expect(addresses).toEqual([
      Option.some({ org: 'acme', playbook: 'alpha' }),
      Option.some({ org: 'acme' }),
      Option.none(),
      Option.none(),
    ]);
    expect([streamPrefixOfAddress({ org: 'acme', playbook: 'alpha' }), streamPrefixOfAddress({ org: 'acme' })]).toEqual(
      ['playbook/acme/alpha/', 'org/acme/'],
    );
  });
});

describe('the key of the row a fact changes', () => {
  const opened = {
    id: 'message-1',
    position: 1,
    type: 'topic_opened',
    data: { topic: 'spring', at: 0 },
    context: { at: '2026-10-05T09:00:00.000Z', by: 'topics' },
  };

  it('is the stream’s id by default, what the mapping says otherwise, and none for a kind it does not fold', () => {
    expect([
      rowKeyOf(runTallyRows, opened, alphaRuns),
      rowKeyOf(topicRows, opened, alphaRuns),
      rowKeyOf(topicRows, opened, { ...alphaRuns, kind: 'others' }),
    ]).toEqual(['r1', 'spring', undefined]);
  });

  it('is none for a stream of a scope the projection does not fold, a playbook’s streams alone when it names none', () => {
    expect([
      rowKeyOf(runTallyRows, opened, { ...alphaRuns, scope: 'org', prefix: 'org/acme/', address: { org: 'acme' } }),
      rowKeyOf(remarkRows, opened, acmeRemarks),
      rowKeyOf({ ...remarkRows, scopes: ['playbook'] }, opened, acmeRemarks),
    ]).toEqual([undefined, 'r1', undefined]);
  });
});

describe('the columns a reader advances', () => {
  it('are those a projection declares, each set by the fold only for the types it names for that column', () => {
    const noteOpens = {
      ...topicRows,
      advanced: [
        { column: 'open', setBy: ['topic_opened', 'topic_noted'] },
        { column: 'next_at', setBy: ['topic_opened'] },
      ],
    };

    expect([advancedColumnsOf(runTallyRows), advancedColumnsOf(topicRows)]).toEqual([
      [],
      ['open', 'next_at', 'due_at'],
    ]);
    expect([
      advancedColumnsLeftBy(topicRows, 'topic_opened'),
      advancedColumnsLeftBy(topicRows, 'topic_noted'),
      advancedColumnsLeftBy(noteOpens, 'topic_noted'),
      advancedColumnsLeftBy(runTallyRows, 'run_began'),
    ]).toEqual([[], ['open', 'next_at', 'due_at'], ['next_at'], []]);
  });

  it('refuse a column the projection does not let its reader advance', () => {
    expect(() => {
      requireAdvancedColumns(topicRows, { open: false });
    }).not.toThrow();
    expect(() => {
      requireAdvancedColumns(runTallyRows, { open: false });
    }).toThrow('The projection run_tallies does not let its reader advance the column open');
  });
});
