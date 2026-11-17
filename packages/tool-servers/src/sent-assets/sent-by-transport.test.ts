import { Buffer } from 'node:buffer';

import { heldForATest, keptForATest } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { apiKey, apiTiming, keyed } from '../api-testing/api-calls.ts';
import { resultText } from '../bounds/tool-results.ts';
import type { CalledOnce } from '../one-call/called-once.ts';
import { patientTiming, type HeardRequest } from '../testing/index.ts';
import { describedAccess, reportingAccess } from '../testing/reporting-access.ts';
import { fakeApiKey, fakeStdioServerPath, serveFakeApi, serveFakeMcp, type FakeTool } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const page = keptForATest('019a5b12-0000-7000-8000-000000000021', 'text/plain', `Line “one”\n${'x'.repeat(200_000)}\n`);

const pageText = Buffer.from(page.content).toString('utf8');

function callOf(server: string, tool: string, input: Readonly<Record<string, unknown>>) {
  return {
    org: 'acme',
    playbook: 'alpha',
    reference: { server, tool },
    input,
    meta: { 'auto.on/run_id': 'run-1' },
  };
}

function echoedOf(called: CalledOnce): unknown {
  if (!('answer' in called)) {
    return called;
  }
  const echoed: unknown = JSON.parse(resultText(called.answer));
  return echoed;
}

function bodyOf(text: string): unknown {
  const body: unknown = JSON.parse(text);
  return body;
}

function lengthsOf(heard: readonly HeardRequest[]) {
  return heard
    .filter(({ method }) => method === 'POST')
    .map(({ contentLength, transferEncoding }) => ({ transferEncoding, length: Number(contentLength) }));
}

const save: FakeTool = {
  name: 'save',
  inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
  answer: () => ({ content: [{ type: 'text', text: 'saved' }] }),
};

describe('an asset sent over each kind of transport', () => {
  it('reaches an MCP server over HTTP through the platform’s own fetch, as a body streamed half-duplex', async () => {
    const fake = await serveFakeMcp({ bearer: fakeApiKey, tools: [save] });
    closing.push(fake.close);
    const { access } = reportingAccess(
      { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
      { environment: { GRAPH_API_KEY: fakeApiKey }, timing: patientTiming, assets: heldForATest([page]) },
    );
    closing.push(access.close);

    const called = await Effect.runPromise(access.callOnce(callOf('graph', 'save', { content: page.reference })));

    expect(called).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(fake.received()).toEqual([expect.objectContaining({ arguments: { content: pageText } })]);
    const lastSent = lengthsOf(fake.heard()).at(-1);
    expect([
      lastSent?.transferEncoding,
      Number(lastSent?.length) > Buffer.byteLength(JSON.stringify(pageText)),
    ]).toEqual([undefined, true]);
  });
});

describe('an asset sent to a program', () => {
  it('reaches an MCP server started as a program, written to its input a piece at a time, between whole messages', async () => {
    const { access } = reportingAccess(
      {
        local: {
          command: process.execPath,
          args: [fakeStdioServerPath()],
          env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
          org: 'acme',
        },
      },
      {
        environment: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] },
        timing: patientTiming,
        assets: heldForATest([page]),
      },
    );
    closing.push(access.close);

    const [first, second] = await Promise.all([
      Effect.runPromise(access.callOnce(callOf('local', 'echo', { content: page.reference, n: 1 }))),
      Effect.runPromise(access.callOnce(callOf('local', 'echo', { n: 2 }))),
    ]);

    expect([first, second].map((called) => echoedOf(called))).toEqual([{ content: pageText, n: 1 }, { n: 2 }]);
  });
});

describe('an asset sent to an HTTP API', () => {
  it('reaches it in the body of its request, of the length it is sent, and is refused anywhere else in the request', async () => {
    const fake = await serveFakeApi({ key: apiKey });
    closing.push(fake.close);
    const { access } = await describedAccess(
      { graph: { org: 'acme', ...keyed(fake) } },
      { environment: { GRAPH_API_KEY: apiKey }, timing: apiTiming, assets: heldForATest([page]) },
    );
    closing.push(access.close);

    const sent = await Effect.runPromise(access.callOnce(callOf('graph', 'echo', { body: { note: page.reference } })));
    const queried = await Effect.runPromise(access.callOnce(callOf('graph', 'search', { query: page.reference })));

    expect(sent).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(fake.seen().map(({ path, body }) => ({ path, body: bodyOf(body) }))).toEqual([
      { path: '/v1/echo', body: { note: pageText } },
    ]);
    expect(lengthsOf(fake.heard().filter(({ path }) => path === '/v1/echo'))).toEqual([
      { transferEncoding: undefined, length: Buffer.byteLength(JSON.stringify({ note: pageText })) },
    ]);
    expect(queried).toMatchObject({
      kind: 'answered',
      outcome: 'arguments_refused',
      detail:
        'The argument /query is an asset of text/plain, which a call sends only in the body of its request; give it in the body',
    });
  });
});
