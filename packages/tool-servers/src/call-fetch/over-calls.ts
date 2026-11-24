import type { FetchLike } from '@modelcontextprotocol/client';
import { CallFetch, CallSubjectTokens, type FetchOfACall, type SubjectTokensOfACall } from '@on.auto/operations';
import { Effect, Option } from 'effect';

interface BoundToACall<Fetch> {
  readonly fetch: Fetch | FetchOfACall;
  readonly subjectTokens: SubjectTokensOfACall | undefined;
}

interface OwnBinding<Fetch, A> extends BoundToACall<Fetch> {
  readonly fetch: Fetch;
  readonly made: A;
}

export function overCalls<Fetch extends FetchLike, A>(
  own: OwnBinding<Fetch, A>,
  make: (bound: BoundToACall<Fetch>) => A,
): Effect.Effect<A> {
  const signedAsComposed: object = {};
  const madeOver = new WeakMap<Fetch | FetchOfACall, WeakMap<object, A>>([
    [own.fetch, new WeakMap<object, A>([[signedAsComposed, own.made]])],
  ]);
  const over = (bound: BoundToACall<Fetch>, signer: object): A => {
    const bySigner = madeOver.get(bound.fetch) ?? new WeakMap<object, A>();
    madeOver.set(bound.fetch, bySigner);
    const made = bySigner.get(signer) ?? make(bound);
    bySigner.set(signer, made);
    return made;
  };
  const fetchOfTheCall = Effect.map(Effect.serviceOption(CallFetch), Option.getOrUndefined);
  const signerOfTheCall = Effect.map(Effect.serviceOption(CallSubjectTokens), Option.getOrUndefined);
  return Effect.flatMap(signerOfTheCall, (signer) =>
    Effect.map(fetchOfTheCall, (fetch) =>
      over({ fetch: fetch ?? own.fetch, subjectTokens: signer ?? own.subjectTokens }, signer ?? signedAsComposed),
    ),
  );
}
