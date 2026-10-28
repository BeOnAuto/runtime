import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';

import { dailyRows, steadyVisits, uploadedDailyVisits } from '@on.auto/prediction/testing';
import { Schema } from 'effect';
import { expect } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';
import { uploaded, type Answer } from './dataset-uploads.ts';

export interface Read {
  readonly status: number;
  readonly type: string | null;
  readonly text: string;
}

const StartedSchema = Schema.Struct({ run_id: Schema.String });

export const visits = dailyRows('visits', ['north', 'south'], 40, steadyVisits);

export function candidateFile(name: string): Readonly<Uint8Array> {
  return readFileSync(new URL(`../../../../packages/prediction-onnx/candidates/${name}.onnx`, import.meta.url));
}

export function digestOf(bytes: Readonly<Uint8Array>): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildRoute(build: string, part: string): string {
  return `${alpha}/runs/${build}/build/${part}`;
}

export async function savedVisits(server: ReasoningServer, name = 'daily-visits'): Promise<void> {
  expect(await uploaded(server.origin, visits.text)).toMatchObject({ status: 200 });
  const created = await server.call('POST', `${alpha}/definitions/prediction`, {
    body: { name, source: uploadedDailyVisits(visits.sha256) },
  });
  expect(created.status).toBe(201);
}

export async function askedBuild(server: ReasoningServer, name = 'daily-visits'): Promise<string> {
  const asked = await server.call('POST', `${alpha}/definitions/prediction/${name}/run`, {
    body: { input: { build: {} } },
  });
  expect(asked.status).toBe(200);
  return Schema.decodeUnknownSync(StartedSchema)(asked.body).run_id;
}

export async function readOf(server: ReasoningServer, path: string): Promise<Read> {
  const response = await fetch(`${server.origin}${path}`);
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
}

export async function sentCandidate(
  server: ReasoningServer,
  build: string,
  bytes: Readonly<Uint8Array>,
  format?: string,
): Promise<Answer> {
  const query = format === undefined ? '' : `?format=${format}`;
  const response = await fetch(`${server.origin}${buildRoute(build, 'candidates')}${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
  });
  return { status: response.status, body: await response.json() };
}

export function refusedBeforeTheBody(
  server: ReasoningServer,
  build: string,
  headers: Readonly<Record<string, string>>,
): Promise<Answer> {
  return new Promise((resolve) => {
    const sent = request(
      `${server.origin}${buildRoute(build, 'candidates')}`,
      { method: 'POST', headers },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (piece: string) => {
          text += piece;
        });
        response.on('end', () => {
          sent.destroy();
          resolve({ status: Number(response.statusCode), body: JSON.parse(text) });
        });
      },
    );
    sent.flushHeaders();
  });
}

export function endedRun(server: ReasoningServer, build: string): Promise<unknown> {
  return until(async () => {
    const { body } = await server.call('GET', `${alpha}/runs/${build}`);
    expect(body).not.toMatchObject({ status: 'started' });
    return body;
  });
}

export function standingWhen(server: ReasoningServer, name: string, standing: object): Promise<unknown> {
  return until(async () => {
    const { body } = await server.call('GET', `${alpha}/definitions/prediction/${name}`);
    expect(body).toMatchObject({ standing });
    return body;
  });
}

export async function builtFrom(server: ReasoningServer, candidate: string): Promise<string> {
  await savedVisits(server);
  const build = await askedBuild(server);
  const bytes = candidateFile(candidate);
  expect(await sentCandidate(server, build, bytes)).toMatchObject({ status: 200 });
  const answered = await server.call('POST', `${alpha}/runs/${build}/answer`, {
    body: { answer: { candidates: [digestOf(bytes)] } },
  });
  expect(answered.status).toBe(200);
  return build;
}
