import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { StartingTriggerSchema } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import type { AccountFailure, AccountRefusal } from '../accounts/account-failure.ts';
import type { AccountFake } from './account-fake.ts';

export interface AccountServer {
  readonly origin: string;
  readonly garble: () => void;
  readonly close: () => Promise<void>;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const UsageSchema = Schema.Struct({
  actions: Schema.Number,
  through: Schema.NullOr(Schema.Array(Schema.String)),
  last: Schema.NullOr(Schema.String),
});

const usageIn = Schema.decodeUnknownOption(Schema.fromJsonString(UsageSchema));

const installationUsageIn = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ ...UsageSchema.fields, installation: Schema.String })),
);

const runIn = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      run: Schema.Struct({
        org: Schema.String,
        playbook: Schema.String,
        run_id: Schema.String,
        definition_type: Schema.String,
        definition_name: Schema.String,
        definition_version: Schema.Number,
        correlation_id: Schema.String,
        called_by: Schema.NullOr(Schema.String),
        trigger: Schema.NullOr(StartingTriggerSchema),
        started_by: Schema.String,
      }),
    }),
  ),
);

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

function refusedWith({ status, kind, detail }: AccountRefusal): Answer | 'dropped' {
  return kind === 'unreachable' ? 'dropped' : { status, body: { kind, detail } };
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
    return Option.match(runIn(text), {
      onNone: () => Promise.resolve(unread),
      onSome: ({ run }) => answered(ports.admit(key, run), (admission) => ({ admission })),
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

async function respond(
  fake: AccountFake,
  garbled: () => boolean,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const key = String(request.headers.authorization).replace(/^Bearer /u, '');
  const answer = await answerTo(fake, String(request.url), key, await bodyOf(request));
  if (answer === 'dropped') {
    response.destroy();
    return;
  }
  const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
  response.writeHead(answer.status, { 'content-type': 'application/json' }).end(garbled() ? 'garbled' : text);
}

export async function accountServerOver(fake: AccountFake): Promise<AccountServer> {
  const garbled = { now: false };
  const server = createServer((request, response) => {
    void respond(fake, () => garbled.now, request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = portOf(server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
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
