import { Cause, Effect, Exit, Option } from 'effect';

import { ReadModelRefused, type RefusedBecause } from '../read-model-reads/read-model-refused.ts';
import { DefinitionsReadModel, pathOf, type StagedReading } from './read-model-stage.ts';
import { differingFieldsOf } from './same-answers.ts';

export type ComparedOutcome = 'matched' | 'mismatched' | 'ignored';

export type ComparedRead =
  | 'get_definition'
  | 'triggers_since'
  | 'list_definitions'
  | 'definition_page'
  | 'used_by'
  | 'run_start'
  | 'version'
  | 'longest_run';

export interface Comparison {
  readonly outcome: ComparedOutcome;
  readonly differing: readonly string[];
  readonly failedKind?: string;
  readonly counts?: Readonly<Record<string, number>>;
}

export const matched: Comparison = { outcome: 'matched', differing: [] };

export function comparisonOf(differing: readonly string[]): Comparison {
  return differing.length === 0 ? matched : { outcome: 'mismatched', differing };
}

export interface StagedRead<Today, E, R, Candidate, R2, R3> {
  readonly read: ComparedRead;
  readonly reading: StagedReading;
  readonly definitionType: string;
  readonly involved: readonly string[];
  readonly today: Effect.Effect<Today, E, R>;
  readonly fromTheReadModel: Effect.Effect<Candidate, E | ReadModelRefused, R2>;
  readonly answerOf: (candidate: Candidate) => Today;
  readonly compared: (today: Today, candidate: Candidate) => Effect.Effect<Comparison, never, R3>;
  readonly answerCompared?: (today: Today, candidate: Candidate) => Today;
}

type Described = Pick<StagedRead<unknown, unknown, never, unknown, never, never>, 'read' | 'definitionType'>;

export const comparedMessage = 'A read of the definitions was compared with the read model';

export const fellBackMessage = "A read of the definitions fell back to today's path";

export const candidateBudgetMs = 1000;

const timedOut: Comparison = { outcome: 'mismatched', differing: ['timed_out'] };

function kindOf(failure: unknown): string {
  const tag: unknown = typeof failure === 'object' && failure !== null ? Reflect.get(failure, '_tag') : undefined;
  if (typeof tag === 'string') {
    return tag;
  }
  return failure instanceof Error ? failure.name : typeof failure;
}

function failed(failure: unknown): Comparison {
  return { outcome: 'mismatched', differing: ['failed'], failedKind: kindOf(failure) };
}

interface Failures {
  readonly died: readonly unknown[];
  readonly today: readonly unknown[];
  readonly candidate: readonly unknown[];
}

function failedComparison({ died, today, candidate }: Failures): Comparison {
  const [defect] = died;
  if (died.length > 0) {
    return failed(defect);
  }
  const [todayError] = today;
  const [candidateError] = candidate;
  if (today.length === 0 || candidate.length === 0) {
    return { ...comparisonOf(['outcome']), failedKind: kindOf(candidateError ?? todayError) };
  }
  return comparisonOf(differingFieldsOf(todayError, candidateError));
}

export function loggedComparison(
  { read, definitionType }: Described,
  { outcome, differing, failedKind, counts = {} }: Comparison,
): Effect.Effect<void> {
  const line = outcome === 'mismatched' ? Effect.logWarning(comparedMessage) : Effect.logInfo(comparedMessage);
  const kind = failedKind === undefined ? {} : { failed_kind: failedKind };
  return line.pipe(
    Effect.annotateLogs({
      read,
      definition_type: definitionType,
      outcome,
      differing: differing.join(','),
      ...kind,
      ...counts,
    }),
  );
}

function observed<Today, E, R, Candidate, R2, R3>(
  staged: StagedRead<Today, E, R, Candidate, R2, R3>,
  todayOf: () => Exit.Exit<Today, E>,
): Effect.Effect<readonly Candidate[], never, R2 | R3> {
  return Effect.gen(function* () {
    const today = todayOf();
    const timed = yield* Effect.timeoutOption(Effect.exit(staged.fromTheReadModel), candidateBudgetMs);
    const candidate = Option.getOrUndefined(timed);
    if (candidate === undefined) {
      yield* Effect.exit(loggedComparison(staged, timedOut));
      return [];
    }
    const comparing =
      Exit.isSuccess(today) && Exit.isSuccess(candidate)
        ? staged.compared(today.value, candidate.value)
        : Effect.sync(() =>
            failedComparison({
              died: Exit.isFailure(candidate) && Cause.hasDies(candidate.cause) ? [Cause.squash(candidate.cause)] : [],
              today: Option.toArray(Exit.findErrorOption(today)),
              candidate: Option.toArray(Exit.findErrorOption(candidate)),
            }),
          );
    const compared = yield* Effect.exit(comparing);
    yield* Effect.exit(
      loggedComparison(staged, Exit.isSuccess(compared) ? compared.value : failed(Cause.squash(compared.cause))),
    );
    return Exit.isSuccess(candidate) ? [candidate.value] : [];
  }).pipe(Effect.catchCause(() => Effect.succeed([])));
}

function comparedRead<Today, E, R, Candidate, R2, R3>(
  staged: StagedRead<Today, E, R, Candidate, R2, R3>,
): Effect.Effect<Today, E, R | R2 | R3> {
  return Effect.gen(function* () {
    const today = yield* Effect.exit(staged.today);
    const [seen] = yield* observed(staged, () => today);
    const answerCompared = staged.answerCompared;
    return yield* Exit.isSuccess(today) && seen !== undefined && answerCompared !== undefined
      ? Effect.sync(() => answerCompared(today.value, seen)).pipe(Effect.catchCause(() => Effect.succeed(today.value)))
      : today;
  });
}

interface Fallen {
  readonly failure: unknown;
  readonly died: boolean;
  readonly todayFailedAs: string | undefined;
}

interface FallBack {
  readonly because: RefusedBecause | 'failed';
  readonly failedKind?: string;
  readonly level: 'error' | 'warning' | 'info';
}

function fallBackOf({ failure, died, todayFailedAs }: Fallen): FallBack {
  if (failure instanceof ReadModelRefused) {
    return { because: failure.because, level: 'warning' };
  }
  const failedKind = kindOf(failure);
  return { because: 'failed', failedKind, level: !died && failedKind === todayFailedAs ? 'info' : 'error' };
}

function fellBack(described: Described, { because, failedKind, level }: FallBack): Effect.Effect<void> {
  const logged = { error: Effect.logError, warning: Effect.logWarning, info: Effect.logInfo }[level];
  const kind = failedKind === undefined ? {} : { failed_kind: failedKind };
  return logged(fellBackMessage).pipe(
    Effect.annotateLogs({ read: described.read, definition_type: described.definitionType, because, ...kind }),
  );
}

function fromTheReadModelOrToday<Today, E, R, Candidate, R2, R3>(
  staged: StagedRead<Today, E, R, Candidate, R2, R3>,
): Effect.Effect<Today, E, R | R2> {
  return Effect.gen(function* () {
    const candidate = yield* Effect.exit(staged.fromTheReadModel);
    if (Exit.isSuccess(candidate)) {
      return staged.answerOf(candidate.value);
    }
    const today = yield* Effect.exit(staged.today);
    const todayFailed = Exit.isFailure(today) && !Cause.hasDies(today.cause);
    const fallen = {
      failure: Cause.squash(candidate.cause),
      died: Cause.hasDies(candidate.cause),
      todayFailedAs: todayFailed ? kindOf(Cause.squash(today.cause)) : undefined,
    };
    yield* Effect.exit(fellBack(staged, fallBackOf(fallen)));
    return yield* today;
  });
}

export function stagedRead<Today, E, R, Candidate, R2, R3>(
  staged: StagedRead<Today, E, R, Candidate, R2, R3>,
): Effect.Effect<Today, E, R | R2 | R3> {
  return Effect.gen(function* () {
    const path = pathOf(yield* DefinitionsReadModel, staged.reading, staged.involved);
    if (path === 'today') {
      return yield* staged.today;
    }
    return yield* path === 'read_model' ? fromTheReadModelOrToday(staged) : comparedRead(staged);
  });
}
