const goalAndWorkflow = /^([a-z][a-z0-9-]{2,47})\.([a-z][a-z0-9-]{2,47})$/u;

export interface RefusedOf {
  readonly goal: string;
  readonly workflow: string;
}

export function goalSummariesStreamIdOf(goal: string): string {
  return goal;
}

export function goalRefusalsStreamIdOf({ goal, workflow }: RefusedOf): string {
  return `${goal}.${workflow}`;
}

export function refusedOfKey(key: string): RefusedOf | undefined {
  const [, goal, workflow] = goalAndWorkflow.exec(key) ?? [];
  return goal === undefined || workflow === undefined ? undefined : { goal, workflow };
}
