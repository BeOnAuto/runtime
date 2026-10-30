import type { Aggregation } from '../document/prediction-document.ts';

export interface MeasureState {
  readonly value: number | null;
  readonly count: number;
  readonly at: number | null;
}

export function emptyMeasure(as: Aggregation): MeasureState {
  return { value: as === 'last' ? null : 0, count: 0, at: null };
}

function lastTaken(state: MeasureState, reading: number, moment: number): MeasureState {
  const later = state.at === null || moment >= state.at;
  return later
    ? { value: reading, count: state.count + 1, at: moment }
    : { value: state.value, count: state.count + 1, at: state.at };
}

export function measureTaken(
  state: MeasureState,
  as: Aggregation,
  reading: number | undefined,
  moment: number,
): MeasureState {
  if (as === 'count') {
    return { value: Number(state.value) + 1, count: state.count + 1, at: null };
  }
  if (reading === undefined) {
    return state;
  }
  return as === 'last'
    ? lastTaken(state, reading, moment)
    : { value: Number(state.value) + reading, count: state.count + 1, at: null };
}

export function cellOf(state: MeasureState | undefined, as: Aggregation): number | null {
  if (state === undefined) {
    return as === 'count' || as === 'sum' ? 0 : null;
  }
  if (as === 'mean') {
    return state.count === 0 ? null : Number(state.value) / state.count;
  }
  return state.value;
}
