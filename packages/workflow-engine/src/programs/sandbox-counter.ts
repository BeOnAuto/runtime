import { exhaustedBy, type Limit, type ProgramFailure } from './program-run.ts';

interface Counted {
  readonly budget: number;
  readonly deadlineAt: number;
}

export interface Counter {
  readonly interrupt: () => boolean;
  readonly drained: <Result>(during: () => Result) => Result;
  readonly begin: (counted: Counted) => void;
  readonly aside: <Result>(budget: number, during: () => Result) => Result;
  readonly unbounded: <Result>(during: () => Result) => Result;
  readonly checkpoints: () => number;
  readonly ending: () => ProgramFailure | undefined;
  readonly broke: (thrown: unknown) => ProgramFailure;
  readonly broken: () => boolean;
}

interface CounterState {
  draining: boolean;
  checkpoints: number;
  budget: number;
  deadlineAt: number;
  ending: Limit | undefined;
  broken: boolean;
}

function endingBy(limit: Limit | undefined, checkpoints: number): ProgramFailure | undefined {
  return limit === undefined ? undefined : exhaustedBy(limit, checkpoints);
}

function brokenBy(thrown: unknown, refused: boolean, checkpoints: number): ProgramFailure {
  if (refused) {
    return exhaustedBy('memory', checkpoints);
  }
  if (thrown instanceof RangeError) {
    return exhaustedBy('stack', checkpoints);
  }
  throw thrown;
}

export function counterOf(refusedGrowth: () => boolean, clock: () => number): Counter {
  const unbounded = { budget: Number.POSITIVE_INFINITY, deadlineAt: Number.POSITIVE_INFINITY };
  const state: CounterState = { draining: false, checkpoints: 0, ...unbounded, ending: undefined, broken: false };
  const reached = (): Limit | undefined => {
    if (state.checkpoints > state.budget) {
      return 'work';
    }
    if (refusedGrowth()) {
      return 'memory';
    }
    return clock() > state.deadlineAt ? 'deadline' : undefined;
  };
  const within = <Result>(changes: Partial<CounterState>, during: () => Result): Result => {
    const saved = { ...state };
    Object.assign(state, changes);
    try {
      return during();
    } finally {
      Object.assign(state, { ...saved, ending: undefined, broken: state.broken });
    }
  };
  return {
    interrupt: () => {
      state.checkpoints += state.draining ? 0 : 1;
      state.ending ??= state.draining ? undefined : reached();
      return state.draining || state.ending !== undefined;
    },
    drained: (during) => within({ draining: true }, during),
    begin: ({ budget, deadlineAt }) => {
      Object.assign(state, { checkpoints: 0, budget, deadlineAt, ending: undefined });
    },
    aside: (budget, during) => within({ budget, checkpoints: 0 }, during),
    unbounded: (during) => within({ ...unbounded, checkpoints: 0, ending: undefined }, during),
    checkpoints: () => state.checkpoints,
    ending: () => endingBy(state.ending ?? (refusedGrowth() ? 'memory' : undefined), state.checkpoints),
    broke: (thrown) => {
      state.broken = true;
      return brokenBy(thrown, refusedGrowth(), state.checkpoints);
    },
    broken: () => state.broken,
  };
}
