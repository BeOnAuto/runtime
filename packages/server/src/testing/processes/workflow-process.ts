import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { tcpPort } from '../../lifecycle/http-server.ts';
import { runIdIn, isStarted, workflowSource } from '../servers/workflow-server.ts';
import { until } from '../waiting/until.ts';
import { spawnServer, type SpawnedServer } from './spawned-server.ts';

export interface LogLine {
  readonly message: string;
  readonly level: string;
  readonly annotations: Readonly<Record<string, unknown>>;
}

export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const mainModule = fileURLToPath(new URL('../../main.ts', import.meta.url));

const decodeLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.String,
      level: Schema.String,
      annotations: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
);

export function workflowProcess(ledgerFile: string, environment: Readonly<Record<string, string>> = {}): SpawnedServer {
  return spawnServer(mainModule, {
    HOME: homedir(),
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledgerFile,
    ...environment,
  });
}

export function logLinesOf(child: SpawnedServer): readonly LogLine[] {
  return child
    .output()
    .stderr.split('\n')
    .filter((line) => line !== '')
    .map((line) => decodeLine(line));
}

export async function requestTo(port: number, method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/orgs/acme/playbooks${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

export async function settledOver(port: number, path: string): Promise<unknown> {
  const { body } = await until(
    () => requestTo(port, 'GET', path),
    (answer) => !isStarted(answer.body),
  );
  return body;
}

const welcome = ['---', 'model: stub/writer', '---', 'Welcome {{ input.name }}.'].join('\n');

const welcoming = workflowSource(
  'welcoming',
  "do:\n  - welcome: { call: run_definition, with: { type: reasoning, name: welcome, input: { name: '${ $data.name }' } } }\n",
);

export interface StubGateway {
  readonly gateways: string;
  readonly requests: () => number;
  readonly firstHeard: Promise<void>;
}

function answered(response: ServerResponse): void {
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      created: 1_790_000_000,
      model: 'stub',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Welcome, Ada.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    }),
  );
}

export async function gatewayThatHangsFirst(): Promise<StubGateway> {
  const heard = Promise.withResolvers<void>();
  const counted = { requests: 0 };
  const server = createServer((request, response) => {
    counted.requests += 1;
    request.resume();
    if (counted.requests === 1) {
      heard.resolve();
      return;
    }
    answered(response);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    gateways: JSON.stringify([{ name: 'stub', base_url: `http://127.0.0.1:${tcpPort(server.address())}/v1` }]),
    requests: () => counted.requests,
    firstHeard: heard.promise,
  };
}

export async function welcomingStarted(port: number, playbook: string): Promise<string> {
  await requestTo(port, 'POST', '', { playbook, name: 'Welcoming' });
  await requestTo(port, 'POST', `/${playbook}/definitions/reasoning`, { name: 'welcome', source: welcome });
  await requestTo(port, 'POST', `/${playbook}/definitions/workflow`, { name: 'welcoming', source: welcoming });
  const started = await requestTo(port, 'POST', `/${playbook}/definitions/workflow/welcoming/run`, {
    input: { name: 'Ada' },
  });
  return runIdIn(started.body);
}
