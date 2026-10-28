import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Effect, Option, Schema } from 'effect';

import type { AccountFailure, AccountRefusal } from '../accounts/account-failure.ts';
import type { AccountFake } from './account-fake.ts';

export interface Received {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface AccountServer {
  readonly origin: string;
  readonly received: () => readonly Received[];
  readonly garble: () => void;
  readonly close: () => Promise<void>;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const UsageSchema = Schema.Struct({ actions: Schema.Number, last: Schema.NullOr(Schema.String) });

const usageIn = Schema.decodeUnknownOption(Schema.fromJsonString(UsageSchema));

const installationUsageIn = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ ...UsageSchema.fields, installation: Schema.String })),
);

const admissionIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ action: Schema.String })));

const jsonIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const refreshIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ allocation: Schema.String })));

const allocationReportIn = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      report: Schema.Struct({
        allocation: Schema.String,
        installation: Schema.String,
        sequence: Schema.Number,
        spent: Schema.Number,
        at: Schema.String,
      }),
      signature: Schema.String,
    }),
  ),
);

interface Answer {
  readonly status: number;
  readonly body: object | undefined;
}

const unread: Answer = { status: 400, body: { kind: 'invalid_input', detail: 'The body could not be read' } };

async function bodyOf(request: IncomingMessage): Promise<string> {
  request.setEncoding('utf8');
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
  }
  return text;
}

function refusedWith({ status, kind, detail, because, resolve_at: resolveAt }: AccountRefusal): Answer | 'dropped' {
  const resolution = {
    ...(because === undefined ? {} : { because }),
    ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
  };
  return kind === 'unreachable' ? 'dropped' : { status, body: { kind, detail, ...resolution } };
}

function answered<A>(work: Effect.Effect<A, AccountFailure>, body: (answer: A) => object): Promise<Answer | 'dropped'> {
  return Effect.runPromise(
    work.pipe(
      Effect.map((answer): Answer | 'dropped' => ({ status: 200, body: body(answer) })),
      Effect.catch((failure: AccountRefusal) => Effect.succeed(refusedWith(failure))),
    ),
  );
}

function allocationAnswerTo(fake: AccountFake, path: string, key: string, text: string): Promise<Answer | 'dropped'> {
  const { ports } = fake;
  if (path === '/v1/installations/allocations/refresh') {
    return Option.match(refreshIn(text), {
      onNone: () => Promise.resolve(unread),
      onSome: ({ allocation }) =>
        answered(ports.refreshAllocation(key, allocation), (signed) => ({ allocation: signed })),
    });
  }
  if (path === '/v1/installations/allocations/report') {
    return Option.match(allocationReportIn(text), {
      onNone: () => Promise.resolve(unread),
      onSome: (report) => answered(ports.reportAllocation(key, report), (taken) => ({ taken })),
    });
  }
  return Promise.resolve({ status: 404, body: undefined });
}

function answerTo(fake: AccountFake, path: string, key: string, text: string): Promise<Answer | 'dropped'> {
  const { ports } = fake;
  if (path === '/v1/installations/activate') {
    return Option.match(installationUsageIn(text), {
      onNone: () => Promise.resolve(unread),
      onSome: (usage) => answered(ports.activate(key, usage), (activation) => activation),
    });
  }
  if (path === '/v1/installations/actions') {
    return Option.match(admissionIn(text), {
      onNone: () => Promise.resolve(unread),
      onSome: ({ action }) => answered(ports.admit(key, action), (admission) => ({ admission })),
    });
  }
  if (path === '/v1/installations/reports') {
    return Option.match(usageIn(text), {
      onNone: () => Promise.resolve(unread),
      onSome: (usage) => answered(ports.report(key, usage), () => ({ taken: true })),
    });
  }
  return allocationAnswerTo(fake, path, key, text);
}

interface Serving {
  readonly garbled: () => boolean;
  readonly took: (received: Received) => void;
}

async function respond(
  fake: AccountFake,
  serving: Serving,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const { authorization } = request.headers;
  const key = String(authorization).replace(/^Bearer /u, '');
  const path = String(request.url);
  const text = await bodyOf(request);
  serving.took({ path, authorization, body: Option.getOrUndefined(jsonIn(text)) });
  const answer = await answerTo(fake, path, key, text);
  if (answer === 'dropped') {
    response.destroy();
    return;
  }
  const written = answer.body === undefined ? '' : JSON.stringify(answer.body);
  response
    .writeHead(answer.status, { 'content-type': 'application/json' })
    .end(serving.garbled() ? 'garbled' : written);
}

export async function accountServerOver(fake: AccountFake): Promise<AccountServer> {
  const garbled = { now: false };
  const received: Received[] = [];
  const serving: Serving = {
    garbled: () => garbled.now,
    took: (taken) => {
      received.push(taken);
    },
  };
  const server = createServer((request, response) => {
    void respond(fake, serving, request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = portOf(server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    received: () => [...received],
    garble: () => {
      garbled.now = true;
    },
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
