import type { PlaybookOperation } from '@on.auto/definitions';
import { onTheStandingClock } from '@on.auto/definitions/testing';
import type { Outcome } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { defineAnswerInteraction } from '../requests/answer-interaction.ts';
import { listInteractions } from '../requests/list-interactions.ts';
import type { DueRequestItem, RequestsDue } from '../schedule/due-requests.ts';

const ListedSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({ interactions: Schema.Array(Schema.Unknown) }),
});

const decodeListed = Schema.decodeUnknownSync(ListedSchema);

export const answeringAnyRun = defineAnswerInteraction([]);

export async function firstOpenOf(
  call: (operation: PlaybookOperation, input: unknown) => Promise<Outcome>,
): Promise<unknown> {
  return decodeListed(await call(listInteractions, {})).output.interactions[0];
}

export function dueInBothLanes(due: RequestsDue, now: number): Promise<readonly DueRequestItem[]> {
  return Effect.runPromise(
    onTheStandingClock(
      Effect.zipWith(due.due(now, 256, true), due.due(now, 256, false), (outward, inward) => [
        ...new Map([...outward, ...inward].map((item) => [item.key, item])).values(),
      ]),
    ),
  );
}

export function performedAll(items: readonly DueRequestItem[], now: number): Promise<void> {
  return Effect.runPromise(
    onTheStandingClock(Effect.forEach(items, (item) => item.perform(now), { concurrency: 'unbounded', discard: true })),
  );
}

export function performedEach(times: readonly number[], perform: (now: number) => Promise<number>): Promise<void> {
  return Effect.runPromise(Effect.forEach(times, (now) => Effect.promise(() => perform(now)), { discard: true }));
}
