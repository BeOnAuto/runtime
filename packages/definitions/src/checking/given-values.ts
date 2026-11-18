import { Cause, Effect, Option, Schema } from 'effect';

type IssuesOf<Issue> = (value: Schema.Json) => readonly Issue[];

type Normalized<Issue> =
  | { readonly value: Schema.Json; readonly from: 'value' | 'text' }
  | { readonly issues: readonly Issue[] };

interface GivenArgument {
  readonly operation: string;
  readonly argument: string;
}

const takenFromText = 'An argument given as JSON text was taken as the value the text holds';

const jsonHeldIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

function overflowedTheStack<E>(cause: Cause.Cause<E>): boolean {
  return Cause.squash(cause) instanceof RangeError;
}

function heldValueTaken<Issue>(text: string, issuesOf: IssuesOf<Issue>): Effect.Effect<Option.Option<Schema.Json>> {
  return Effect.catchCauseIf(
    Effect.sync(() => Option.filter(jsonHeldIn(text), (held) => issuesOf(held).length === 0)),
    overflowedTheStack,
    () => Effect.succeedNone,
  );
}

function takenAs<Issue>(from: 'value' | 'text', value: Schema.Json): Normalized<Issue> {
  return { value, from };
}

function refusedWith<Issue>(issues: readonly Issue[]): Normalized<Issue> {
  return { issues };
}

function normalizedValueOf<Issue>(given: Schema.Json, issuesOf: IssuesOf<Issue>): Effect.Effect<Normalized<Issue>> {
  return Effect.suspend(() => {
    const issues = issuesOf(given);
    if (issues.length === 0) {
      return Effect.succeed(takenAs<Issue>('value', given));
    }
    const held = typeof given === 'string' ? heldValueTaken(given, issuesOf) : Effect.succeedNone;
    return Effect.map(
      held,
      Option.match({ onNone: () => refusedWith(issues), onSome: (value) => takenAs<Issue>('text', value) }),
    );
  });
}

function loggedWhenTakenFromText<Issue>(
  { operation, argument }: GivenArgument,
  normalized: Normalized<Issue>,
): Effect.Effect<void> {
  return 'from' in normalized && normalized.from === 'text'
    ? Effect.logInfo(takenFromText).pipe(Effect.annotateLogs({ operation, argument }))
    : Effect.void;
}

export function normalizedArgument<Issue>(
  given: GivenArgument,
  value: Schema.Json,
  issuesOf: IssuesOf<Issue>,
): Effect.Effect<Normalized<Issue>> {
  return Effect.tap(normalizedValueOf(value, issuesOf), (normalized) => loggedWhenTakenFromText(given, normalized));
}
