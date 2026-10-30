import { describe, expect, it } from 'vitest';

import { postgresqlRecordedStore, type Query } from './postgresql-recorded.ts';

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

const alpha = 'playbook/acme/alpha/';

const at = '2026-10-05T09:00:00.000Z';

const context = { at, by: 'tester' };

const storedRow = {
  transaction: '11',
  position: '21',
  stream: `${alpha}runs/r1`,
  version: 1,
  type: 'run_started',
  recorded: at,
  id: 'message-21',
  metadata: { ...context, causationId: null, correlationId: 'r1' },
  correlation: 'r1',
  size: 0,
  data: { json: JSON.stringify({ input: {} }) },
};

describe('one record read by its message id on PostgreSQL', () => {
  it('reads the record through the index on the message id, within the playbook, with its data and its context', async () => {
    const { query, asked } = answering([storedRow]);

    const record = await postgresqlRecordedStore(query).readRecordedEvent(alpha, 'message-21');

    expect(record).toMatchObject({
      id: 'message-21',
      point: ['11', '21'],
      stream: `${alpha}runs/r1`,
      type: 'run_started',
      data: { input: {} },
      metadata: { context },
    });
    expect(asked[0]?.text).toContain('WHERE message_id = $1');
    expect(asked[0]?.values).toEqual(['message-21', 'emt:default', alpha]);
  });

  it('reads nothing for an id the playbook does not hold', async () => {
    const { query } = answering([]);

    await expect(postgresqlRecordedStore(query).readRecordedEvent(alpha, 'message-99')).resolves.toBeUndefined();
  });
});
