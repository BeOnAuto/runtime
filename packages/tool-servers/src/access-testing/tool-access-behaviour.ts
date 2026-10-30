import { createHash } from 'node:crypto';

import { keptTextOf } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import { controlledSignals, recordingCallJournal, toolRun } from '../testing/tool-runs.ts';
import { behaviourKey, type ServedUnderTest, type ServerUnderTest } from './servers-under-test.ts';
import type { SourcedEntry, SourceUnderTest } from './sources-under-test.ts';

type Facts = ReturnType<ReturnType<typeof recordingCallJournal>['facts']>;

const alpha = { org: 'acme', playbook: 'alpha' };

const timing = { callMs: 20_000, openMs: 20_000, longestRetryWaitMs: 1000 };

const aNumber: unknown = expect.any(Number);

const aRequestId: unknown = expect.stringMatching(/^request-\d+$/u);

const theServerNamed: unknown = expect.stringContaining('graph');

const theDenial: unknown = expect.stringContaining('salary is denied');

const environment = { GRAPH_API_KEY: behaviourKey };

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

function carriedForms(secret: string): readonly string[] {
  return [
    secret,
    Buffer.from(secret).toString('base64'),
    new URLSearchParams([['', secret]]).toString().slice(1),
    encodeURIComponent(secret),
  ];
}

function writtenForms(forms: readonly string[]): readonly string[] {
  return forms.flatMap((form) => [
    form,
    JSON.stringify(form).slice(1, -1),
    JSON.stringify(JSON.stringify(form)).slice(2, -2),
  ]);
}

function sourced(fake: ServedUnderTest, entry: Readonly<Record<string, unknown>> = {}): SourcedEntry {
  const { type, credential } = fake;
  return { type, credential, entry: { ...fake.entry, ...entry }, bare: { ...fake.bare, ...entry } };
}

async function served(underTest: ServerUnderTest, requestIdHeader?: string): Promise<ServedUnderTest> {
  const fake = await underTest.serve(requestIdHeader);
  onTestFinished(fake.close);
  return fake;
}

function resultDigestOf(facts: Facts): string {
  return facts
    .flatMap((fact) => (fact.type === 'tool_call_answered' ? [String(fact.data.result_sha256)] : []))
    .join('');
}

function argumentsDigestOf(facts: Facts): string {
  return facts
    .flatMap((fact) => (fact.type === 'tool_call_started' ? [String(fact.data.arguments_sha256)] : []))
    .join('');
}

function digestFieldsOf(facts: Facts): readonly (readonly string[])[] {
  return facts.map(({ data }) => Object.keys(data).filter((key) => key.endsWith('_sha256')));
}

interface Calling {
  readonly fake: ServedUnderTest;
  readonly source: SourceUnderTest;
  readonly entry?: Readonly<Record<string, unknown>>;
}

async function calledThrough(
  { fake, source, entry = {} }: Calling,
  tool: string,
  input: Readonly<Record<string, unknown>>,
) {
  const { access, content } = await source.accessTo(sourced(fake, entry), { environment, timing });
  onTestFinished(access.close);
  const journal = recordingCallJournal();
  const tools = await Effect.runPromise(access.open(toolRun(journal), [{ server: 'graph', tool }]));
  onTestFinished(tools.close);
  const [offered] = tools.offered;
  const reply = await offered?.call({ callId: 'call-1', input }, controlledSignals());
  return { reply, facts: journal.facts(), kept: (sha256: string) => keptTextOf(content, alpha, sha256) };
}

function keptAndScrubbed(underTest: ServerUnderTest, source: SourceUnderTest): void {
  it('records the start and the answer of a call with their sizes and digests, and keeps both whole, scrubbed of its secrets', async () => {
    const fake = await served(underTest);
    const input = fake.echoed({ note: `the key is ${behaviourKey}` });
    const scrubbed = JSON.stringify(input).replace(JSON.stringify(behaviourKey).slice(1, -1), '[redacted]');
    const started = {
      call_id: 'call-1',
      server: 'graph',
      ...source.recorded,
      tool: 'echo',
      arguments_bytes: Buffer.byteLength(scrubbed),
    };

    const { facts, kept } = await calledThrough({ fake, source }, 'echo', input);

    expect(facts[0]).toEqual({
      number: 1,
      type: 'tool_call_started',
      data: { ...started, arguments_sha256: digest(scrubbed) },
    });
    expect(facts[1]).toMatchObject({
      type: 'tool_call_answered',
      data: { is_error: false, result_bytes: aNumber, duration_ms: aNumber, jsonrpc_id: fake.jsonrpcId },
    });
    expect(await kept(resultDigestOf(facts))).toContain('[redacted]');
    expect(await kept(resultDigestOf(facts))).not.toContain(JSON.stringify(behaviourKey).slice(1, -1));
    expect(await kept(digest(scrubbed))).toBe(scrubbed);
  });
}

function everyForm(underTest: ServerUnderTest, source: SourceUnderTest): void {
  it('keeps and answers nothing of its credential, in any form a call carries it', async () => {
    const fake = await served(underTest);
    const forms = carriedForms(behaviourKey);

    const { reply, facts, kept } = await calledThrough({ fake, source }, 'echo', fake.echoed({ forms }));
    const said = [String(reply?.text), String(await kept(resultDigestOf(facts)))];
    const recorded = String(await kept(argumentsDigestOf(facts)));

    expect(writtenForms(forms).filter((form) => [...said, recorded].join('').includes(form))).toEqual([]);
    expect([...said, recorded].every((text) => text.includes('[redacted]'))).toBe(true);
  });

  it('keeps nothing of its credential in the start of a call recorded before the call is made', async () => {
    const fake = await served(underTest);
    const { access, content } = await source.accessTo(sourced(fake), { environment, timing });
    onTestFinished(access.close);
    const call = { ...alpha, reference: { server: 'graph', tool: 'echo' }, input: { note: behaviourKey }, meta: {} };

    const { fields } = await Effect.runPromise(access.preparedCall(call));

    expect(await keptTextOf(content, alpha, String(fields.arguments_sha256))).toBe(
      JSON.stringify({ note: '[redacted]' }),
    );
    expect(fake.calls()).toBe(0);
  });
}

function sizesAlone(underTest: ServerUnderTest, source: SourceUnderTest): void {
  it('records the sizes alone of the calls of an entry that keeps no content', async () => {
    const fake = await served(underTest);

    const { facts } = await calledThrough({ fake, source, entry: { record_content: false } }, 'search', {
      query: 'acme',
    });

    expect(digestFieldsOf(facts)).toEqual([[], []]);
    expect(facts[0]).toMatchObject({ data: { tool: 'search', arguments_bytes: 16, read_only: true } });
  });
}

function requestIds(underTest: ServerUnderTest, source: SourceUnderTest): void {
  it("records the server's own id of the request in the header its entry names", async () => {
    const fake = await served(underTest, 'x-request-id');

    const { facts } = await calledThrough({ fake, source, entry: { request_id: 'x-request-id' } }, 'search', {
      query: 'acme',
    });

    expect(facts[1]).toMatchObject({ data: { server_request_id: aRequestId } });
  });
}

function denials(underTest: ServerUnderTest, source: SourceUnderTest): void {
  it('answers what the tool denied as a tool error, in its own words', async () => {
    const fake = await served(underTest);

    const { reply, facts } = await calledThrough({ fake, source }, 'denied', {});

    expect(reply).toMatchObject({ isError: true, outcome: 'tool_error', text: theDenial });
    expect(facts[1]).toMatchObject({ type: 'tool_call_answered', data: { is_error: true } });
  });
}

function serverFailures(underTest: ServerUnderTest, source: SourceUnderTest): void {
  it('fails a call its server answers with HTTP 500 as a server failure, naming the server to the model', async () => {
    const fake = await served(underTest);
    fake.failNextCall(500);

    const { reply, facts } = await calledThrough({ fake, source }, 'search', { query: 'acme' });

    expect(reply).toMatchObject({ isError: true, outcome: 'server_failure', text: theServerNamed });
    expect(facts[1]).toMatchObject({
      type: 'tool_call_failed',
      data: { because: 'server_failure', detail: 'The tool server answered HTTP 500', jsonrpc_id: fake.jsonrpcId },
    });
  });

  it('waits out a 429 whose Retry-After fits the longest wait, and answers', async () => {
    const fake = await served(underTest);
    fake.failNextCall(429, { 'retry-after': '0' });

    const { reply } = await calledThrough({ fake, source }, 'search', { query: 'acme' });

    expect(reply).toMatchObject({
      isError: false,
      outcome: 'result',
      text: fake.answeredText('Found 2 rows for acme.'),
    });
    expect(fake.calls()).toBe(2);
  });
}

function argumentBounds(underTest: ServerUnderTest, source: SourceUnderTest): void {
  it('refuses arguments larger than a call may send, sending and recording nothing', async () => {
    const fake = await served(underTest);
    const input = fake.echoed({ note: 'x'.repeat(toolBounds.argumentBytes) });

    const { reply, facts } = await calledThrough({ fake, source }, 'echo', input);

    expect(reply).toMatchObject({ isError: true, outcome: 'not_sent' });
    expect(facts).toEqual([]);
    expect(fake.calls()).toBe(0);
  });
}

export function toolAccessBehaviour(underTest: ServerUnderTest, source: SourceUnderTest): void {
  describe(`the tools of ${underTest.kind} of ${source.kind}, reached through the tool access`, () => {
    keptAndScrubbed(underTest, source);
    everyForm(underTest, source);
    sizesAlone(underTest, source);
    requestIds(underTest, source);
    denials(underTest, source);
    serverFailures(underTest, source);
    argumentBounds(underTest, source);
  });
}
