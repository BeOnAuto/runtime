import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it } from 'vitest';

import { verboseDescription } from '../testing/index.ts';
import { fakeApiKey, openFakeToolRun } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function runWith(tools: readonly string[]) {
  const run = await openFakeToolRun(tools);
  closing.push(run.close);
  return run;
}

describe('whether every tool a run called only reads', () => {
  it('holds before any call and while each tool called is one its server marks read-only, and not once another is called', async () => {
    const { tools, call } = await runWith(['search', 'echo']);
    const before = tools.calledOnlyReadOnly();
    await call('search', { query: 'acme' });
    const afterReading = tools.calledOnlyReadOnly();
    await call('echo', {});

    expect([before, afterReading, tools.calledOnlyReadOnly(), tools.calledAny()]).toEqual([true, true, false, true]);
  });
});

describe('how much the tools of a run answered', () => {
  it('adds up the bytes of every answer a tool gave, and nothing for a call that failed', async () => {
    const { tools, call } = await runWith(['search', 'broken']);
    const before = tools.answeredBytes();
    await call('search', { query: 'acme' });
    await call('broken', {});

    expect([before, tools.answeredBytes()]).toEqual([
      0,
      Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: 'Found 2 rows for acme.' }] })),
    ]);
  });
});

describe('what the model sees of a tool', () => {
  it('sees its description cut to 4 KiB', async () => {
    const { tools, call } = await runWith(['verbose']);
    const [verbose] = tools.offered;
    const description = String(verbose?.description);

    expect(await call('verbose', {})).toMatchObject({ text: 'Said.', isError: false });
    expect(Buffer.byteLength(verboseDescription)).toBeGreaterThan(4096);
    expect(Buffer.byteLength(description)).toBe(4096);
    expect(verboseDescription.startsWith(description)).toBe(true);
  });

  it('sees its results scrubbed of the secrets of its server', async () => {
    const { call } = await runWith(['echo']);

    expect(await call('echo', { said: `the key is ${fakeApiKey}` })).toMatchObject({
      text: '{"said":"the key is [redacted]"}',
      isError: false,
    });
  });
});
