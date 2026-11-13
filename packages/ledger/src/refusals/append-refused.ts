import { Conflict, ConflictKindSchema, type ConflictKind } from '@on.auto/operations';
import { Data, Option, Schema } from 'effect';

const appendRefusedTag = 'append_refused';

interface Refusal {
  readonly detail: string;
  readonly kind?: ConflictKind;
}

interface StreamRefusal extends Refusal {
  readonly stream: string;
}

class AppendRefused extends Data.TaggedError(appendRefusedTag)<StreamRefusal> {}

function refusalOf({ detail, kind }: Refusal): Refusal {
  return kind === undefined ? { detail } : { detail, kind };
}

export function appendRefusedAs(conflict: Pick<Conflict, 'detail' | 'kind'>, stream: string): AppendRefused {
  return new AppendRefused({ ...refusalOf(conflict), stream });
}

const refusalFields = {
  _tag: Schema.Literal(appendRefusedTag),
  detail: Schema.String,
  kind: Schema.optionalKey(ConflictKindSchema),
};

const decodeRefusal = Schema.decodeUnknownOption(Schema.Struct(refusalFields));

const decodeStreamRefusal = Schema.decodeUnknownOption(Schema.Struct({ ...refusalFields, stream: Schema.String }));

export function conflictOfARefusal(error: unknown): Conflict | undefined {
  return Option.getOrUndefined(Option.map(decodeRefusal(error), (refusal) => new Conflict(refusalOf(refusal))));
}

interface RefusedStream {
  readonly stream: string;
  readonly conflict: Conflict;
}

export function refusedStreamOf(error: unknown): RefusedStream | undefined {
  return Option.getOrUndefined(
    Option.map(decodeStreamRefusal(error), (refusal) => ({
      stream: refusal.stream,
      conflict: new Conflict(refusalOf(refusal)),
    })),
  );
}
