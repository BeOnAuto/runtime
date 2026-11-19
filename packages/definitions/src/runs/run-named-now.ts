import { PlaybookReader, runStreamNameOf } from '@on.auto/operations';
import type { HeldName } from '@on.auto/operations/definition-names';
import { Effect, Option } from 'effect';

import { placeOfRun, runDecider } from './run-decider.ts';
import { startedRunOf, type RunState } from './run-state.ts';

function namedAs(state: RunState, held: HeldName | undefined): RunState {
  return state === undefined || held === undefined ? state : { ...state, run: { ...state.run, name: held.name } };
}

export const loadRunAsNamedNow = Effect.fnUntraced(function* (id: string) {
  const place = yield* Effect.option(placeOfRun(id));
  if (Option.isNone(place)) {
    return startedRunOf(runDecider.initialState);
  }
  const reader = yield* PlaybookReader;
  const { state } = yield* reader.ofDefinition(place.value.definition).load(runStreamNameOf(id), runDecider);
  return namedAs(startedRunOf(state), yield* reader.nameHeldBy(place.value.definition));
});
