import { Buffer } from 'node:buffer';

import { keptTextOf } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallStarted } from '../calls/call-facts.ts';
import { patientTiming, recordingCallJournal } from '../testing/index.ts';
import { closedAfter, echoCall, oneCallKey } from '../testing/one-calls.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { serveFakeMcp, type FakeTool } from '../testing/served-fakes.ts';

const mebibyte = 1_048_576;

const alpha = { org: 'acme', playbook: 'alpha' };

const save: FakeTool = {
  name: 'save',
  description: 'Saves a page.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  answer: () => ({ content: [{ type: 'text', text: 'saved' }] }),
};

function bodyOf(init: unknown): readonly string[] {
  const body: unknown = Reflect.get(new Object(init), 'body');
  return typeof body === 'string' && body.includes('"tools/call"') ? [body] : [];
}

async function postingAccess() {
  const fake = await serveFakeMcp({ bearer: oneCallKey, tools: [save], mostRequestBytes: 16 * mebibyte });
  closedAfter(fake.close);
  const posted: string[] = [];
  const postingFetch = (...[address, init]: readonly [unknown, unknown?]) => {
    posted.push(...bodyOf(init));
    return globalThis.fetch(String(address), Object.assign({}, init));
  };
  const { access, content } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: oneCallKey }, timing: patientTiming, fetch: postingFetch },
  );
  closedAfter(access.close);
  return { fake, access, content, posted: () => posted.join('') };
}

function pageTaking(mebibytes: number): Readonly<Record<string, string>> {
  const path = 'reference.md';
  const envelope = JSON.stringify({ path, content: '' }).length;
  return { path, content: 'x'.repeat(mebibytes * mebibyte - envelope) };
}

function startOf(facts: ReturnType<ReturnType<typeof recordingCallJournal>['facts']>): Partial<CallStarted> {
  return facts.flatMap((fact) => (fact.type === 'tool_call_started' ? [fact.data] : []))[0] ?? {};
}

describe.each([1, 4, 8])('a call of %i MiB of text', (mebibytes) => {
  it('reaches its tool whole, and the arguments it records are the very bytes it sent', async () => {
    const { fake, access, content, posted } = await postingAccess();
    const journal = recordingCallJournal();
    const input = pageTaking(mebibytes);

    const called = await Effect.runPromise(
      access.callOnce(
        { ...echoCall, reference: { server: 'graph', tool: 'save' }, input },
        { callId: 'call-1', journal },
      ),
    );
    const started = startOf(journal.facts());
    const kept = String(await keptTextOf(content, alpha, String(started.arguments_sha256)));

    expect(called).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(fake.received()).toMatchObject([{ tool: 'save', arguments: input }]);
    expect(started).toMatchObject({ arguments_bytes: mebibytes * mebibyte });
    expect(Buffer.byteLength(kept)).toBe(mebibytes * mebibyte);
    expect(posted().includes(`"arguments":${kept}`)).toBe(true);
  });
});
