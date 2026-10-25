import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { controlledSignals, patientTiming, recordingCallJournal, reportingAccess, toolRun } from '../testing/index.ts';
import { fakeStdioServerPath } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function stdioRun(args: readonly string[] = []) {
  const { access } = reportingAccess(
    {
      limitless: {
        command: process.execPath,
        args: [fakeStdioServerPath(), ...args],
        env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
        org: 'acme',
      },
    },
    { environment: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] }, timing: patientTiming },
  );
  closing.push(access.close);
  const tools = await Effect.runPromise(
    access.open(toolRun(recordingCallJournal()), [
      { server: 'limitless', tool: 'search' },
      { server: 'limitless', tool: 'exit' },
    ]),
  );
  closing.push(tools.close);
  const [search, exit] = tools.offered;
  let calls = 0;
  const called = (tool: typeof search, input: Readonly<Record<string, unknown>>) => {
    calls += 1;
    return tool?.call({ callId: `call-${calls}`, input }, controlledSignals());
  };
  return {
    search: (query: string) => called(search, { query }),
    exit: (attempt: number) => called(exit, { attempt }),
  };
}

const closed = { text: 'The tool server limitless failed: The connection to the tool server closed', isError: true };

describe('a stdio server that exits during a run', () => {
  it('is restarted once, and fails the run’s calls when it exits again', async () => {
    const run = await stdioRun();

    const exited = await run.exit(1);
    const restarted = await run.search('restarted');
    await run.exit(2);
    const exitedAgain = await run.search('again');

    expect(exited).toMatchObject(closed);
    expect(restarted).toMatchObject({ text: 'Found 2 rows for restarted.', isError: false });
    expect(exitedAgain).toMatchObject({
      text: 'The tool server limitless failed: The MCP server process exited again after its restart in this run',
      isError: true,
    });
  });

  it('fails a call when it cannot be started again', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'fake-mcp-'));
    closing.push(() => rm(folder, { recursive: true }));
    const run = await stdioRun(['--start-once', join(folder, 'started')]);

    await run.exit(1);

    expect(await run.search('again')).toMatchObject(closed);
  });
});
