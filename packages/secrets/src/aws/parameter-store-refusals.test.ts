import { Effect, Redacted } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import type { FakeParameterOperation } from '../fakes/fake-parameter-answers.ts';
import { serveFakeParameterStore } from '../fakes/fake-parameter-store.ts';
import { keeperProbed } from '../keepers/keeper-probe.ts';
import type { Keeper } from '../keepers/keeper.ts';
import type { Holding } from '../rows/secret-rows.ts';
import { parameterStoreKeeper } from './parameter-store-keeper.ts';

const account = '111122223333';

const fake = await serveFakeParameterStore({ region: 'eu-west-1', account });

afterAll(fake.close);

const credentials = { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' };

function aPrefix(): string {
  return `/auto-runtime/secrets-${crypto.randomUUID()}`;
}

function keeperOn(prefix: string): Keeper {
  return parameterStoreKeeper({
    prefix,
    region: 'eu-west-1',
    proxy: { enabled: false, environment: {} },
    credentials,
    endpoint: fake.url,
  });
}

function held(keeper: Keeper, id: string, value: string): Promise<Holding> {
  return Effect.runPromise(keeper.hold(id, Redacted.make(value)));
}

function failureOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

const refusedValues: readonly (readonly [string, string])[] = [
  ['ParameterLimitExceeded', 'over_the_keepers_quota'],
  ['PoliciesLimitExceededException', 'refused_by_the_keeper'],
  ['ParameterMaxVersionLimitExceeded', 'refused_by_the_keeper'],
  ['ValidationException', 'refused_by_the_keeper'],
];

describe('the keeper of values in a Parameter Store that refuses a value', () => {
  it.each(refusedValues)(
    'refuses a value the service answers %s for, which no retry mends, as a secret refused, %s, in the words of the service',
    async (type, because) => {
      const prefix = aPrefix();
      fake.refuse(type);

      const refused = await failureOf(keeperOn(prefix).hold('secret-1', Redacted.make('pasted-key')));

      expect(refused).toMatchObject({
        _tag: 'secret_refused',
        because,
        detail: `AWS Parameter Store refused to keep the parameter ${prefix}/secret-1: ${type}: The fake Parameter Store is told to answer ${type}`,
      });
      expect(fake.parameter(`${prefix}/secret-1`)).toBeUndefined();
    },
  );

  it('refuses a value that holds a reference in double braces, as the service does', async () => {
    const prefix = aPrefix();

    const refused = await failureOf(keeperOn(prefix).hold('secret-1', Redacted.make('{{ssm:another-parameter}}')));

    expect(refused).toMatchObject({
      _tag: 'secret_refused',
      detail: `AWS Parameter Store refused to keep the parameter ${prefix}/secret-1: ValidationException: A parameter value may not hold a reference in double braces`,
    });
    expect(JSON.stringify(refused)).not.toContain('another-parameter');
  });

  it('stops the probe at a parameter the service refuses, in words that lead with the parameter of the probe, not with its value', async () => {
    const prefix = aPrefix();
    fake.refuse('ValidationException');

    const refused = await failureOf(keeperProbed(keeperOn(prefix)));

    expect(refused).toMatchObject({ _tag: 'secret_refused', because: 'refused_by_the_keeper' });
    expect(refused.detail).toMatch(
      new RegExp(
        `^AWS Parameter Store refused to keep the parameter ${prefix}/probe-[\\da-f-]{36}: ValidationException: The fake Parameter Store is told to answer ValidationException$`,
        'u',
      ),
    );
  });
});

type Act = 'write' | 'read' | 'delete';

const denials: readonly (readonly [Act, FakeParameterOperation, string])[] = [
  ['write', 'PutParameter', ''],
  ['read', 'GetParameter', ':1'],
  ['delete', 'DeleteParameter', ''],
];

describe('the keeper of values in a Parameter Store that denies its identity', () => {
  it.each(denials)(
    'cannot %s a parameter now, the %s it asks denied, in the words of the service without the account or a credential',
    async (act, operation, version) => {
      const prefix = aPrefix();
      const keeper = keeperOn(prefix);
      const holding = await held(keeper, 'secret-1', 'pasted-key');
      fake.tell('denied', [operation]);
      const asked: Readonly<Record<Act, () => Effect.Effect<void, { readonly detail: string }>>> = {
        write: () => Effect.asVoid(keeper.hold('secret-1', Redacted.make('pasted-key'))),
        read: () => Effect.asVoid(keeper.reveal(holding)),
        delete: () => keeper.release(holding),
      };

      const denied = await failureOf(asked[act]());
      fake.tell('answering');

      expect(denied).toMatchObject({
        _tag: 'keeper_unavailable',
        detail: `AWS Parameter Store could not ${act} the parameter ${prefix}/secret-1${version}: AccessDeniedException: User: user/runtime is not authorized to perform: ssm:${operation} on resource: parameter${prefix}/secret-1 because no identity-based policy allows the ssm:${operation} action`,
      });
      expect(JSON.stringify(denied)).not.toMatch(
        new RegExp(`${account}|${credentials.secretAccessKey}|pasted-key`, 'u'),
      );
    },
  );
});
