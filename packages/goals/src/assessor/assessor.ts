import { playbookOfStreamPrefix, type Ledger } from '@on.auto/operations';
import type { Consumer } from '@on.auto/workflow-host';
import { Effect, Option } from 'effect';

import { clocksName } from '../goal-tables/clock-rows.ts';
import { deliveryOf, unreadDelivery } from './assessor-deliveries.ts';
import { runPlannerOf, type AssessorPorts, type AssessorWork } from './run-planner.ts';

export const assessorName = 'goal assessments';

const assessorSweeps = 20;

interface Assessor extends Consumer {
  readonly wants: (playbookKey: string) => Effect.Effect<boolean>;
  readonly wantedWith: string;
  readonly spent: () => AssessorWork;
}

export const goalsWantedWith = clocksName;

export function goalsWantedIn(
  ledger: Pick<Ledger['Service'], 'readProjectedRows'>,
  playbookKey: string,
): Effect.Effect<boolean> {
  return Option.match(playbookOfStreamPrefix(playbookKey), {
    onNone: () => Effect.succeed(false),
    onSome: (address) =>
      Effect.map(
        ledger.readProjectedRows(clocksName, address, { where: [], orderBy: [], order: 'asc', limit: 1 }),
        (rows) => rows.length > 0,
      ),
  });
}

export function assessorOf<E>(ports: AssessorPorts<E>): Assessor {
  const planner = runPlannerOf(ports);
  return {
    name: assessorName,
    types: ['run_succeeded'],
    skippedAfterSweeps: assessorSweeps,
    wants: (playbookKey) => goalsWantedIn(ports.ledger, playbookKey),
    wantedWith: goalsWantedWith,
    batchOf: (followed, after, most) =>
      Effect.map(planner.planOf(followed), (plan) => {
        const workflow = followed.record.context.definitionName ?? '';
        if ('unread' in plan) {
          return { deliveries: [unreadDelivery(workflow, plan.unread)], through: undefined, more: false };
        }
        const rest = plan.planned.filter(({ key }) => after === undefined || key > after);
        const page = rest.slice(0, most);
        const parts = { ledger: ports.ledger, playbook: followed.playbook, workflow, now: ports.now };
        return {
          deliveries: page.map((planned) => deliveryOf(parts, planned)),
          through: page.at(-1)?.key,
          more: rest.length > page.length,
        };
      }),
    spent: planner.spent,
  };
}
