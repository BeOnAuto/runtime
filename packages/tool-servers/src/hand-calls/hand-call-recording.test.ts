import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { keptTextOf } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeRequestIdKey, patientTiming, playbookToolCalls, reportingAccess } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const decodeExecuted = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ call_id: Schema.String }) }));

const aTime: unknown = expect.any(String);

const aNumber: unknown = expect.any(Number);

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const alpha = { org: 'acme', playbook: 'alpha' };

const answeredData: unknown = expect.objectContaining({ is_error: false, jsonrpc_id: aNumber, result_sha256: aDigest });

async function callsOn(entry: Readonly<Record<string, unknown>> = {}) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
  const { access, content } = reportingAccess(
    { graph },
    { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  const kept = (sha256: string) => keptTextOf(content, alpha, sha256);
  return { fake, kept, ...playbookToolCalls(access) };
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('what a call made by hand records', () => {
  it('is the facts of a call on a stream of its own, the answer caused by the start, with the caller as by and no run', async () => {
    const { call, recorded } = await callsOn();
    const argumentsJson = JSON.stringify({ query: 'acme' });

    const callId = decodeExecuted(
      await call('execute', { server: 'graph', tool: 'search', arguments: { query: 'acme' } }),
    ).output.call_id;
    const [started, answered, ...more] = await recorded();

    expect([started, answered, more]).toEqual([
      expect.objectContaining({
        stream: `playbook/acme/alpha/tool-calls/${callId}`,
        type: 'tool_call_started',
        causationId: null,
        correlationId: null,
        data: {
          call_id: callId,
          server: 'graph',
          tool: 'search',
          arguments_bytes: Buffer.byteLength(argumentsJson),
          arguments_sha256: digestOf(argumentsJson),
          read_only: true,
        },
        context: { by: 'acme-builder', at: aTime },
      }),
      expect.objectContaining({
        stream: `playbook/acme/alpha/tool-calls/${callId}`,
        type: 'tool_call_answered',
        causationId: started?.id,
        data: answeredData,
        context: { by: 'acme-builder', at: aTime },
      }),
      [],
    ]);
    expect(answered?.data).not.toHaveProperty('number');
  });

  it('is nothing for search, introspect, validate and dry_run, which change nothing', async () => {
    const { call, recorded } = await callsOn();
    const asked = { server: 'graph', tool: 'search' };

    await call('search', { terms: 'search' });
    await call('introspect', asked);
    await call('validate', { ...asked, arguments: { query: 'acme' } });
    await call('dry_run', { ...asked, arguments: { query: 'acme' } });

    expect(await recorded()).toEqual([]);
  });
});

describe('the content a call made by hand records', () => {
  it('is kept whole and scrubbed by default, and not at all where the entry turns keeping off', async () => {
    const said = { said: `the key is ${fakeApiKey} ${'x'.repeat(6000)}` };
    const scrubbed = JSON.stringify({ said: `the key is [redacted] ${'x'.repeat(6000)}` });
    const keeping = await callsOn();
    const notKeeping = await callsOn({ record_content: false });

    await keeping.call('execute', { server: 'graph', tool: 'echo', arguments: said });
    await notKeeping.call('execute', { server: 'graph', tool: 'echo', arguments: said });
    const [kept, unkept] = [await keeping.recorded(), await notKeeping.recorded()];
    const resultSha256 = String(Reflect.get(new Object(kept[1]?.data), 'result_sha256'));
    const keptResult = String(await keeping.kept(resultSha256));

    await expect(keeping.kept(digestOf(scrubbed))).resolves.toBe(scrubbed);
    await expect(notKeeping.kept(digestOf(scrubbed))).resolves.toBeUndefined();
    expect([kept.map(({ data }) => data), unkept.map(({ data }) => data)]).toEqual([
      [
        expect.objectContaining({ arguments_bytes: Buffer.byteLength(scrubbed), arguments_sha256: digestOf(scrubbed) }),
        expect.objectContaining({ result_sha256: aDigest }),
      ],
      [
        expect.not.objectContaining({ arguments_sha256: aDigest }),
        expect.not.objectContaining({ result_sha256: aDigest }),
      ],
    ]);
    expect(unkept[0]?.data).toMatchObject({ arguments_bytes: Buffer.byteLength(scrubbed) });
    expect(digestOf(keptResult)).toBe(resultSha256);
    expect(keptResult).toContain('the key is [redacted]');
    expect(JSON.stringify([...kept, ...unkept, keptResult])).not.toContain(fakeApiKey);
  });

  it('carries the server’s own id of the request where the entry names where it is, and none where it does not', async () => {
    const naming = await callsOn({ request_id: fakeRequestIdKey });
    const silent = await callsOn();
    const asked = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

    const named = await naming.call('execute', asked);
    await silent.call('execute', asked);

    expect(named).toMatchObject({ output: { server_request_id: 'call-1' } });
    expect((await naming.recorded())[1]?.data).toMatchObject({ server_request_id: 'call-1' });
    expect((await silent.recorded())[1]?.data).not.toHaveProperty('server_request_id');
  });
});
