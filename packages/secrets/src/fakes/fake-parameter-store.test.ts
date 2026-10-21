import { DeleteParameterCommand, GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { serveFakeParameterStore } from './fake-parameter-store.ts';

const fake = await serveFakeParameterStore({ region: 'eu-central-1', account: '444455556666' });

afterAll(fake.close);

const clientSettings = {
  endpoint: fake.url,
  region: 'eu-central-1',
  credentials: { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' },
  maxAttempts: 1,
};

const client = new SSMClient(clientSettings);

const clientGivingUpAt200Ms = new SSMClient({
  ...clientSettings,
  requestHandler: { requestTimeout: 200, throwOnRequestTimeout: true },
});

interface Written {
  readonly Name: string;
  readonly Value: string;
  readonly Overwrite?: boolean;
  readonly Tier?: 'Standard' | 'Advanced';
}

function written(input: Written) {
  return client.send(new PutParameterCommand({ Type: 'SecureString', ...input }));
}

function read(name: string) {
  return client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
}

function deleted(name: string) {
  return client.send(new DeleteParameterCommand({ Name: name }));
}

async function refusalOf(asking: () => Promise<unknown>): Promise<string> {
  try {
    await asking();
    return 'answered';
  } catch (failure) {
    return String(failure);
  }
}

async function answerTo(operation: string, body: string): Promise<unknown> {
  const answer = await fetch(fake.url, {
    method: 'POST',
    headers: { 'x-amz-target': `AmazonSSM.${operation}`, 'content-type': 'application/x-amz-json-1.1' },
    body,
  });
  return answer.json();
}

describe('the fake Parameter Store', () => {
  it('keeps the versions of a parameter, answers the latest or the one a selector names with decryption, and deletes every version', async () => {
    const answers = [
      await written({ Name: '/fake/one', Value: 'first' }),
      await written({ Name: '/fake/one', Value: 'second', Overwrite: true }),
    ];
    const latest = await read('/fake/one');
    const first = await read('/fake/one:1');
    const parameter = fake.parameter('/fake/one');
    await deleted('/fake/one');

    expect(
      answers.map((answer: { readonly Version?: number | undefined; readonly Tier?: string | undefined }) => [
        answer.Version,
        answer.Tier,
      ]),
    ).toEqual([
      [1, 'Standard'],
      [2, 'Standard'],
    ]);
    expect([latest.Parameter?.Value, latest.Parameter?.Version, first.Parameter?.Value]).toEqual([
      'second',
      2,
      'first',
    ]);
    expect(first.Parameter?.ARN).toBe('arn:aws:ssm:eu-central-1:444455556666:parameter/fake/one');
    expect(parameter).toEqual({ tier: 'Standard', versions: ['first', 'second'] });
    expect(fake.parameter('/fake/one')).toBeUndefined();
  });

  it('refuses a write over a parameter without overwriting, a version or a parameter it does not have, a delete of either and a read without decryption', async () => {
    await written({ Name: '/fake/two', Value: 'first' });

    const refusals = [
      await refusalOf(() => written({ Name: '/fake/two', Value: 'second' })),
      await refusalOf(() => read('/fake/two:2')),
      await refusalOf(() => read('/fake/none')),
      await refusalOf(() => client.send(new GetParameterCommand({ Name: '/fake/two' }))),
      await refusalOf(() => deleted('/fake/none')),
    ];

    expect(refusals).toEqual([
      'ParameterAlreadyExists: The parameter already exists',
      'ParameterVersionNotFound: Systems Manager could not find version 2 of /fake/two.',
      'ParameterNotFound: Parameter /fake/none not found.',
      'ValidationException: The fake Parameter Store answers a SecureString only with its decryption',
      'ParameterNotFound: Parameter /fake/none not found.',
    ]);
  });
});

const standardRefusal =
  'ValidationException: A parameter value in the standard tier holds at most 4096 bytes; write a larger one in the advanced tier';

describe('the tiers of the fake Parameter Store', () => {
  it('keeps a value of more than 4 KB in the advanced tier alone, any value to 8 KB, and an advanced parameter in its tier', async () => {
    const refusals = [
      await refusalOf(() => written({ Name: '/fake/large', Value: 'x'.repeat(4097) })),
      await refusalOf(() => written({ Name: '/fake/large', Value: 'x'.repeat(4097), Tier: 'Standard' })),
      await refusalOf(() => written({ Name: '/fake/large', Value: 'x'.repeat(8193), Tier: 'Advanced' })),
      await refusalOf(() => written({ Name: '/fake/large', Value: 'x'.repeat(8192), Tier: 'Advanced' })),
      await refusalOf(() => written({ Name: '/fake/large', Value: 'small', Overwrite: true })),
      await refusalOf(() => written({ Name: '/fake/large', Value: 'small', Overwrite: true, Tier: 'Standard' })),
    ];

    expect(refusals).toEqual([
      standardRefusal,
      standardRefusal,
      'ValidationException: A parameter value holds at most 8192 bytes in any tier',
      'answered',
      'answered',
      'ValidationException: An advanced parameter cannot be changed to a standard parameter',
    ]);
    expect(fake.parameter('/fake/large')).toEqual({ tier: 'Advanced', versions: ['x'.repeat(8192), 'small'] });
  });
});

describe('the fake Parameter Store told how to answer', () => {
  it('denies or faults on the operations it is told, throttles the next writes, and forgets a parameter it is told is gone', async () => {
    await written({ Name: '/fake/three', Value: 'first' });
    fake.tell('denied', ['GetParameter']);
    const denied = await refusalOf(() => read('/fake/three'));
    fake.tell('faulting');
    const faulted = await refusalOf(() => deleted('/fake/three'));
    fake.tell('answering');
    fake.throttle(2);
    const throttled = [
      await refusalOf(() => written({ Name: '/fake/three', Value: 'second', Overwrite: true })),
      await refusalOf(() => written({ Name: '/fake/three', Value: 'second', Overwrite: true })),
      await refusalOf(() => written({ Name: '/fake/three', Value: 'second', Overwrite: true })),
    ];
    fake.remove('/fake/three');

    expect(denied).toBe(
      'AccessDeniedException: User: arn:aws:iam::444455556666:user/runtime is not authorized to perform: ssm:GetParameter on resource: arn:aws:ssm:eu-central-1:444455556666:parameter/fake/three because no identity-based policy allows the ssm:GetParameter action',
    );
    expect(faulted).toBe('InternalServerError: An error occurred on the server side');
    expect(throttled).toEqual(['ThrottlingException: Rate exceeded', 'ThrottlingException: Rate exceeded', 'answered']);
    expect(fake.parameter('/fake/three')).toBeUndefined();
  });
});

describe('the fake Parameter Store told to stall', () => {
  it('leaves the operations it is told unanswered, so a client with a request timeout of 200 ms, the bound this test is about, gives up on them', async () => {
    await written({ Name: '/fake/stalled', Value: 'first' });
    fake.tell('stalling', ['PutParameter']);
    onTestFinished(() => {
      fake.tell('answering');
    });

    const stalled = await refusalOf(() =>
      clientGivingUpAt200Ms.send(
        new PutParameterCommand({ Type: 'SecureString', Name: '/fake/stalled', Value: 'second', Overwrite: true }),
      ),
    );

    expect(stalled).toMatch(/^TimeoutError/u);
    expect(fake.parameter('/fake/stalled')?.versions).toEqual(['first']);
  });
});

describe('the fake Parameter Store told to refuse', () => {
  it('refuses the next write with the error it is told, once, and a value that holds a reference in double braces', async () => {
    fake.refuse('ParameterLimitExceeded');

    const refusals = [
      await refusalOf(() => written({ Name: '/fake/six', Value: 'first' })),
      await refusalOf(() => written({ Name: '/fake/six', Value: 'first' })),
      await refusalOf(() => written({ Name: '/fake/seven', Value: 'a {{ssm:another}} value' })),
    ];

    expect(refusals).toEqual([
      'ParameterLimitExceeded: The fake Parameter Store is told to answer ParameterLimitExceeded',
      'answered',
      'ValidationException: A parameter value may not hold a reference in double braces',
    ]);
    expect(fake.parameter('/fake/seven')).toBeUndefined();
  });
});

describe('the fake Parameter Store told how many parameters it keeps', () => {
  it('refuses a new parameter once it keeps that many, and still writes a new version of one it keeps', async () => {
    await written({ Name: '/fake/kept', Value: 'first' });
    fake.keepAtMost(0);
    onTestFinished(() => {
      fake.keepAtMost(Number.POSITIVE_INFINITY);
    });

    const answers = [
      await refusalOf(() => written({ Name: '/fake/past', Value: 'first' })),
      await refusalOf(() => written({ Name: '/fake/kept', Value: 'second', Overwrite: true })),
    ];

    expect(answers).toEqual(['ParameterLimitExceeded: The fake Parameter Store keeps no more parameters', 'answered']);
    expect(fake.parameter('/fake/past')).toBeUndefined();
    expect(fake.parameter('/fake/kept')?.versions).toEqual(['first', 'second']);
  });
});

describe('the calls the fake Parameter Store records', () => {
  it('are each call with its name, the tier it asked, the version written or read, its answer and the retry mode its client names, never a value', async () => {
    const before = fake.calls().length;
    await written({ Name: '/fake/four', Value: 'pasted-key', Tier: 'Advanced' });
    await read('/fake/four:1');
    await deleted('/fake/four');

    expect(fake.calls().slice(before)).toEqual([
      {
        operation: 'PutParameter',
        name: '/fake/four',
        tier: 'Advanced',
        version: 1,
        answer: 'answered',
        retryMode: 'standard',
      },
      { operation: 'GetParameter', name: '/fake/four', version: 1, answer: 'answered', retryMode: 'standard' },
      { operation: 'DeleteParameter', name: '/fake/four', answer: 'answered', retryMode: 'standard' },
    ]);
    expect(JSON.stringify(fake.calls())).not.toContain('pasted-key');
  });
});

describe('the calls the fake Parameter Store records from a client of its own', () => {
  it('name no retry mode for a client that names none', async () => {
    const before = fake.calls().length;

    await answerTo('DeleteParameter', '{"Name":"/fake/eight"}');

    expect(fake.calls().slice(before)).toEqual([
      { operation: 'DeleteParameter', name: '/fake/eight', answer: 'ParameterNotFound', retryMode: undefined },
    ]);
  });

  it('leave out an operation it does not answer and a request it cannot read', async () => {
    const before = fake.calls().length;

    const answers = [
      await answerTo('GetParametersByPath', '{"Path":"/fake"}'),
      await answerTo('PutParameter', '{"Name":"/fake/five"}'),
      await answerTo('GetParameter', 'not json'),
      await answerTo('DeleteParameter', '{}'),
    ];

    const unread = {
      __type: 'SerializationException',
      message: 'The request is not one the fake Parameter Store reads',
    };
    expect(answers).toEqual([
      {
        __type: 'UnknownOperationException',
        message: 'The fake Parameter Store does not answer AmazonSSM.GetParametersByPath',
      },
      unread,
      unread,
      unread,
    ]);
    expect(fake.calls().slice(before)).toEqual([]);
  });
});
