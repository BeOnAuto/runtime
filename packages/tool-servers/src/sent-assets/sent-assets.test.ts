import { Buffer } from 'node:buffer';

import { keptTextOf } from '@on.auto/content/testing';
import { heldForATest, keptForATest, type KeptForATest } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallStarted } from '../calls/call-facts.ts';
import { patientTiming, recordingCallJournal } from '../testing/index.ts';
import { closedAfter, echoCall, oneCallKey } from '../testing/one-calls.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { serveFakeMcp, type FakeTool } from '../testing/served-fakes.ts';

const mebibyte = 1_048_576;

const alpha = { org: 'acme', playbook: 'alpha' };

function answeredWithItsArguments(name: string, properties: FakeTool['inputSchema']['properties']): FakeTool {
  return {
    name,
    inputSchema: { type: 'object', properties, required: [] },
    answer: () => ({ content: [{ type: 'text', text: 'done' }] }),
  };
}

const tools: readonly FakeTool[] = [
  answeredWithItsArguments('save', { path: { type: 'string' }, content: { type: 'string' } }),
  answeredWithItsArguments('upload', { name: { type: 'string' }, file: { type: 'string', contentEncoding: 'base64' } }),
  answeredWithItsArguments('rows', { rows: { type: 'array' } }),
];

const page = keptForATest(
  '019a5b12-0000-7000-8000-000000000001',
  'text/markdown',
  `# Café “menu”\n${'é'.repeat(70_000)}\t"done"\n`,
);

const report = keptForATest(
  '019a5b12-0000-7000-8000-000000000002',
  'application/pdf',
  Uint8Array.from({ length: 200_001 }, (_, at) => at % 251),
);

const table = keptForATest(
  '019a5b12-0000-7000-8000-000000000003',
  'application/json',
  JSON.stringify([
    { shop: 'north', waste: 3 },
    { shop: 'south', waste: 0 },
  ]),
);

const elsewhere = keptForATest('019a5b12-0000-7000-8000-000000000004', 'text/plain', 'not this playbook’s', {
  org: 'acme',
  playbook: 'beta',
});

function bodyOf(init: unknown): Promise<string | undefined> | string | undefined {
  const { body }: RequestInit = Object.assign({}, init);
  if (typeof body === 'string') {
    return body.includes('"tools/call"') ? body : undefined;
  }
  return body instanceof ReadableStream ? new Response(body).text() : undefined;
}

function paramsOf(body: string): unknown {
  const sent: unknown = JSON.parse(body);
  return Reflect.get(new Object(sent), 'params');
}

async function sendingAccess(kept: readonly KeptForATest[], mostRequestBytes?: number) {
  const fake = await serveFakeMcp({ bearer: oneCallKey, tools, mostRequestBytes: 16 * mebibyte });
  closedAfter(fake.close);
  const holding = heldForATest(kept);
  const posted: string[] = [];
  const postingFetch = async (...[address, init]: readonly [unknown, unknown?]) => {
    const asked: RequestInit = Object.assign({}, init);
    const body = await bodyOf(init);
    if (body !== undefined) {
      posted.push(body);
    }
    return globalThis.fetch(String(address), body === undefined ? asked : { ...asked, body });
  };
  const { access, content } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    {
      environment: { GRAPH_API_KEY: oneCallKey },
      timing: patientTiming,
      fetch: postingFetch,
      assets: holding,
      ...(mostRequestBytes === undefined ? {} : { mostRequestBytes }),
    },
  );
  closedAfter(access.close);
  return { fake, access, content, holding, posted: () => [...posted] };
}

const pageText = Buffer.from(page.content).toString('utf8');

const sentToSave = Buffer.byteLength(JSON.stringify({ path: 'a.md', content: pageText }));

function startOf(facts: ReturnType<ReturnType<typeof recordingCallJournal>['facts']>): Partial<CallStarted> {
  return facts.flatMap((fact) => (fact.type === 'tool_call_started' ? [fact.data] : []))[0] ?? {};
}

function calling(tool: string, input: Readonly<Record<string, unknown>>) {
  return { ...echoCall, reference: { server: 'graph', tool }, input };
}

describe('an asset a function passes whole to a tool', () => {
  it('reaches a string as its text, written into the request a piece at a time, and is recorded as the asset', async () => {
    const { fake, access, content, posted } = await sendingAccess([page]);
    const journal = recordingCallJournal();
    const input = { path: 'menu.md', content: page.reference };

    const called = await Effect.runPromise(access.callOnce(calling('save', input), { callId: 'call-1', journal }));
    const started = startOf(journal.facts());
    const kept = String(await keptTextOf(content, alpha, String(started.arguments_sha256)));

    expect(called).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(fake.received()).toEqual([
      expect.objectContaining({
        tool: 'save',
        arguments: { path: 'menu.md', content: Buffer.from(page.content).toString('utf8') },
      }),
    ]);
    expect(JSON.parse(kept)).toEqual(input);
    expect(started.arguments_bytes).toBe(Buffer.byteLength(JSON.stringify(input)));
    expect(journal.facts().map(({ type }) => type)).toEqual(['tool_call_started', 'tool_call_answered']);
    expect(posted()[0]).toContain(JSON.stringify(Buffer.from(page.content).toString('utf8')));
  });

  it('reaches a place whose schema says contentEncoding: base64 as the base64 of its bytes, whatever it holds', async () => {
    const { fake, access } = await sendingAccess([report, page]);

    const called = await Effect.runPromise(
      access.callOnce(calling('upload', { name: 'report.pdf', file: report.reference })),
    );
    await Effect.runPromise(access.callOnce(calling('upload', { name: 'menu.md', file: page.reference })));

    expect(called).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(fake.received().map(({ arguments: given }) => given)).toEqual([
      { name: 'report.pdf', file: Buffer.from(report.content).toString('base64') },
      { name: 'menu.md', file: Buffer.from(page.content).toString('base64') },
    ]);
  });
});

describe('an asset that holds JSON', () => {
  it('reaches a place that takes a list or an object as the JSON value it holds', async () => {
    const { fake, access } = await sendingAccess([table]);

    await Effect.runPromise(access.callOnce(calling('rows', { rows: table.reference })));

    expect(fake.received().map(({ arguments: given }) => given)).toEqual([
      {
        rows: [
          { shop: 'north', waste: 3 },
          { shop: 'south', waste: 0 },
        ],
      },
    ]);
  });
});

describe('an asset sent again', () => {
  it('is sent again, the same bytes, when the server asks for the call again, and is recorded as one call', async () => {
    const { fake, access, holding, posted } = await sendingAccess([page]);
    const journal = recordingCallJournal();
    fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '0' });

    const called = await Effect.runPromise(
      access.callOnce(
        { ...calling('save', { path: 'menu.md', content: page.reference }), longestRetryWaitMs: 1000 },
        { callId: 'call-1', journal },
      ),
    );
    const [first, second] = posted().map((body) => paramsOf(body));

    expect(called).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect([posted().length, second, holding.opened()]).toEqual([2, first, 3]);
    expect(first).toMatchObject({ arguments: { content: Buffer.from(page.content).toString('utf8') } });
    expect(journal.facts().map(({ type }) => type)).toEqual(['tool_call_started', 'tool_call_answered']);
  });
});

describe('an asset a tool cannot be sent', () => {
  it('is refused before anything is recorded or sent: a file where the tool takes text', async () => {
    const { fake, access } = await sendingAccess([report]);
    const journal = recordingCallJournal();

    const called = await Effect.runPromise(
      access.callOnce(calling('save', { path: 'r.pdf', content: report.reference }), { callId: 'call-1', journal }),
    );

    expect(called).toEqual({
      kind: 'unopened',
      refused: 'asset_not_sent',
      because: 'asset_not_taken',
      pointer: '/content',
      detail:
        'The argument /content is a file of application/pdf, and the save tool of graph takes text there; a tool takes a file where its schema says format: byte or contentEncoding: base64; send it to a tool that takes one',
    });
    expect([fake.received(), journal.facts()]).toEqual([[], []]);
  });

  it('is refused where another playbook holds it, where it expired, and where the arguments are an asset whole', async () => {
    const { fake, access } = await sendingAccess([elsewhere, { ...page, expired: true }]);

    const refused = await Promise.all([
      Effect.runPromise(access.callOnce(calling('save', { path: 'a.md', content: elsewhere.reference }))),
      Effect.runPromise(access.callOnce(calling('save', { path: 'a.md', content: page.reference }))),
      Effect.runPromise(access.callOnce(calling('save', page.reference))),
    ]);

    expect(refused).toEqual([
      expect.objectContaining({
        because: 'asset_unusable',
        detail: `The argument /content names an asset that cannot be sent: No asset of this playbook has the id ${elsewhere.reference.id}; give an asset this playbook keeps, as the run that made it answered it`,
      }),
      expect.objectContaining({
        because: 'asset_unusable',
        detail: `The argument /content names an asset that cannot be sent: The asset ${page.reference.id} has expired; run again what made it, for a fresh copy`,
      }),
      expect.objectContaining({ because: 'asset_not_taken', pointer: '' }),
    ]);
    expect(fake.received()).toEqual([]);
  });
});

describe('an asset that would make a call too large', () => {
  it('is refused where what the call would send is more than a call may send, counting the asset’s text', async () => {
    const { fake, access } = await sendingAccess([page], 100_000);

    const called = await Effect.runPromise(access.callOnce(calling('save', { path: 'a.md', content: page.reference })));

    expect(called).toEqual({
      kind: 'unopened',
      refused: 'asset_not_sent',
      because: 'too_large',
      pointer: '',
      detail: `The arguments of this call take ${sentToSave} bytes with the assets they send, more than the 97.7 KiB a call may send to a tool server; send less in one call, in parts where the tool takes them.`,
    });
    expect(fake.received()).toEqual([]);
  });

  it('says, where the server answers that the request is too large, how many bytes its arguments sent with the asset', async () => {
    const { fake, access } = await sendingAccess([page]);
    fake.answerNextOf('tools/call', 413);

    const called = await Effect.runPromise(access.callOnce(calling('save', { path: 'a.md', content: page.reference })));

    expect(called).toMatchObject({
      kind: 'answered',
      outcome: 'arguments_refused',
      detail: `The tool server answered HTTP 413: the request, with arguments of ${sentToSave} bytes as JSON with the assets they send, was larger than the server takes; send less in one call, in parts where the tool takes them`,
    });
  });
});
