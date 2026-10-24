import { Buffer } from 'node:buffer';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { noCalls } from '../bounds/call-bounds.ts';
import { ignored } from '../clients/ignored.ts';
import {
  controlledSignals,
  fakeRequestIdKey,
  patientTiming,
  recordingCallJournal,
  reportingAccess,
  toolRun,
} from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';
import { callReplyOf, failureCounted } from './call-replies.ts';

const aDuration: unknown = expect.any(Number);

const answeredWith61Bytes: unknown = expect.objectContaining({ result_bytes: 61 });

const givenId = '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function opened(meta: Readonly<Record<string, string>>, ...tools: readonly string[]) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = {
    url: fake.url,
    headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
    org: 'acme',
    request_id: fakeRequestIdKey,
  };
  const { access, messages } = reportingAccess(
    { graph },
    { environment: { GRAPH_API_KEY: fakeApiKey }, timing: patientTiming },
  );
  closing.push(access.close);
  const journal = recordingCallJournal();
  const references = tools.map((tool) => ({ server: 'graph', tool }));
  const run = await Effect.runPromise(access.open(toolRun(journal, { id: givenId, meta }), references));
  closing.push(run.close);
  const call = (index: number, input: Readonly<Record<string, unknown>>) =>
    run.offered[index]?.call({ callId: givenId, input }, controlledSignals());
  return { call, journal, messages };
}

describe('what a call answers beside what the model sees', () => {
  it('is the outcome, the size of the whole result, how long it took and the id the server gave it, as recorded', async () => {
    const { call, journal } = await opened({ 'auto.on/run_id': givenId }, 'search', 'denied');

    const replies = [await call(0, { query: 'acme' }), await call(1, {})];

    expect(replies).toEqual([
      {
        text: 'Found 2 rows for acme.',
        isError: false,
        outcome: 'result',
        resultBytes: Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: 'Found 2 rows for acme.' }] })),
        durationMs: aDuration,
        serverRequestId: 'call-1',
        scrubbedResult: { content: [{ type: 'text', text: 'Found 2 rows for acme.' }] },
      },
      expect.objectContaining({ isError: true, outcome: 'tool_error', serverRequestId: 'call-2' }),
    ]);
    expect(journal.facts()).toContainEqual(
      expect.objectContaining({ type: 'tool_call_answered', data: answeredWith61Bytes }),
    );
  });

  it('is a server failure with no result when the server fails the call', async () => {
    const { call } = await opened({ 'auto.on/run_id': givenId }, 'broken');

    expect(await call(0, {})).toMatchObject({
      isError: true,
      outcome: 'server_failure',
      resultBytes: null,
      serverRequestId: null,
    });
  });
});

describe('a failed call reported to the operator', () => {
  it('names the run whose call it was, or the call made by hand, by the id its opener gave', async () => {
    const ofARun = await opened({ 'auto.on/run_id': givenId }, 'broken');
    const byHand = await opened({ 'auto.on/call_id': givenId }, 'broken');

    await ofARun.call(0, {});
    await byHand.call(0, {});

    expect([...ofARun.messages(), ...byHand.messages()]).toMatchObject([
      { server: 'graph', run_id: givenId, call_id: null },
      { server: 'graph', run_id: null, call_id: givenId },
    ]);
  });
});

describe('an answer past the cap of the transport', () => {
  it('is no failure of the server, which answered, so it ends none of the calls of a run', () => {
    const tooLarge = {
      outcome: 'too_large',
      result: null,
      resultJson: null,
      message: 'The tool server answered more than the 16777216 bytes one call may take',
      failure: 'too_large',
      jsonrpcId: 4,
      serverRequestId: null,
      retryAfterMs: null,
    } as const;
    const replying = { server: 'graph', meta: {}, scrub: (text: string) => text, report: ignored };

    expect(failureCounted(noCalls, tooLarge, replying)).toEqual({ tally: noCalls, value: undefined });
    expect(callReplyOf({ text: 'Too large.', isError: true }, tooLarge, 12)).toMatchObject({
      outcome: 'too_large',
      resultBytes: null,
    });
  });
});
