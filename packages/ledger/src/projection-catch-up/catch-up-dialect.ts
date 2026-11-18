import type { SQL } from '@event-driven-io/dumbo';

interface WindowRead {
  readonly after: string;
  readonly through: string | undefined;
  readonly count: number;
}

export interface CatchUpDialect {
  readonly beforeEveryFact: string;
  readonly orderOf: (point: string) => string;
  readonly window: (read: WindowRead) => SQL;
  readonly factsAt: (points: readonly string[]) => SQL;
}
