import { Effect } from 'effect';

import type { FilterSandbox, FilterSession } from '../filters/filter-verdicts.ts';
import { namedArguments, type ExpressionUnit } from '../programs/expression-units.ts';
import { exhaustedBy, type Evaluation, type ProgramFailure, type ProgramRun } from '../programs/program-run.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import type { AnsweredRequest, PrepareRequest, TestRequest } from './evaluation-messages.ts';

export interface EvaluationCalls {
  readonly ready: () => Promise<void>;
  readonly call: (request: AnsweredRequest, waitMs: number) => ProgramRun;
  readonly release: (unit: number) => void;
}

export interface EvaluationAsks {
  readonly ready: () => Promise<void>;
  readonly prepare: (request: PrepareRequest, waitMs: number) => Promise<ProgramRun>;
  readonly test: (request: TestRequest, waitMs: number) => Promise<ProgramRun | 'unprepared'>;
  readonly release: (unit: number) => void;
}

export interface Evaluations {
  readonly machine: MachineSandbox;
  readonly filters: FilterSandbox;
}

interface Remote {
  readonly calls: EvaluationCalls;
  readonly clock: () => number;
  readonly unit: number;
}

interface Asked {
  readonly asks: EvaluationAsks;
  readonly clock: () => number;
  readonly unit: number;
}

const answeredNothing: ProgramRun = { ran: 'answered', text: 'null', work: 0 };

function endingOf(run: ProgramRun): ProgramFailure | undefined {
  return run.ran === 'exhausted' && (run.limit === 'memory' || run.limit === 'deadline')
    ? exhaustedBy(run.limit, 0)
    : undefined;
}

function remoteUnit({ calls, clock, unit }: Remote): ExpressionUnit {
  const state: { ended: ProgramFailure | undefined } = { ended: undefined };
  return {
    evaluate: (source, values, evaluation) => {
      if (state.ended !== undefined) {
        return state.ended;
      }
      const request: AnsweredRequest = {
        kind: 'evaluate',
        unit,
        source,
        ...namedArguments(source, values),
        evaluation,
      };
      const run = calls.call(request, evaluation.deadlineAt - clock());
      state.ended = endingOf(run);
      return run;
    },
    close: () => {
      calls.release(unit);
    },
  };
}

function remoteFilterSession({ asks, clock, unit }: Asked, opening: Evaluation): FilterSession {
  const sources: string[] = [];
  const prepareWaitMs = opening.deadlineAt - clock();
  const state: { prepared: Promise<ProgramRun> | undefined } = { prepared: undefined };
  const prepared = (): Promise<ProgramRun> => {
    state.prepared ??=
      sources.length === 0
        ? Promise.resolve(answeredNothing)
        : asks.prepare({ kind: 'prepare', unit, sources, evaluation: opening }, prepareWaitMs);
    return state.prepared;
  };
  return {
    define: (source) => {
      const test = sources.push(source) - 1;
      const tested = async (value: string, evaluation: Evaluation, waitMs: number): Promise<ProgramRun> => {
        const frozen = await prepared();
        if (frozen.ran !== 'answered') {
          return frozen;
        }
        const run = await asks.test({ kind: 'test', unit, test, value, evaluation }, waitMs);
        if (run !== 'unprepared') {
          return run;
        }
        state.prepared = undefined;
        return tested(value, evaluation, waitMs);
      };
      return (value, evaluation) => tested(value, evaluation, evaluation.deadlineAt - clock());
    },
    freeze: async () => {
      const frozen = await prepared();
      return frozen.ran === 'answered' ? undefined : frozen;
    },
    close: () => {
      asks.release(unit);
    },
  };
}

export function remoteEvaluations(calls: EvaluationCalls, asks: EvaluationAsks, clock: () => number): Evaluations {
  const units = { last: 0 };
  const nextUnit = (): number => {
    units.last += 1;
    return units.last;
  };
  return {
    machine: {
      reserve: Effect.promise(calls.ready),
      unit: () => remoteUnit({ calls, clock, unit: nextUnit() }),
      clock,
    },
    filters: {
      session: async (opening) => {
        await asks.ready();
        return remoteFilterSession({ asks, clock, unit: nextUnit() }, opening());
      },
      clock,
    },
  };
}
