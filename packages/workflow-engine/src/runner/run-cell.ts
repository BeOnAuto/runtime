import { raised } from '../dsl/raised-error.ts';
import { mostStepsWithoutWaiting } from '../machine/limits.ts';
import type { RunState, TaskFrame, ValueId } from '../machine/run-state.ts';
import { drawOf } from '../machine/seeded-random.ts';

interface Run {
  readonly state: RunState;
  readonly context: ValueId;
  readonly root: TaskFrame | null;
  readonly runs: Readonly<Record<string, number>>;
  readonly stepsWithoutWaiting: number;
  readonly draws: number;
}

export interface RunCell {
  readonly get: () => Run;
  readonly update: (change: Partial<Run>) => void;
}

export interface Counters {
  readonly nextRun: (reference: string) => number;
  readonly step: (reference: string) => void;
  readonly beforeWaiting: () => void;
  readonly random: () => number;
}

export function runCellOf(state: RunState): RunCell {
  const cell = {
    run: {
      state,
      context: state.machine.context,
      root: state.machine.root,
      runs: state.runs,
      stepsWithoutWaiting: state.stepsWithoutWaiting,
      draws: state.random.draws,
    },
  };
  return {
    get: () => cell.run,
    update: (change) => {
      cell.run = { ...cell.run, ...change };
    },
  };
}

export function countersOf(cell: RunCell, mostSteps: number = mostStepsWithoutWaiting): Counters {
  return {
    nextRun: (reference) => {
      const next = (cell.get().runs[reference] ?? 0) + 1;
      cell.update({ runs: { ...cell.get().runs, [reference]: next } });
      return next;
    },
    step: (reference) => {
      const steps = cell.get().stepsWithoutWaiting + 1;
      cell.update({ stepsWithoutWaiting: steps });
      if (steps > mostSteps) {
        throw raised(
          'runtime',
          500,
          `The workflow ran ${mostSteps} tasks without waiting for anything; it would never end`,
          reference,
        );
      }
    },
    beforeWaiting: () => {
      cell.update({ stepsWithoutWaiting: 0 });
    },
    random: () => {
      const { state, draws } = cell.get();
      cell.update({ draws: draws + 1 });
      return drawOf(state.random.seed, draws);
    },
  };
}
