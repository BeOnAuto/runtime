import type { MeteredRun } from '@on.auto/definitions';

const notificationFunctionType = 'interaction';

export function isGoalNotice({
  definition_type,
  called_by,
  trigger,
}: Pick<MeteredRun, 'definition_type' | 'called_by' | 'trigger'>): boolean {
  return definition_type === notificationFunctionType && called_by === null && trigger?.kind === 'goal';
}
