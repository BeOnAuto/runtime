import { setTimeout } from 'node:timers/promises';

import { Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import {
  logLinesOf,
  requestTo,
  settledOver,
  workflowProcess,
  type Answer,
} from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const approval = workflowSource(
  'approval',
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ $data[0] }' } }\n",
);

const pausing = workflowSource('pausing', 'do:\n  - pause: { wait: PT1S }\n  - done: { set: { paused: true } }\n');

const timing = workflowSource('timing', 'do:\n  - slow: { timeout: { after: PT1S }, wait: PT1H }\n');

const timersMs = 1000;

const historyOf = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

async function isWaiting(port: number, run: Answer): Promise<boolean> {
  const { body } = await requestTo(port, 'GET', `/gamma/runs/${runIdIn(run.body)}/history`);
  return historyOf(body).events.some(({ type }) => type === 'step_waiting');
}

const inputsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        type: Schema.String,
        metadata: Schema.Struct({ causation_id: Schema.NullOr(Schema.String) }),
      }),
    ),
  }),
);

describe('main with workflows', () => {
  it('says how it runs workflows, and exits 0 on SIGTERM', async () => {
    const child = workflowProcess(ledger.fileName, { PREDICTION_CACHE_DIR: ledger.cacheDirectory });
    const port = await child.port;

    child.signal('SIGTERM');
    const exitCode = await child.exited;
    const startUpLines = logLinesOf(child)
      .filter(({ message }) => !/^(?:Model provider|No model provider)/u.test(message))
      .map(({ message, level }) => `${level} ${message}`);

    expect(exitCode).toBe(0);
    expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
    expect(startUpLines.slice(1)).toEqual([
      `INFO The ledger is kept in the file ${ledger.fileName}`,
      "INFO Content is kept in the ledger's database",
      expect.stringMatching(
        /^INFO Secrets are kept in the ledger's database, sealed under the key [\da-f]{16} that the file \S+\/secrets\.key holds, and 0 sealed under the previous key were sealed again under it$/u,
      ),
      expect.stringMatching(
        /^INFO Extensions loaded, in their order of precedence: @on\.auto\/prediction-series [\d.]+, of the release, filling prediction\/model-runtime$/u,
      ),
      "INFO Reasoning functions run in this server: the model calls of a run add up to at most 2,000,000 input tokens, and each answer of a tool is read whole where it fits the model's context window",
      `INFO Prediction functions run in this server: a playbook keeps at most 32 active, each builds at most 4 times a day, and model processes may run at most 4 at once, at most 2 of them for the builds being scored, with 1,280 MiB of data each, which nothing bounds, since prlimit is not on the path, reading the files of their models from ${ledger.cacheDirectory}`,
      'INFO Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms',
    ]);
    expect(startUpLines[0]).toMatch(/^WARN Local mode is on: /u);
  });
});

describe('a server started again on the ledger of its workflows', () => {
  it('goes on with a run that waits for an event, and with ones whose timers went off while it was stopped, the fire of each caused by the record that armed it', async () => {
    const first = workflowProcess(ledger.fileName);
    const firstPort = await first.port;
    await requestTo(firstPort, 'POST', '', { playbook: 'gamma', name: 'Gamma' });
    await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', { name: 'approval', source: approval });
    await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', { name: 'pausing', source: pausing });
    await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', { name: 'timing', source: timing });
    const waiting = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/approval/run', { input: {} });
    const paused = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/pausing/run', { input: {} });
    const timed = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/timing/run', { input: {} });
    await Promise.all([paused, timed].map((run) => until(() => isWaiting(firstPort, run), Boolean)));
    const timersDueBy = Date.now() + timersMs;
    first.signal('SIGTERM');
    await first.exited;
    await setTimeout(Math.max(0, timersDueBy - Date.now()));

    const second = workflowProcess(ledger.fileName);
    const port = await second.port;
    const sent = await requestTo(port, 'POST', `/gamma/runs/${runIdIn(waiting.body)}/events`, {
      event: { type: 'com.acme.approved', data: { by: 'Ada' } },
    });
    const approved = await settledOver(port, `/gamma/runs/${runIdIn(waiting.body)}`);
    const pausedSettled = await settledOver(port, `/gamma/runs/${runIdIn(paused.body)}`);
    await settledOver(port, `/gamma/runs/${runIdIn(timed.body)}`);
    const timedHistory = await requestTo(port, 'GET', `/gamma/runs/${runIdIn(timed.body)}/history?limit=100`);
    second.signal('SIGTERM');
    const inputs = inputsOf(timedHistory.body).events.filter(({ type }) => type === 'workflow_input_applied');

    expect(sent.status).toBe(200);
    expect(approved).toMatchObject({ status: 'succeeded', output: { by: 'Ada' } });
    expect(pausedSettled).toMatchObject({ status: 'succeeded', output: { paused: true } });
    expect(inputs.map(({ metadata }) => metadata.causation_id).at(-1)).toBe(inputs[0]?.id);
    expect(await second.exited).toBe(0);
  });
});
