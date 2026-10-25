import { afterEach, describe, expect, it } from 'vitest';

import type { Timing } from '../bounds/call-bounds.ts';
import { deniedText, patientTiming, playbookToolCalls, reportingAccess } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function executingWith(timing: Timing = patientTiming) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const { access, messages } = reportingAccess({ graph }, { timing, environment: { GRAPH_API_KEY: fakeApiKey } });
  closing.push(access.close);
  const { call } = playbookToolCalls(access);
  return { fake, messages, execute: (input: unknown) => call('execute', input) };
}

const aNumber: unknown = expect.any(Number);

const aCallId: unknown = expect.any(String);

const moreThanWasShown: unknown = expect.toSatisfy((bytes: number) => bytes > 81_920);

function filling(bytes: number) {
  return { query: 'x'.repeat(bytes - JSON.stringify({ query: '' }).length) };
}

const cutLarge: unknown = expect.stringMatching(
  /^(?:😀)+\n\[The answer was cut to 65,\d{3} of its 81,920 bytes, to fit what the model may still read; ask for fewer rows, fields or depth to see the rest\.\]$/u,
);

describe('a call whose tool does not answer as asked', () => {
  it('succeeds with a tool error when the tool answers one, as a run model sees it', async () => {
    const { execute } = await executingWith();

    expect(await execute({ server: 'graph', tool: 'denied' })).toMatchObject({
      status: 'succeeded',
      output: { outcome: 'tool_error', text: deniedText, result_bytes: aNumber },
    });
  });

  it('succeeds with a server failure when the server fails the call, telling the operator which call it was', async () => {
    const { execute, messages } = await executingWith();

    const called = await execute({ server: 'graph', tool: 'broken', arguments: { attempt: 1 } });

    expect(called).toMatchObject({
      status: 'succeeded',
      output: {
        outcome: 'server_failure',
        text: 'The tool server graph failed: The MCP server answered with an error: The broken tool broke on {"attempt":1}',
        result_bytes: null,
      },
    });
    expect(messages()).toMatchObject([{ server: 'graph', run_id: null, call_id: aCallId }]);
  });

  it('succeeds as timed out when the tool takes longer than a call may', async () => {
    const { execute } = await executingWith({ ...patientTiming, callMs: 200 });

    expect(await execute({ server: 'graph', tool: 'sleep', arguments: { ms: 5000 } })).toMatchObject({
      status: 'succeeded',
      output: {
        outcome: 'timed_out',
        text: 'The tool server graph failed: The tool server did not answer within 200 ms',
        result_bytes: null,
      },
    });
  });
});

describe('a call whose tool answers more than one call may take', () => {
  it('succeeds as too large, with no answer counted', { timeout: 120_000 }, async () => {
    const { execute } = await executingWith();

    expect(await execute({ server: 'graph', tool: 'large', arguments: { kib: 16_384 } })).toMatchObject({
      status: 'succeeded',
      output: {
        outcome: 'too_large',
        text: 'The tool server answered more than the 16,777,216 bytes one call over HTTP may take',
        result_bytes: null,
      },
    });
  });
});

describe('a call whose tool answers more than a reply shows', () => {
  it('cuts an answer over 64 KiB where it stays valid, leaves its document out, and counts the whole result', async () => {
    const { execute } = await executingWith();

    const called = await execute({ server: 'graph', tool: 'large', arguments: { kib: 80 } });

    expect(called).toMatchObject({
      status: 'succeeded',
      output: { outcome: 'result', text: cutLarge, result_bytes: moreThanWasShown },
    });
    expect(called).not.toHaveProperty('output.answer');
  });
});

describe('the arguments of a call', () => {
  it('may take 16 KiB as JSON, and one byte more is refused at /arguments before anything is opened', async () => {
    const { fake, execute } = await executingWith();

    const admitted = await execute({ server: 'graph', tool: 'search', arguments: filling(16_384) });
    const sessionsBefore = fake.seen().length;
    const refused = await execute({ server: 'graph', tool: 'search', arguments: filling(16_385) });

    expect(admitted).toMatchObject({ status: 'succeeded', output: { outcome: 'result' } });
    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/arguments',
          detail: 'The arguments take 16385 bytes as JSON, more than the 16384 a call may send',
        },
      ],
    });
    expect(fake.seen()).toHaveLength(sessionsBefore);
  });

  it('are an empty object when left out, and must be an object', async () => {
    const { fake, execute } = await executingWith();

    const leftOut = await execute({ server: 'graph', tool: 'profile' });
    const notAnObject = await execute({ server: 'graph', tool: 'profile', arguments: ['a'] });

    expect(leftOut).toMatchObject({ status: 'succeeded' });
    expect(notAnObject).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/arguments' }] });
    expect(fake.received()).toMatchObject([{ tool: 'profile', arguments: {} }]);
  });
});
