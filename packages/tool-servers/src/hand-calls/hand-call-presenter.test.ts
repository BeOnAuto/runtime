import { Buffer } from 'node:buffer';

import type { KeptContent, RecordedEvent } from '@on.auto/operations';
import { keptTextOf, nothingKept } from '@on.auto/operations/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeRequestIdKey, inTurn, patientTiming, playbookToolCalls, reportingAccess } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';
import { handCallPresenter } from './hand-call-presenter.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const givenUpAfterMs = 300;

const alpha = { org: 'acme', playbook: 'alpha' };

const digestFields = ['arguments_sha256', 'result_sha256'];

async function recordedCalls(entry: Readonly<Record<string, unknown>>, callMs: number, ...called: readonly unknown[]) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
  const { access, content } = reportingAccess(
    { graph },
    { timing: { ...patientTiming, callMs }, environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  const { call, recorded } = playbookToolCalls(access);
  await inTurn(called, (input) => call('execute', input));
  const records = await recorded();
  const digests = records
    .flatMap(({ data }) => digestFields.map((field): unknown => Reflect.get(new Object(data), field)))
    .filter((digest): digest is string => typeof digest === 'string');
  const texts = await Promise.all(digests.map((digest) => keptTextOf(content, alpha, digest)));
  const kept = new Map(digests.map((digest, index) => [digest, texts[index]]));
  return { records, content: (sha256: string) => kept.get(sha256) };
}

const answering = [
  { server: 'graph', tool: 'search', arguments: { query: 'acme' } },
  { server: 'graph', tool: 'denied' },
  { server: 'graph', tool: 'broken' },
];

const sleeping = { server: 'graph', tool: 'sleep', arguments: { ms: 5000 } };

function shown(records: readonly RecordedEvent[], content: KeptContent = nothingKept) {
  return records.flatMap((record) => handCallPresenter.present(record, content));
}

describe('the events of a call made by hand, as the playbook shows them', () => {
  it('say which tool of which server was called by hand and how it answered, in the words of a run’s calls', async () => {
    const answered = await recordedCalls({}, patientTiming.callMs, ...answering);
    const givenUp = await recordedCalls({}, givenUpAfterMs, sleeping);
    const records = [...answered.records, ...givenUp.records];

    expect(shown(records).map(({ type, summary }) => `${type}: ${summary}`)).toEqual([
      'tool_call_started: Someone allowed to change the playbook called the search tool of graph by hand.',
      'tool_call_answered: The tool answered.',
      'tool_call_started: Someone allowed to change the playbook called the denied tool of graph by hand.',
      'tool_call_answered: The tool answered with an error of its own.',
      'tool_call_started: Someone allowed to change the playbook called the broken tool of graph by hand.',
      'tool_call_failed: The tool failed at its server.',
      'tool_call_started: Someone allowed to change the playbook called the sleep tool of graph by hand.',
      'tool_call_failed: The tool took too long, so it was given up.',
    ]);
    expect(records.map(({ context }) => context.by)).toEqual(Array.from({ length: 8 }, () => 'acme-builder'));
  });

  it('show the arguments and the answer the call kept, and the server’s own id of the request', async () => {
    const { records, content } = await recordedCalls({ request_id: fakeRequestIdKey }, patientTiming.callMs, {
      server: 'graph',
      tool: 'echo',
      arguments: { said: 'hello' },
    });
    const [started, answered] = shown(records, content);

    expect(started?.data).toMatchObject({
      server: 'graph',
      tool: 'echo',
      arguments_bytes: Buffer.byteLength(JSON.stringify({ said: 'hello' })),
      arguments: { said: 'hello' },
    });
    expect(answered?.data).toMatchObject({
      is_error: false,
      server_request_id: 'call-1',
      result: { content: [{ type: 'text', text: '{"said":"hello"}' }] },
      answer: { said: 'hello' },
    });
  });
});

describe('an answer that carries no id of the server', () => {
  it('shows an id the playbook gave as text, cut to its bound, and no content it did not keep', () => {
    const [failed] = handCallPresenter.present(
      {
        id: '1f0e8d7c-6b5a-5d4c-8b3a-291817161514',
        causationId: null,
        correlationId: null,
        stream: 'tool-calls/0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
        version: 2,
        globalPosition: 4,
        type: 'tool_call_failed',
        data: {
          because: 'server_failure',
          duration_ms: 12,
          jsonrpc_id: `request-${'7'.repeat(300)}`,
          server_request_id: 'r'.repeat(300),
        },
        context: { at: '2026-10-08T09:00:00.000Z', by: 'acme-builder' },
        recordedAt: '2026-10-08T09:00:00.000Z',
      },
      nothingKept,
    );

    expect(failed?.data).toMatchObject({
      jsonrpc_id: `request-${'7'.repeat(120)}`,
      server_request_id: 'r'.repeat(256),
    });
  });
});
