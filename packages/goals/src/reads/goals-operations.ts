import type { RouteRegistration } from '@on.auto/operations';

import { agreePlaybookGoalsWhere } from '../agreements/agree-playbook-goals.ts';
import type { ServerConnected } from '../connections/goal-connections.ts';
import { dismissGoalThingAsking, type AskedAbout } from '../dismissals/dismiss-goal-thing.ts';
import { getGoalDay } from '../results/goal-day.ts';
import { listGoalResults } from '../results/goal-results.ts';
import { getJudgedPlaybookGoals, getPlaybookGoals, getPlaybookGoalsJudged } from './get-playbook-goals.ts';

interface GoalsOperationPorts {
  readonly connected?: ServerConnected | undefined;
  readonly askedAbout?: AskedAbout | undefined;
}

interface GoalsOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export function goalsOperationsServed(
  goals: boolean,
  results = false,
  messages = true,
  { connected, askedAbout }: GoalsOperationPorts = {},
): readonly GoalsOperation[] {
  if (!goals) return [];
  const judged = results ? getJudgedPlaybookGoals : getPlaybookGoals;
  return [
    connected === undefined ? judged : getPlaybookGoalsJudged(results, connected),
    agreePlaybookGoalsWhere(messages),
    getGoalDay,
    listGoalResults,
    dismissGoalThingAsking(askedAbout),
  ];
}
