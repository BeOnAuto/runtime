import { Conflict, ConflictKindSchema, type ConflictKind } from '@on.auto/operations';
import { Data, Option, Schema } from 'effect';

const appendRefusedTag = 'append_refused';

interface Refusal {
  readonly detail: string;
  readonly kind?: ConflictKind;
}

class AppendRefused extends Data.TaggedError(appendRefusedTag)<Refusal> {}

function refusalOf({ detail, kind }: Refusal): Refusal {
  return kind === undefined ? { detail } : { detail, kind };
}

export function appendRefusedAs(conflict: Pick<Conflict, 'detail' | 'kind'>): AppendRefused {
  return new AppendRefused(refusalOf(conflict));
}

const decodeRefusal = Schema.decodeUnknownOption(
  Schema.Struct({
    _tag: Schema.Literal(appendRefusedTag),
    detail: Schema.String,
    kind: Schema.optionalKey(ConflictKindSchema),
  }),
);

export function conflictOfARefusal(error: unknown): Conflict | undefined {
  return Option.getOrUndefined(Option.map(decodeRefusal(error), (refusal) => new Conflict(refusalOf(refusal))));
}
