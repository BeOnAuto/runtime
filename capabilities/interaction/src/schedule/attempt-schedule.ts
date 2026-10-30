export const attemptSchedule = {
  attempts: 5,
  waitsMs: [60_000, 120_000, 240_000, 480_000],
} as const;

export interface EndedAttempt {
  readonly attempt: number;
  readonly endedAt: number;
  readonly retryAfterMs?: number | undefined;
}

const longestWaitMs = Math.max(...attemptSchedule.waitsMs);

export function nextAttemptAt({ attempt, endedAt, retryAfterMs = 0 }: EndedAttempt): number | undefined {
  const scheduled = attemptSchedule.waitsMs[attempt - 1];
  return scheduled === undefined ? undefined : endedAt + Math.min(Math.max(scheduled, retryAfterMs), longestWaitMs);
}
