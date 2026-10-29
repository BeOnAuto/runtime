import { describe, expect, it } from 'vitest';

import type { Query } from '../postgresql-reads/recorded-parts.ts';
import { postgresqlAppended } from './postgresql-appended.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(...answers: readonly (readonly unknown[])[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text, values });
      return Promise.resolve(answers[asked.length - 1] ?? []);
    },
  };
}

function group(name: string, read: number, transaction: string, position: string) {
  return { horizon: '90', name, read, transaction, position };
}

const theHorizon = 'pg_snapshot_xip(pg_current_snapshot())';

describe('a read on PostgreSQL of the streams appended to after a point', () => {
  it('walks the table in transaction id then position behind the horizon, leaving out the writes it first found open in other databases, and goes on from the horizon after it read all', async () => {
    const { query, asked } = answering(
      [],
      [{ horizon: '50', name: null }],
      [{ id: '58' }],
      [group('playbook/acme/alpha/events/', 2, '60', '7'), group('org/acme/playbooks', 1, '61', '3')],
    );
    const { readAppended } = postgresqlAppended(query);

    const now = await readAppended(undefined, 100);
    const appended = await readAppended(now.through, 100);

    expect(now).toEqual({ streams: [], latest: new Map(), through: ['50', '0'], more: false });
    expect(appended).toEqual({
      streams: ['playbook/acme/alpha/events/', 'org/acme/playbooks'],
      latest: new Map([
        ['playbook/acme/alpha/events/', ['60', '7']],
        ['org/acme/playbooks', ['61', '3']],
      ]),
      through: ['90', '0'],
      more: false,
    });
    expect(asked[1]?.values).toEqual([[], '0', '0', 'emt:default', 0]);
    expect(asked[2]?.text).toContain('FROM pg_stat_activity');
    expect(asked[2]?.text).toContain('datname IS DISTINCT FROM current_database()');
    expect(asked[3]?.text).toContain('(transaction_id, global_position) > ($2::xid8, $3::bigint)');
    expect(asked[3]?.text).toContain('AND transaction_id < (SELECT below FROM horizon)');
    expect(asked[3]?.text).toContain('ORDER BY transaction_id, global_position');
    expect(asked[3]?.text).toContain(theHorizon);
    expect(asked[3]?.text).toContain('% 4294967296 <> ALL($1::bigint[])');
    expect(asked[3]?.values).toEqual([['58'], '50', '0', 'emt:default', 100]);
  });

  it('goes on after the last message it read when it read as many as it was asked', async () => {
    const { query } = answering(
      [],
      [group('playbook/acme/alpha/events/', 1, '60', '7'), group('playbook/acme/beta/events/', 2, '61', '3')],
      [],
      [group('playbook/acme/alpha/events/', 2, '61', '9'), group('playbook/acme/beta/events/', 1, '61', '4')],
    );
    const { readAppended } = postgresqlAppended(query);

    const across = await readAppended(['50', '0'], 3);
    const within = await readAppended(['50', '0'], 3);

    expect([across.through, across.more]).toEqual([['61', '3'], true]);
    expect([within.through, within.more]).toEqual([['61', '9'], true]);
  });
});
