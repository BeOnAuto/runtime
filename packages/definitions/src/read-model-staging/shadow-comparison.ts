import { Effect, Exit, Option } from 'effect';

import { DefinitionsReadModel, pathOf, type StagedReading } from './read-model-stage.ts';
import { differingFieldsOf } from './same-answers.ts';

export type ComparedOutcome = 'matched' | 'mismatched' | 'ignored';

export type ComparedRead =
  | 'get_definition'
  | 'list_definitions'
  | 'definition_page'
  | 'used_by'
  | 'run_start'
  | 'version'
  | 'longest_run';

export interface Comparison {
  readonly outcome: ComparedOutcome;
  readonly differing: readonly string[];
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
  readonly fromTheReadModel: Effect.Effect<Candidate, E, R2>;
  readonly answerOf: (candidate: Candidate) => Today;
  readonly compared: (today: Today, candidate: Candidate) => Effect.Effect<Comparison, never, R3>;
}

export const comparedMessage = 'A read of the definitions was compared with the read model';

function failedComparison(candidateDied: boolean, errors: readonly unknown[]): Comparison {
  if (candidateDied) {
    return { outcome: 'mismatched', differing: ['failed'] };
  }
  const [failed, failedToo] = errors;
  return errors.length === 2 ? comparisonOf(differingFieldsOf(failed, failedToo)) : comparisonOf(['outcome']);
}

function loggedComparison(
  { read, definitionType }: Pick<StagedRead<unknown, unknown, never, unknown, never, never>, 'read' | 'definitionType'>,
  { outcome, differing, counts = {} }: Comparison,
): Effect.Effect<void> {
  const line = outcome === 'mismatched' ? Effect.logWarning(comparedMessage) : Effect.logInfo(comparedMessage);
  return line.pipe(
    Effect.annotateLogs({ read, definition_type: definitionType, outcome, differing: differing.join(','), ...counts }),
  );
}

function comparedRead<Today, E, R, Candidate, R2, R3>(
  staged: StagedRead<Today, E, R, Candidate, R2, R3>,
): Effect.Effect<Today, E, R | R2 | R3> {
  return Effect.gen(function* () {
    const today = yield* Effect.exit(staged.today);
    const candidate = yield* Effect.exit(staged.fromTheReadModel);
    const comparison =
      Exit.isSuccess(today) && Exit.isSuccess(candidate)
        ? yield* staged.compared(today.value, candidate.value)
        : failedComparison(Exit.hasDies(candidate), [
            ...Option.toArray(Exit.findErrorOption(today)),
            ...Option.toArray(Exit.findErrorOption(candidate)),
          ]);
    yield* loggedComparison(staged, comparison);
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
    return yield* path === 'read_model' ? Effect.map(staged.fromTheReadModel, staged.answerOf) : comparedRead(staged);
  });
}
