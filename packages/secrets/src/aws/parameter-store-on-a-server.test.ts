import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  DeleteParameterCommand,
  DescribeParametersCommand,
  GetParameterCommand,
  SSMClient,
  SSMServiceException,
} from '@aws-sdk/client-ssm';
import { Effect, Redacted, Schema } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import type { Keeper } from '../keepers/keeper.ts';
import type { Holding } from '../rows/secret-rows.ts';
import { keeperBehaviour } from '../testing/keeper-behaviour.ts';
import { inMemoryEntry } from '../testing/secrets-entry.ts';
import { parameterStoreKeeper } from './parameter-store-keeper.ts';

const server = process.env['SECRETS_TEST_AWS_URL'] ?? '';

const skipped = server === '';

const notice = skipped
  ? ', skipped: set SECRETS_TEST_AWS_URL to the URL of a server that answers the AWS APIs of KMS and Parameter Store, with its credentials, such as http://access:secret@127.0.0.1:19760, to run it'
  : '';

const region = 'us-east-1';

const proxy = { enabled: false, environment: {} };

interface ServerParameters {
  readonly origin: string;
  readonly credentials: { readonly accessKeyId: string; readonly secretAccessKey: string };
  readonly client: () => SSMClient;
}

function serverParametersOf(url: string): ServerParameters {
  const { origin, username, password } = new URL(url);
  const credentials = { accessKeyId: decodeURIComponent(username), secretAccessKey: decodeURIComponent(password) };
  const client = new SSMClient({ endpoint: origin, region, credentials });
  return { origin, credentials, client: () => client };
}

function aPrefix(): string {
  return `/secrets-tests/${crypto.randomUUID()}`;
}

function keeperOn({ origin, credentials }: ServerParameters, prefix: string, endpoint = origin): Keeper {
  return parameterStoreKeeper({ prefix, region, proxy, credentials, endpoint });
}

function nameOf(holding: Holding): string {
  return holding.held.slice(0, holding.held.lastIndexOf(':'));
}

async function valueOn({ client }: ServerParameters, holding: Holding): Promise<string | undefined> {
  try {
    const { Parameter } = await client().send(new GetParameterCommand({ Name: holding.held, WithDecryption: true }));
    return Parameter?.Value;
  } catch (failure) {
    if (failure instanceof SSMServiceException && failure.name === 'ParameterNotFound') {
      return undefined;
    }
    throw failure;
  }
}

async function tierOn({ client }: ServerParameters, name: string): Promise<string | undefined> {
  const { Parameters = [] } = await client().send(
    new DescribeParametersCommand({ ParameterFilters: [{ Key: 'Name', Option: 'Equals', Values: [name] }] }),
  );
  return Parameters[0]?.Tier;
}

function onTheServer() {
  const prefix = aPrefix();
  return {
    aKeeper: () => Promise.resolve(keeperOn(serverParametersOf(server), prefix)),
    valueIn: (holding: Holding) => valueOn(serverParametersOf(server), holding),
    lose: async (holding: Holding) => {
      await serverParametersOf(server)
        .client()
        .send(new DeleteParameterCommand({ Name: nameOf(holding) }));
    },
  };
}

function held(keeper: Keeper, id: string, value: string): Promise<Holding> {
  return Effect.runPromise(keeper.hold(id, Redacted.make(value)));
}

async function revealedBy(keeper: Keeper, holding: Holding): Promise<string | undefined> {
  const value = await Effect.runPromise(keeper.reveal(holding));
  return value === undefined ? undefined : Redacted.value(value);
}

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function bodyOf(request: IncomingMessage): Promise<string> {
  request.setEncoding('utf8');
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
  }
  return text;
}

interface Door {
  readonly origin: string;
  readonly throttledNow: () => boolean;
}

async function passedOn(door: Door, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await bodyOf(request);
  if (request.headers['x-amz-target'] === 'AmazonSSM.PutParameter' && door.throttledNow()) {
    response
      .writeHead(400, { 'content-type': 'application/x-amz-json-1.1' })
      .end(JSON.stringify({ __type: 'ThrottlingException', message: 'Rate exceeded' }));
    return;
  }
  const headers = Object.entries(request.headers).flatMap(
    ([name, value]: readonly [string, string | readonly string[] | undefined]): [string, string][] =>
      value === undefined || name === 'host' || name === 'content-length' ? [] : [[name, String(value)]],
  );
  const answer = await fetch(`${door.origin}${request.url ?? '/'}`, { method: 'POST', headers, body });
  response
    .writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/x-amz-json-1.1' })
    .end(Buffer.from(await answer.arrayBuffer()));
}

async function aThrottlingDoorTo(origin: string, writes: number): Promise<string> {
  const throttled = { writes };
  const door: Door = {
    origin,
    throttledNow: () => {
      const now = throttled.writes > 0;
      throttled.writes = Math.max(0, throttled.writes - 1);
      return now;
    },
  };
  const listening = createServer();
  listening.on('request', (request: IncomingMessage, response: ServerResponse) => {
    void passedOn(door, request, response);
  });
  listening.listen(0, '127.0.0.1');
  await once(listening, 'listening');
  onTestFinished(async () => {
    const closed = once(listening, 'close');
    listening.close();
    listening.closeAllConnections();
    await closed;
  });
  return `http://127.0.0.1:${String(decodeAddress(listening.address()).port)}`;
}

describe.skipIf(skipped)(
  `The secret store over values kept in a server that answers the Parameter Store API${notice}`,
  { timeout: 120_000 },
  () => {
    const warned = vi.spyOn(console, 'warn');

    keeperBehaviour(inMemoryEntry(), onTheServer());

    it('names the advanced tier for a value of more than 4 KB alone, which the parameter keeps for a smaller value', async () => {
      const parameters = serverParametersOf(server);
      const prefix = aPrefix();
      const keeper = keeperOn(parameters, prefix);

      await held(keeper, 'at-4-kb', 'x'.repeat(4096));
      await held(keeper, 'one-byte-over', 'x'.repeat(4097));
      const smaller = await held(keeper, 'one-byte-over', 'renewed-key');

      expect([
        await tierOn(parameters, `${prefix}/at-4-kb`),
        await tierOn(parameters, `${prefix}/one-byte-over`),
      ]).toEqual(['Standard', 'Advanced']);
      expect(await valueOn(parameters, smaller)).toBe('renewed-key');
    });

    it('reads a version the server keeps after a later write, and a parameter deleted on the server as a value gone for good', async () => {
      const parameters = serverParametersOf(server);
      const keeper = keeperOn(parameters, aPrefix());
      const first = await held(keeper, 'secret-1', 'first-tokens');
      const second = await held(keeper, 'secret-1', 'second-tokens');

      const earlier = await revealedBy(keeper, first);
      await parameters.client().send(new DeleteParameterCommand({ Name: nameOf(second) }));
      const gone = await revealedBy(keeper, second);

      expect(earlier).toBe('first-tokens');
      expect(gone).toBeUndefined();
    });

    it('writes a value once the retry of the SDK waited out a write throttled on its way to the server', async () => {
      const parameters = serverParametersOf(server);
      const prefix = aPrefix();
      const keeper = keeperOn(parameters, prefix, await aThrottlingDoorTo(parameters.origin, 1));

      const holding = await held(keeper, 'secret-1', 'pasted-key');

      expect(holding.held).toBe(`${prefix}/secret-1:1`);
      expect(await valueOn(parameters, holding)).toBe('pasted-key');
    });

    it('writes nothing to console.warn from the SDK while it writes, reads and deletes', () => {
      expect(warned).not.toHaveBeenCalled();
    });
  },
);
