import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Schema } from 'effect';

import {
  answerNamed,
  heardAs,
  type FakeParameter,
  type FakeParameterCall,
  type FakeParameterOperation,
  type FakeParameterState,
  type Kept,
} from './fake-parameter-answers.ts';

export interface FakeParameterStore {
  readonly url: string;
  readonly tell: (state: FakeParameterState, operations?: readonly FakeParameterOperation[]) => void;
  readonly throttle: (writes?: number) => void;
  readonly refuse: (type: string) => void;
  readonly keepAtMost: (parameters: number) => void;
  readonly remove: (name: string) => void;
  readonly parameter: (name: string) => FakeParameter | undefined;
  readonly calls: () => readonly FakeParameterCall[];
  readonly close: () => Promise<void>;
}

export interface FakeParameterStoreOptions {
  readonly region?: string;
  readonly account?: string;
}

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const everyOperation: readonly FakeParameterOperation[] = ['PutParameter', 'GetParameter', 'DeleteParameter'];

async function bodyOf(request: IncomingMessage): Promise<string> {
  request.setEncoding('utf8');
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
  }
  return text;
}

interface Serving {
  readonly kept: Kept;
  readonly noted: (call: FakeParameterCall) => void;
}

const retryModes: Readonly<Record<string, string>> = { E: 'standard', F: 'adaptive' };

function retryModeOf(userAgent: string | undefined): string | undefined {
  const [, features = ''] = /(?:^| )m\/(\S+)/u.exec(String(userAgent)) ?? [];
  return features
    .split(',')
    .map((feature) => retryModes[feature])
    .find((mode) => mode !== undefined);
}

async function respond(request: IncomingMessage, response: ServerResponse, { kept, noted }: Serving): Promise<void> {
  const { asked, answer } = heardAs(String(request.headers['x-amz-target']), await bodyOf(request), kept);
  if (asked !== undefined) {
    noted({ ...asked, answer: answerNamed(answer), retryMode: retryModeOf(request.headers['user-agent']) });
  }
  if (answer !== 'stalled') {
    response
      .writeHead(answer.status, { 'content-type': 'application/x-amz-json-1.1' })
      .end(JSON.stringify(answer.body));
  }
}

interface Store {
  readonly kept: Kept;
  readonly parameters: Map<string, FakeParameter>;
  readonly states: Map<FakeParameterOperation, FakeParameterState>;
  readonly failing: { type: string; writes: number };
  readonly quota: { parameters: number };
}

function aStore({ region = 'eu-west-1', account = '111122223333' }: FakeParameterStoreOptions): Store {
  const parameters = new Map<string, FakeParameter>();
  const states = new Map<FakeParameterOperation, FakeParameterState>();
  const failing = { type: 'ThrottlingException', writes: 0 };
  const quota = { parameters: Number.POSITIVE_INFINITY };
  const kept: Kept = {
    region,
    account,
    parameters,
    states,
    put: (name, parameter) => {
      parameters.set(name, parameter);
    },
    drop: (name) => parameters.delete(name),
    failedNow: () => {
      const now = failing.writes > 0 ? failing.type : undefined;
      failing.writes = Math.max(0, failing.writes - 1);
      return now;
    },
    isFull: () => parameters.size >= quota.parameters,
  };
  return { kept, parameters, states, failing, quota };
}

export async function serveFakeParameterStore(options: FakeParameterStoreOptions = {}): Promise<FakeParameterStore> {
  const { kept, parameters, states, failing, quota } = aStore(options);
  const calls: FakeParameterCall[] = [];
  const server = createServer();
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    void respond(request, response, {
      kept,
      noted: (call) => {
        calls.push(call);
      },
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${String(decodeAddress(server.address()).port)}`,
    tell: (state, operations = everyOperation) => {
      for (const operation of operations) {
        states.set(operation, state);
      }
    },
    throttle: (writes = 1) => {
      failing.type = 'ThrottlingException';
      failing.writes = writes;
    },
    refuse: (type) => {
      failing.type = type;
      failing.writes = 1;
    },
    keepAtMost: (most) => {
      quota.parameters = most;
    },
    remove: (name) => {
      parameters.delete(name);
    },
    parameter: (name) => parameters.get(name),
    calls: () => [...calls],
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
