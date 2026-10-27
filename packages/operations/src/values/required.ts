import { Option } from 'effect';

export function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}
