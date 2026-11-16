import { SQL } from '@event-driven-io/dumbo';
import { describe, expect, it } from 'vitest';

import { aConnectedClient, rowsOf, settled } from '../testing/clients.ts';

describe('the rows a client of node:sqlite answers', () => {
  it('are plain objects with the columns the statement declares, bytes as a Buffer, as the add-on’s were', async () => {
    const client = await aConnectedClient({});

    const [row] = await rowsOf(client, "SELECT x'00ff' AS bytes, 1 AS one, 1.5 AS half, 'a' AS text, NULL AS absent");

    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(row).toStrictEqual({ bytes: Buffer.from([0, 255]), one: 1, half: 1.5, text: 'a', absent: null });
  });

  it('hand empty bytes as an empty Buffer', async () => {
    const client = await aConnectedClient({});

    expect(await rowsOf(client, "SELECT x'' AS empty")).toStrictEqual([{ empty: Buffer.alloc(0) }]);
  });

  it('keep the last of two columns of one name, as the add-on’s did', async () => {
    const client = await aConnectedClient({});

    expect(await rowsOf(client, "SELECT 'first' AS note, 'last' AS note")).toEqual([{ note: 'last' }]);
  });

  it('refuse an integer beyond 2^53, which the add-on answered rounded and without a word', async () => {
    const client = await aConnectedClient({});

    expect(await settled(client.query(SQL`SELECT 9007199254740993 AS beyond`))).toMatchObject({
      status: 'rejected',
      reason: {
        errorCode: 500,
        message: 'Value is too large to be represented as a JavaScript number: 9007199254740993',
      },
    });
  });

  it('are counted for a query, and every query of a batch is answered in turn', async () => {
    const client = await aConnectedClient({});

    const answers = await client.batchQuery([SQL`SELECT 1 AS one UNION ALL SELECT 2`, SQL`SELECT 'a' AS note`]);

    expect(answers).toEqual([
      { rowCount: 2, rows: [{ one: 1 }, { one: 2 }] },
      { rowCount: 1, rows: [{ note: 'a' }] },
    ]);
  });
});
