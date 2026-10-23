import { makeAppRuntime } from '@on.auto/api';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Cause, Effect, Exit, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { applicationLayer } from '../composition/application-layer.ts';
import { hostReports } from './host-reports.ts';
import { inRuntime } from './in-runtime.ts';

const memoryLedger = ledgerLayer({ fileName: ':memory:' });

async function reportedLines(
  report: (reports: ReturnType<typeof hostReports>) => Promise<unknown>,
): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const runtime = await makeAppRuntime(
    applicationLayer(memoryLedger).pipe(Layer.provideMerge(Logger.layer([capture]))),
  );
  await report(hostReports(runtime));
  await runtime.dispose();
  return lines;
}

describe('work the workflow host hands to the runtime of the server', () => {
  it('runs on the services of the runtime, and fails as it fails there', async () => {
    const runtime = await makeAppRuntime(applicationLayer(memoryLedger));

    const done = await Effect.runPromise(inRuntime(runtime, Effect.succeed('done')));
    const refused = await Effect.runPromise(Effect.exit(inRuntime(runtime, Effect.fail('refused'))));
    await runtime.dispose();

    expect(done).toBe('done');
    expect(refused).toStrictEqual(Exit.fail('refused'));
  });

  it('dies once the runtime is disposed, so the host performs the call again when the server next starts', async () => {
    const runtime = await makeAppRuntime(Layer.empty.pipe(Layer.provideMerge(applicationLayer(memoryLedger))));
    await runtime.dispose();

    const exit = await Effect.runPromise(Effect.exit(inRuntime(runtime, Effect.succeed('too late'))));

    expect(String(exit)).toContain('The server stopped before the work could be done');
  });
});

describe('the reports of the workflow host', () => {
  it('log a run left started with the reason the host gave, in words', async () => {
    const lines = await reportedLines(async (reports) => {
      const run = { org: 'acme', playbook: 'alpha', runId: 'e-1' };
      await Effect.runPromise(reports.unsettled({ ...run, receipt: 'unknown_run' }));
      await Effect.runPromise(reports.unsettled({ ...run, receipt: 'settled_otherwise' }));
    });

    expect(lines).toEqual([
      expect.stringContaining(
        '"annotations":{"org":"acme","playbook":"alpha","run_id":"e-1","reason":"The ledger has no such run"}',
      ),
      expect.stringContaining('"reason":"The run was settled otherwise before"'),
    ]);
  });

  it('log trouble and a note of the host as warnings', async () => {
    const lines = await reportedLines(async (reports) => {
      await Effect.runPromise(reports.trouble('A sweep of the runs failed; the next sweep tries again', Cause.empty));
      await Effect.runPromise(
        reports.note({
          kind: 'settled_after_back_off',
          run: { org: 'acme', playbook: 'alpha', runId: 'e-1' },
          attempts: 21,
        }),
      );
    });

    expect(lines).toEqual([
      expect.stringContaining('"message":"A sweep of the runs failed; the next sweep tries again","level":"WARN"'),
      expect.stringContaining('"message":"A run that could not be settled was settled at attempt 21"'),
    ]);
  });
});
