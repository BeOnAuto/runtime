import type { FetchLike } from '@modelcontextprotocol/client';
import { CallFetch } from '@on.auto/operations';
import { Effect, Option } from 'effect';

interface OverFetches<A> {
  readonly over: (fetch: FetchLike) => A;
  readonly ofTheCall: Effect.Effect<A>;
}

export function overFetches<A>(own: { readonly fetch: FetchLike; readonly made: A }, make: (fetch: FetchLike) => A) {
  const madeOver = new WeakMap<FetchLike, A>([[own.fetch, own.made]]);
  const over = (fetch: FetchLike): A => {
    const made = madeOver.get(fetch) ?? make(fetch);
    madeOver.set(fetch, made);
    return made;
  };
  const overTheCall: OverFetches<A> = {
    over,
    ofTheCall: Effect.map(Effect.serviceOption(CallFetch), Option.match({ onNone: () => own.made, onSome: over })),
  };
  return overTheCall;
}
