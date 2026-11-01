import { memoryLedger } from '@on.auto/operations/testing';
import { secretStoreOn } from '@on.auto/secrets';
import { memoryKeeper, memoryRows } from '@on.auto/secrets/testing';
import { DateTime, Effect, Logger, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { contentAddressKeyKeptBy, retryStateKeysKeptBy, secretsKeptBy } from './own-keys.ts';

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

const inTheManager = secretsKeptBy({
  secrets: undefined,
  keepers: {
    current: {
      kind: 'aws-parameter-store',
      setting: 'SECRETS_KEEPER',
      prefix: '/auto-runtime/secrets',
      region: 'eu-north-1',
      regionSetting: 'AWS_DEFAULT_REGION',
    },
    previous: undefined,
  },
});

function inTheManagerAlone() {
  const rows = memoryRows({ now });
  const keeper = memoryKeeper('aws-parameter-store');
  return {
    rows,
    keeper,
    services: { registry: memoryLedger().service, secrets: secretStoreOn(rows, { current: keeper }) },
  };
}

async function loggedWhile<A, E>(effect: Effect.Effect<A, E>): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([capture]))));
  return lines;
}

describe('the key that signs the state of a retry, kept in a secret manager', () => {
  it('is logged at each start with where it is kept and the id of its secret, which names its parameter, and never its value', async () => {
    const { rows, services } = inTheManagerAlone();

    const lines = await loggedWhile(retryStateKeysKeptBy(services, inTheManager));
    const [row] = rows.kept();

    expect(lines).toEqual([
      expect.stringContaining(
        `"message":"The runtime read the key it keeps for retry_state in AWS Parameter Store under /auto-runtime/secrets in eu-north-1","level":"INFO"`,
      ),
    ]);
    expect(lines[0]).toContain(`"annotations":{"own_key":"retry_state","own_key_id":"${String(row?.id)}"}`);
  });

  it('stops the start, once its parameter is gone, in words that say where it was looked for and which variable named the region', async () => {
    const { rows, keeper, services } = inTheManagerAlone();
    await Effect.runPromise(retryStateKeysKeptBy(services, inTheManager));
    const [row] = rows.kept();
    keeper.lose({ keptBy: String(row?.kept_by), held: String(row?.held) });

    const gone = await Effect.runPromise(Effect.map(Effect.flip(retryStateKeysKeptBy(services, inTheManager)), String));

    expect(gone).toBe(
      'OwnKeyUnavailable: The key the runtime keeps for retry_state is no longer in AWS Parameter Store under /auto-runtime/secrets in eu-north-1, the region AWS_DEFAULT_REGION names, so the server does not start',
    );
  });
});

function bytesOf(key: Redacted.Redacted<Uint8Array>): readonly number[] {
  return Array.from(Redacted.value(key));
}

describe('the key that signs the addresses of content, kept in a secret manager', () => {
  it('is 32 bytes of its own beside the key of a retry, the same at the next start, and logged under its own purpose with the id of its secret', async () => {
    const { rows, services } = inTheManagerAlone();

    const retries = await Effect.runPromise(retryStateKeysKeptBy(services, inTheManager));
    const first = await Effect.runPromise(contentAddressKeyKeptBy(services, inTheManager));
    const lines = await loggedWhile(contentAddressKeyKeptBy(services, inTheManager));
    const next = await Effect.runPromise(contentAddressKeyKeptBy(services, inTheManager));
    const [, row] = rows.kept();

    expect([bytesOf(first).length, bytesOf(next)]).toEqual([32, bytesOf(first)]);
    expect(bytesOf(first)).not.toEqual(bytesOf(retries.current));
    expect(rows.kept()).toHaveLength(2);
    expect(lines).toEqual([
      expect.stringContaining(
        `"message":"The runtime read the key it keeps for content_address in AWS Parameter Store under /auto-runtime/secrets in eu-north-1","level":"INFO"`,
      ),
    ]);
    expect(lines[0]).toContain(`"annotations":{"own_key":"content_address","own_key_id":"${String(row?.id)}"}`);
  });
});
