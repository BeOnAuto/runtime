import type { RouteRegistration } from '@on.auto/operations';

import { agreePlaybookGoalsWhere } from '../agreements/agree-playbook-goals.ts';
import { getJudgedPlaybookGoals, getPlaybookGoals } from './get-playbook-goals.ts';

interface GoalsOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export function goalsOperationsServed(goals: boolean, results = false, messages = true): readonly GoalsOperation[] {
  if (!goals) return [];
  return [results ? getJudgedPlaybookGoals : getPlaybookGoals, agreePlaybookGoalsWhere(messages)];
}
