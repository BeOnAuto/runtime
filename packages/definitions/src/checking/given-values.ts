import { loggedAsTakenFromText, normalizedValue, type GivenArgument } from '@on.auto/operations';
import { Effect, Function, type Schema } from 'effect';

type IssuesOf<Issue> = (value: Schema.Json) => readonly Issue[];

type Normalized<Issue> =
  | { readonly value: Schema.Json; readonly from: 'value' | 'text' }
  | { readonly issues: readonly Issue[] };

function checkedBy<Issue>(issuesOf: IssuesOf<Issue>) {
  return (value: Schema.Json): Effect.Effect<Schema.Json, readonly Issue[]> => {
    const issues = issuesOf(value);
    return issues.length === 0 ? Effect.succeed(value) : Effect.fail(issues);
  };
}

function textOfTheWhole(value: Schema.Json) {
  return typeof value === 'string' ? [{ place: [], text: value }] : [];
}

function loggedWhenTakenFromText<Issue>(given: GivenArgument, normalized: Normalized<Issue>): Effect.Effect<void> {
  return 'from' in normalized && normalized.from === 'text'
    ? loggedAsTakenFromText(given.operation, [given.argument])
    : Effect.void;
}

export function normalizedArgument<Issue>(
  given: GivenArgument,
  value: Schema.Json,
  issuesOf: IssuesOf<Issue>,
): Effect.Effect<Normalized<Issue>> {
  const normalized = normalizedValue({
    value,
    check: checkedBy(issuesOf),
    textsIn: () => textOfTheWhole(value),
    withValuesRead: ([read]) => read.value,
    takes: Function.constTrue,
  });
  return normalized.pipe(
    Effect.match({
      onFailure: (issues): Normalized<Issue> => ({ issues }),
      onSuccess: ({ taken, readFrom }): Normalized<Issue> => ({
        value: taken,
        from: readFrom.length === 0 ? 'value' : 'text',
      }),
    }),
    Effect.tap((taken) => loggedWhenTakenFromText(given, taken)),
  );
}
