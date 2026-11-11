import { firstTryAgainMs, mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { aLedger, minute, movedOn } from '../testing/accounts/refused-workflows.ts';
import { contentReads } from '../testing/servers/content-reads.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const ticking = workflowSource(
  'tick',
  [
    ...Array.from({ length: Math.ceil(mostInlinePayloadBytes / 32) }, () => '# Keep each line short and plain.'),
    'schedule:',
    '  every: PT5M',
    'do:',
    "  - keep: { set: { input: '${ $data }' } }",
    '',
  ].join('\n'),
);

const ListedRuns = Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) });

const SettledRun = Schema.Struct({
  output: Schema.Struct({ input: Schema.Struct({ schedule: Schema.Struct({ due: Schema.String }) }) }),
});

const ScheduledRuns = Schema.Struct({ runs: Schema.NonEmptyArray(Schema.Struct({ run_id: Schema.String })) });

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const scheduledIn = Schema.decodeUnknownSync(ScheduledRuns);

const settledIn = Schema.decodeUnknownSync(SettledRun);

async function runsOfTheSchedule(server: ReasoningServer) {
  return runsIn((await server.call('GET', `${alpha}/runs?type=workflow&name=tick`)).body).runs;
}

type TemporaryLedger = ReturnType<typeof aLedger>;

interface Saved {
  readonly from: number;
  readonly by: number;
}

async function savedByAnotherServer(ledger: TemporaryLedger): Promise<Saved> {
  const saving = await servingReasoning([], {}, undefined, { ledger, keptOutside: true });
  await saving.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const from = Date.now();
  await saving.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'tick', source: ticking } });
  const by = Date.now();
  await saving.stop();
  return { from, by };
}

describe('a schedule whose workflow its playbook keeps outside its facts', () => {
  it('holds a due time while the workflow cannot be read from storage, and starts the run of that time once it can and the gate of the process has let a try through', async () => {
    const ledger = aLedger();
    const saved = await savedByAnotherServer(ledger);
    const content = contentReads();
    const clock = movedClock(Date.now());
    const server = await servingReasoning([], {}, undefined, {
      clock,
      ledger,
      ledgerOver: content.over,
      keptOutside: true,
    });
    onTestFinished(() => server.stop());
    content.fail(true);

    clock.moveTo(saved.by + 5 * minute + 1000);
    await until(
      () => content.reads(),
      (reads) => reads > 0,
    );
    const whileUnread = await runsOfTheSchedule(server);
    content.fail(false);
    await new Promise((resolve) => {
      setTimeout(resolve, firstTryAgainMs);
    });
    movedOn(clock, minute);
    const {
      runs: [started],
    } = await until(async () => scheduledIn((await server.call('GET', `${alpha}/runs?type=workflow&name=tick`)).body));
    const run = settledIn((await settledRun(server, `${alpha}/runs/${started.run_id}`)).body);
    const due = Date.parse(run.output.input.schedule.due);

    expect(whileUnread).toEqual([]);
    expect(due).toBeGreaterThanOrEqual(saved.from + 5 * minute);
    expect(due).toBeLessThanOrEqual(saved.by + 5 * minute);
  }, 60_000);
});
