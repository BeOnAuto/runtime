import {
  circuitBreakers,
  isStreamProjectionRefused,
  readModelOpenForMs,
  type PlaybookAddress,
} from '@on.auto/operations';
import { Clock, Data, Effect } from 'effect';

export type RefusedBecause = 'checks_failed' | 'pointer_disagrees';

export class ReadModelRefused extends Data.TaggedError('read_model_refused')<{ readonly because: RefusedBecause }> {}

export function refusedWhenItsChecksFailed<A>(read: Effect.Effect<A>): Effect.Effect<A, ReadModelRefused> {
  return Effect.catchDefect(read, (defect) =>
    isStreamProjectionRefused(defect)
      ? Effect.fail(new ReadModelRefused({ because: 'checks_failed' }))
      : Effect.die(defect),
  );
}

const resetsOfPlaybooks = circuitBreakers(readModelOpenForMs);

function keyOf({ org, playbook }: PlaybookAddress): string {
  return `${org}/${playbook}`;
}

export const pointerDisagreesMessage =
  'A row of the read model of the definitions still names no save of its version once it was built again';

export interface PointerReset {
  readonly playbook: PlaybookAddress;
  readonly type: string;
  readonly reset: Effect.Effect<void>;
}

export function oncePerOpening<A>(
  { playbook, type, reset }: PointerReset,
  read: Effect.Effect<A | 'disagrees', ReadModelRefused>,
): Effect.Effect<A, ReadModelRefused> {
  const refused = new ReadModelRefused({ because: 'pointer_disagrees' });
  return Effect.gen(function* () {
    const first = yield* read;
    if (first !== 'disagrees') {
      return first;
    }
    const at = yield* Clock.currentTimeMillis;
    if (resetsOfPlaybooks.stateAt(keyOf(playbook), at) === 'open') {
      return yield* refused;
    }
    resetsOfPlaybooks.opened(keyOf(playbook), at);
    yield* reset;
    const again = yield* read;
    if (again !== 'disagrees') {
      resetsOfPlaybooks.closed(keyOf(playbook));
      return again;
    }
    yield* Effect.logError(pointerDisagreesMessage).pipe(Effect.annotateLogs({ definition_type: type }));
    return yield* refused;
  });
}
