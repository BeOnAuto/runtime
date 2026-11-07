import { activityHarness, ada, priya, type LedgerReads } from './harness.ts';
import { definitionCreated, runDeferred, runFailed, runStarted, runSucceeded, type RunOf } from './recorded-facts.ts';

const runId = (index: number) => `019a4000-0000-7000-8000-${String(index).padStart(12, '0')}`;

export const runs = {
  broke: { runId: runId(1), type: 'reasoning', name: 'categorize-invoice', version: 1 },
  askedAnyone: { runId: runId(2), type: 'interaction', name: 'approve-payment', version: 1 },
  askedDana: { runId: runId(3), type: 'interaction', name: 'approve-payment', version: 1 },
  closed: {
    runId: runId(4),
    type: 'workflow',
    name: 'close-the-week',
    version: 1,
    trigger: { kind: 'cron', reference: 'weekly' },
  },
  step: {
    runId: runId(5),
    type: 'reasoning',
    name: 'summarize-week',
    version: 1,
    calledBy: { runId: runId(4), reference: 'categorize', run: 1 },
  },
  sold: { runId: runId(6), type: 'workflow', name: 'weekly-sales', version: 1 },
} satisfies Readonly<Record<string, RunOf>>;

export const at = (time: string) => `2026-11-01T${time}:00.000Z`;

const finance = 'playbook/acme/finance/';

const runStream = ({ runId: id }: RunOf, prefix = finance) => `${prefix}runs/${id}`;

const asked = (to: string) => ({
  to,
  message: `Approve this?\nFor ${to}`,
  expiresAt: '2026-11-03T12:00:00.000Z',
  answerSchema: { type: 'boolean' },
});

export async function financeAndSales(reads?: LedgerReads) {
  const harness = activityHarness(reads);
  const { created, record } = harness;
  await created(priya, 'finance', at('10:00'));
  await created(ada, 'sales', at('10:00'));
  await record(
    'playbook/acme/sales/definitions/workflow',
    definitionCreated({ type: 'workflow', name: 'old-report', version: 1 }, '2026-10-20T09:00:00.000Z', priya.id),
  );
  await record(
    `${finance}definitions/reasoning`,
    definitionCreated({ type: 'reasoning', name: 'categorize-invoice', version: 1 }, at('10:05'), priya.id),
  );
  await record(runStream(runs.broke), runStarted(runs.broke, at('11:00'), ada.id), runFailed(runs.broke, at('11:01')));
  await record(
    runStream(runs.askedAnyone),
    runStarted(runs.askedAnyone, at('12:00'), priya.id),
    runDeferred(runs.askedAnyone, at('12:01'), asked('#approvals')),
  );
  await record(
    runStream(runs.askedDana),
    runStarted(runs.askedDana, at('12:10'), priya.id),
    runDeferred(runs.askedDana, at('12:11'), asked('Dana@Example.com')),
  );
  await record(runStream(runs.closed), runStarted(runs.closed, at('13:00'), priya.id, 'table'));
  await record(
    runStream(runs.step),
    runStarted(runs.step, at('13:01'), priya.id),
    runSucceeded(runs.step, at('13:02')),
  );
  await record(runStream(runs.closed), runSucceeded(runs.closed, at('13:05')));
  await record(
    runStream(runs.sold, 'playbook/acme/sales/'),
    runStarted(runs.sold, at('14:00'), ada.id),
    runSucceeded(runs.sold, at('14:01')),
  );
  return harness;
}
