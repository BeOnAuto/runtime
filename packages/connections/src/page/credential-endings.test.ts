import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, billing, crm } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const ShownSchema = Schema.Struct({
  credential: Schema.Record(Schema.String, Schema.String),
  credential_ends_with: Schema.NullOr(Schema.String),
});

const decodeRead = Schema.decodeUnknownSync(Schema.Struct({ output: ShownSchema }));

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ connections: Schema.Array(ShownSchema) }) }),
);

function endingOf(outcome: unknown): string | null {
  return decodeRead(outcome).output.credential_ends_with;
}

async function given(h: Harness, input: Readonly<Record<string, string>>): Promise<string | null> {
  return endingOf(await h.call(operationNamed(h.operations, 'give_credential'), ada, input));
}

async function endingsShown(h: Harness, id: string): Promise<readonly (string | null)[]> {
  const listed = decodeListed(
    await h.call(operationNamed(h.operations, 'list_connections'), ada, { include_removed: true }),
  );
  const read = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
  return [...listed.output.connections.map(({ credential_ends_with: endsWith }) => endsWith), endingOf(read)];
}

describe('the ending of a credential given', () => {
  it('is the last four characters of a secret of twelve, kept beside it, shown beside the credential and never in it', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(await given(h, { id, token, value: 'crm-key-1234' })).toBe('1234');
    expect(await endingsShown(h, id)).toEqual(['1234', '1234']);
    expect(h.secrets.endings()).toEqual(new Map([['secret-1', '1234']]));
    expect(
      decodeRead(await h.call(operationNamed(h.operations, 'get_connection'), ada, { id })).output.credential,
    ).toEqual(crm.credential);
    expect(JSON.stringify(await h.facts())).not.toContain('1234');
  });

  it('is not kept of a secret of eleven', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(await given(h, { id, token, value: 'crm-key-123' })).toBeNull();
    expect(await endingsShown(h, id)).toEqual([null, null]);
    expect(h.secrets.endings().size).toBe(0);
  });

  it('is kept of a client secret, and never of a private key', async () => {
    const h = harness();
    const secret = await added(h, billing);
    const key = await added(h, { ...billing, name: 'billing-key' });

    const endings = [
      await given(h, { id: secret.id, token: secret.token, client_secret: 'billing-client-secret' }),
      await given(h, {
        id: key.id,
        token: key.token,
        private_key: '-----BEGIN PRIVATE KEY-----MC4CAQAwBQYDK2VwBCIEIA',
        algorithm: 'EdDSA',
      }),
    ];

    expect(endings).toEqual(['cret', null]);
  });
});

describe('the ending of the credential of a connection removed', () => {
  it('is forgotten with the value', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);
    await given(h, { id, token, value: 'crm-key-1234' });

    const removed = await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(endingOf(removed)).toBeNull();
    expect(await endingsShown(h, id)).toEqual([null, null]);
    expect(h.secrets.endings().size).toBe(0);
  });
});
