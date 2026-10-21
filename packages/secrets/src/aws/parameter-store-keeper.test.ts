import { Effect, Redacted } from 'effect';
import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { aClosedPort } from '../fakes/closed-port.ts';
import { serveFakeParameterStore } from '../fakes/fake-parameter-store.ts';
import type { Keeper } from '../keepers/keeper.ts';
import type { Holding } from '../rows/secret-rows.ts';
import type { AwsWaits } from './aws-requests.ts';
import { parameterStoreKeeper } from './parameter-store-keeper.ts';

const account = '111122223333';

const fake = await serveFakeParameterStore({ region: 'eu-west-1', account });

afterAll(fake.close);

const credentials = { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' };

const noProxy = { enabled: false, environment: {} };

const waitsOf100Ms: AwsWaits = { connectionMs: 100, requestMs: 100 };

function aPrefix(): string {
  return `/auto-runtime/secrets-${crypto.randomUUID()}`;
}

function keeperOn(prefix: string, endpoint = fake.url, waits?: AwsWaits): Keeper {
  return parameterStoreKeeper({ prefix, region: 'eu-west-1', proxy: noProxy, credentials, endpoint, waits });
}

function held(keeper: Keeper, id: string, value: string): Promise<Holding> {
  return Effect.runPromise(keeper.hold(id, Redacted.make(value)));
}

async function revealed(keeper: Keeper, holding: Holding): Promise<string | undefined> {
  const value = await Effect.runPromise(keeper.reveal(holding));
  return value === undefined ? undefined : Redacted.value(value);
}

function failureOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

function callsSince(before: number) {
  return fake.calls().slice(before);
}

describe('the keeper of values in AWS Parameter Store', () => {
  it('is named aws-parameter-store, and is made without reaching anything, for the endpoint of its region', () => {
    const keeper = parameterStoreKeeper({ prefix: aPrefix(), region: 'eu-west-1', proxy: noProxy, credentials });

    expect(keeper.name).toBe('aws-parameter-store');
  });

  it('writes each value as it is, as a SecureString under the prefix and the id, overwriting, and answers the name and the version the write returned', async () => {
    const prefix = aPrefix();
    const keeper = keeperOn(prefix);
    const before = fake.calls().length;

    const first = await held(keeper, 'secret-1', 'pasted-key');
    const second = await held(keeper, 'secret-1', 'renewed-key');

    expect([first, second]).toEqual([
      { keptBy: 'aws-parameter-store', held: `${prefix}/secret-1:1` },
      { keptBy: 'aws-parameter-store', held: `${prefix}/secret-1:2` },
    ]);
    expect(fake.parameter(`${prefix}/secret-1`)).toEqual({ tier: 'Standard', versions: ['pasted-key', 'renewed-key'] });
    expect(callsSince(before)).toEqual([
      {
        operation: 'PutParameter',
        name: `${prefix}/secret-1`,
        tier: undefined,
        version: 1,
        answer: 'answered',
        retryMode: 'adaptive',
      },
      {
        operation: 'PutParameter',
        name: `${prefix}/secret-1`,
        tier: undefined,
        version: 2,
        answer: 'answered',
        retryMode: 'adaptive',
      },
    ]);
    expect(JSON.stringify(fake.calls())).not.toContain('pasted-key');
  });
});

describe('the tier of the parameters of the keeper of values in AWS Parameter Store', () => {
  it('names the advanced tier for a value of more than 4 KB of UTF-8 alone, and no tier up to 4 KB, which a parameter in the advanced tier keeps', async () => {
    const prefix = aPrefix();
    const keeper = keeperOn(prefix);
    const before = fake.calls().length;

    await held(keeper, 'at-4-kb', 'x'.repeat(4096));
    await held(keeper, 'one-byte-over', 'x'.repeat(4097));
    await held(keeper, 'at-4-kb-of-utf-8', 'é'.repeat(2048));
    await held(keeper, 'over-4-kb-of-utf-8', 'é'.repeat(2049));
    const smaller = await held(keeper, 'one-byte-over', 'renewed-key');

    expect(
      ['at-4-kb', 'one-byte-over', 'at-4-kb-of-utf-8', 'over-4-kb-of-utf-8'].map(
        (id) => fake.parameter(`${prefix}/${id}`)?.tier,
      ),
    ).toEqual(['Standard', 'Advanced', 'Standard', 'Advanced']);
    expect(callsSince(before).map(({ tier }) => tier)).toEqual([
      undefined,
      'Advanced',
      undefined,
      'Advanced',
      undefined,
    ]);
    expect(await revealed(keeper, smaller)).toBe('renewed-key');
  });
});

describe('the keeper of values in AWS Parameter Store, reading and deleting', () => {
  it('reads with decryption exactly the version a holding names, whatever a later write left as the latest', async () => {
    const prefix = aPrefix();
    const keeper = keeperOn(prefix);
    const first = await held(keeper, 'secret-1', 'first-tokens');
    await held(keeper, 'secret-1', 'second-tokens');
    const before = fake.calls().length;

    const read = await revealed(keeper, first);

    expect(read).toBe('first-tokens');
    expect(callsSince(before)).toEqual([
      { operation: 'GetParameter', name: `${prefix}/secret-1`, version: 1, answer: 'answered', retryMode: 'adaptive' },
    ]);
  });

  it('deletes the parameter a holding names, which takes every version of it, and deletes one gone already as nothing', async () => {
    const prefix = aPrefix();
    const keeper = keeperOn(prefix);
    const first = await held(keeper, 'secret-1', 'first-tokens');
    const second = await held(keeper, 'secret-1', 'second-tokens');
    const before = fake.calls().length;

    await Effect.runPromise(Effect.andThen(keeper.release(second), keeper.release(second)));

    expect([await revealed(keeper, first), await revealed(keeper, second)]).toEqual([undefined, undefined]);
    expect(fake.parameter(`${prefix}/secret-1`)).toBeUndefined();
    expect(callsSince(before).slice(0, 2)).toEqual([
      { operation: 'DeleteParameter', name: `${prefix}/secret-1`, answer: 'answered', retryMode: 'adaptive' },
      { operation: 'DeleteParameter', name: `${prefix}/secret-1`, answer: 'ParameterNotFound', retryMode: 'adaptive' },
    ]);
  });

  it('reads a parameter deleted meanwhile, or a version the parameter no longer has, as a value gone for good', async () => {
    const prefix = aPrefix();
    const keeper = keeperOn(prefix);
    const deleted = await held(keeper, 'secret-1', 'pasted-key');
    const kept = await held(keeper, 'secret-2', 'pasted-key');
    fake.remove(`${prefix}/secret-1`);

    const reads = [await revealed(keeper, deleted), await revealed(keeper, { ...kept, held: `${prefix}/secret-2:9` })];

    expect(reads).toEqual([undefined, undefined]);
  });
});

describe('the keeper of values in a Parameter Store that throttles it', { timeout: 30_000 }, () => {
  it('writes a value once the adaptive retry of the SDK, its rate limiter, waited out a throttled write', async () => {
    const prefix = aPrefix();
    const keeper = keeperOn(prefix);
    const before = fake.calls().length;
    fake.throttle();

    const holding = await held(keeper, 'secret-1', 'pasted-key');

    expect(holding.held).toBe(`${prefix}/secret-1:1`);
    expect(callsSince(before).map(({ answer, retryMode }) => `${answer} ${String(retryMode)}`)).toEqual([
      'ThrottlingException adaptive',
      'answered adaptive',
    ]);
  });

  it('retries in the mode AWS_RETRY_MODE names, which the SDK reads itself', async () => {
    vi.stubEnv('AWS_RETRY_MODE', 'standard');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const before = fake.calls().length;

    await held(keeperOn(aPrefix()), 'secret-1', 'pasted-key');

    expect(callsSince(before).map(({ retryMode }) => retryMode)).toEqual(['standard']);
  });

  it('does not write now a value whose writes stay throttled after the retries of the SDK, in the words of the service', async () => {
    const prefix = aPrefix();
    const keeper = keeperOn(prefix);
    fake.throttle(3);

    const throttled = await failureOf(keeper.hold('secret-1', Redacted.make('pasted-key')));

    expect(throttled).toMatchObject({
      _tag: 'keeper_unavailable',
      detail: `AWS Parameter Store could not write the parameter ${prefix}/secret-1: ThrottlingException: Rate exceeded`,
    });
    expect(fake.parameter(`${prefix}/secret-1`)).toBeUndefined();
  });
});

describe('the keeper of values in a Parameter Store that does not answer', () => {
  it('gives up within the waits of 100 ms its client is given, the bound this test is about, where the service stalls, as a keeper that does not answer', async () => {
    const prefix = aPrefix();
    const holding = await held(keeperOn(prefix), 'secret-1', 'pasted-key');
    const stalling = keeperOn(prefix, fake.url, waitsOf100Ms);
    fake.tell('stalling', ['GetParameter']);
    onTestFinished(() => {
      fake.tell('answering');
    });
    const started = performance.now();

    const stalled = await failureOf(stalling.reveal(holding));

    expect(stalled).toMatchObject({ _tag: 'keeper_unavailable' });
    expect(stalled.detail).toMatch(
      new RegExp(`^AWS Parameter Store could not read the parameter ${holding.held}: TimeoutError`, 'u'),
    );
    expect(performance.now() - started).toBeLessThan(20_000);
  });

  it('does not answer where the service faults or cannot be reached, as a keeper that does not answer, in the words of each', async () => {
    const prefix = aPrefix();
    const keeper = keeperOn(prefix);
    const holding = await held(keeper, 'secret-1', 'pasted-key');
    fake.tell('faulting', ['GetParameter']);
    onTestFinished(() => {
      fake.tell('answering');
    });

    const faulted = await failureOf(keeper.reveal(holding));
    const unreached = await failureOf(
      keeperOn(prefix, await aClosedPort()).hold('secret-2', Redacted.make('pasted-key')),
    );

    expect([faulted, unreached]).toMatchObject([{ _tag: 'keeper_unavailable' }, { _tag: 'keeper_unavailable' }]);
    expect(faulted.detail).toBe(
      `AWS Parameter Store could not read the parameter ${holding.held}: InternalServerError: An error occurred on the server side`,
    );
    expect(unreached.detail).toMatch(/could not write the parameter .*: .*ECONNREFUSED/u);
  });
});
