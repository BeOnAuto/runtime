import type { FetchLike } from '@modelcontextprotocol/client';
import { CallFetch, type FetchOfACall } from '@on.auto/operations';
import { Effect, Option } from 'effect';

interface OverFetches<Fetch, A> {
  readonly over: (fetch: Fetch | FetchOfACall) => A;
  readonly ofTheCall: Effect.Effect<A>;
}

export function overFetches<Fetch extends FetchLike, A>(
  own: { readonly fetch: Fetch; readonly made: A },
  make: (fetch: Fetch | FetchOfACall) => A,
) {
  const madeOver = new WeakMap<Fetch | FetchOfACall, A>([[own.fetch, own.made]]);
  const over = (fetch: Fetch | FetchOfACall): A => {
    const made = madeOver.get(fetch) ?? make(fetch);
    madeOver.set(fetch, made);
    return made;
  };
  const overTheCall: OverFetches<Fetch, A> = {
    over,
    ofTheCall: Effect.map(Effect.serviceOption(CallFetch), Option.match({ onNone: () => own.made, onSome: over })),
  };
  return overTheCall;
}
