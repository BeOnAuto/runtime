import type { DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

export function performedOnce(works: readonly DueWork[], now: number): Promise<number> {
  return Effect.runPromise(
    Effect.gen(function* () {
      let performed = 0;
      for (const work of works) {
        const items = [...(yield* work.due(now, 256, true)), ...(yield* work.due(now, 256, false))];
        for (const item of items) {
          yield* item.perform(now);
          performed += 1;
        }
      }
      return performed;
    }).pipe(Effect.orDie),
  );
}

interface DueDriven {
  readonly due: readonly DueWork[];
  readonly now: () => number;
}

async function performedFrom(driven: DueDriven, ahead: number, roundsLeft: number): Promise<number> {
  const performed = await performedOnce(driven.due, driven.now() + ahead);
  return performed === 0 || roundsLeft <= 1
    ? performed
    : performed + (await performedFrom(driven, ahead, roundsLeft - 1));
}

export function performedUntilQuiet(driven: DueDriven, ahead = 1000, most = 64): Promise<number> {
  return performedFrom(driven, ahead, most);
}
