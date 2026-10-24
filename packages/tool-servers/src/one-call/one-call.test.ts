import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { keptTextOf } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { brokenPromise, deniedText, patientTiming } from '../testing/index.ts';
import {
  calledOnce,
  echoCall,
  callingRunId,
  oneCallAccess,
  deliveryId,
  oneCallKey,
  oneCallServer,
  failedWith,
  unopenedWith,
  closedAfter,
} from '../testing/one-calls.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { fakeStdioServerPath } from '../testing/served-fakes.ts';

const largeText = '\u{1F600}'.repeat(8 * 256);

const largeAnswerBytes = Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: largeText }] }));

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const aNumber: unknown = expect.any(Number);

const scrubbed = JSON.stringify({ token: '[redacted]' });

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

const alpha = { org: 'acme', playbook: 'alpha' };

describe('one call of a tool', () => {
  it('lists the tools of its server, calls the tool with the metadata its caller gives, and answers the call whole', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);

    expect(await calledOnce(access)).toEqual({
      kind: 'answered',
      outcome: 'result',
      answered: {
        is_error: false,
        result_bytes: 95,
        result_sha256: aDigest,
        duration_ms: aNumber,
        jsonrpc_id: aNumber,
      },
      answer: { content: [{ type: 'text', text: JSON.stringify(echoCall.input) }] },
      detail: '',
      retryAfterMs: null,
      annotations: undefined,
    });
    expect((await Effect.runPromise(access.preparedCall(echoCall))).fields).toEqual({
      server: 'graph',
      tool: 'echo',
      arguments_bytes: 48,
      arguments_sha256: aDigest,
    });
    expect(fake.received()).toEqual([
      {
        tool: 'echo',
        arguments: echoCall.input,
        meta: { 'auto.on/run_id': callingRunId, 'auto.on/delivery_id': deliveryId },
      },
    ]);
  });

  it('lists the tools of its server before it calls one', async () => {
    const fake = await oneCallServer();
    await calledOnce(oneCallAccess(fake.url));
    const asked = fake.seen().map(({ rpc }) => rpc);

    expect(asked.indexOf('tools/list')).toBeGreaterThan(-1);
    expect(asked.indexOf('tools/list')).toBeLessThan(asked.indexOf('tools/call'));
  });
});

describe('what one call answers of its tool', () => {
  it('answers the hints the server gives the tool it listed', async () => {
    const fake = await oneCallServer();

    expect(await calledOnce(oneCallAccess(fake.url), { reference: { server: 'graph', tool: 'search' } })).toMatchObject(
      { outcome: 'result', annotations: { readOnlyHint: true, openWorldHint: true } },
    );
  });

  it('keeps the arguments and the answer, scrubbed, unless the entry of the server turns keeping off', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);
    const call = { ...echoCall, input: { token: oneCallKey } };
    const keptAnswer = JSON.stringify({ content: [{ type: 'text', text: scrubbed }] });

    const called = await calledOnce(access, call);
    const prepared = await Effect.runPromise(
      Effect.all([
        access.preparedCall(call),
        access.preparedCall({ ...call, reference: { server: 'wiki', tool: 'echo' } }),
      ]),
    );
    const starts = prepared.map(({ fields }) => fields);

    expect(starts).toEqual([
      {
        server: 'graph',
        tool: 'echo',
        arguments_bytes: Buffer.byteLength(scrubbed),
        arguments_sha256: digest(scrubbed),
      },
      { server: 'wiki', tool: 'echo', arguments_bytes: Buffer.byteLength(scrubbed) },
    ]);
    expect(called).toMatchObject({
      answered: { result_bytes: Buffer.byteLength(keptAnswer), result_sha256: digest(keptAnswer) },
    });
    expect(JSON.stringify([starts, called])).not.toContain(oneCallKey);
    await expect(keptTextOf(access.content, alpha, digest(scrubbed))).resolves.toBe(scrubbed);
    await expect(keptTextOf(access.content, alpha, digest(keptAnswer))).resolves.toBe(keptAnswer);
  });
});

describe('a call that fails', () => {
  it('is a tool error in the words of the tool when it answers with one, and in the words of the server when it refuses the arguments', async () => {
    const fake = await oneCallServer({ data: true });
    const access = oneCallAccess(fake.url, { allowed: ['denied', 'strict'] });

    expect(await calledOnce(access, { reference: { server: 'graph', tool: 'denied' } })).toMatchObject({
      ...failedWith('tool_error', deniedText),
      answered: { is_error: true, result_bytes: aNumber },
    });
    expect(
      await calledOnce(access, { reference: { server: 'graph', tool: 'strict' }, input: { limit: '15' } }),
    ).toMatchObject({
      ...failedWith('arguments_refused', expect.stringContaining('limit must be a whole number')),
      failed: { because: 'arguments_refused' },
    });
  });

  it('is not opened for a tool its server does not list, and nothing is sent', async () => {
    const fake = await oneCallServer();

    expect(await calledOnce(oneCallAccess(fake.url), { reference: { server: 'graph', tool: 'gone' } })).toEqual(
      unopenedWith('tool_not_offered', 'tool_not_listed', 'The tool server graph does not list the tool gone'),
    );
    expect(fake.received()).toEqual([]);
  });

  it('ends at its call bound', async () => {
    const fake = await oneCallServer();
    const sleeping = { reference: { server: 'graph', tool: 'sleep' }, input: { ms: 5000 } };

    expect(await calledOnce(oneCallAccess(fake.url, {}, { callMs: 200 }), sleeping)).toMatchObject({
      ...failedWith('timed_out', 'The tool server did not answer within 200 ms'),
      failed: { because: 'timed_out', duration_ms: aNumber },
    });
  });
});

describe('what a tool answers', () => {
  it('is carried whole, its content and its structured content, and counted', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);

    const large = await calledOnce(access, { reference: { server: 'graph', tool: 'large' }, input: { kib: 8 } });
    const structured = await calledOnce(access, { reference: { server: 'graph', tool: 'profile' }, input: {} });

    expect(large).toMatchObject({
      outcome: 'result',
      answer: { content: [{ type: 'text', text: largeText }] },
      answered: { result_bytes: largeAnswerBytes },
    });
    expect(structured).toMatchObject({
      outcome: 'result',
      answer: { content: [], structuredContent: { name: 'Ada', rows: 2 } },
    });
  });

  it('is scrubbed of the secrets of the server before the caller reads it', async () => {
    const fake = await oneCallServer();

    expect(await calledOnce(oneCallAccess(fake.url), { input: { token: oneCallKey } })).toMatchObject({
      outcome: 'result',
      answer: { content: [{ type: 'text', text: scrubbed }] },
    });
  });
});

describe('one call of a tool that declares an output schema', () => {
  it('answers what a tool answered against its own output schema, as it answered it', async () => {
    const fake = await oneCallServer({ data: true });

    expect(
      await calledOnce(oneCallAccess(fake.url), { reference: { server: 'graph', tool: 'promised' } }),
    ).toMatchObject({
      kind: 'answered',
      outcome: 'result',
      answer: { structuredContent: brokenPromise },
    });
    expect(fake.received()).toHaveLength(1);
  });
});

function stdioAccess() {
  const { access } = reportingAccess(
    {
      limitless: {
        command: process.execPath,
        args: [fakeStdioServerPath()],
        env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
        org: 'acme',
      },
    },
    { environment: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] }, timing: patientTiming },
  );
  closedAfter(access.close);
  return access;
}

const tooLarge = { kind: 'answered', outcome: 'too_large', failed: { because: 'too_large' } };

describe('one call whose tool answers past the cap of its transport', () => {
  it(
    'ends too large past 16 MiB over HTTP and past 4 MiB over stdio, the end a delivery and a telling record',
    { timeout: 120_000 },
    async () => {
      const fake = await oneCallServer();

      const overHttp = await calledOnce(oneCallAccess(fake.url), {
        reference: { server: 'graph', tool: 'large' },
        input: { kib: 16_384 },
      });
      const overStdio = await calledOnce(stdioAccess(), {
        reference: { server: 'limitless', tool: 'large' },
        input: { kib: 4097 },
      });

      expect([overHttp, overStdio]).toMatchObject([tooLarge, tooLarge]);
    },
  );
});
