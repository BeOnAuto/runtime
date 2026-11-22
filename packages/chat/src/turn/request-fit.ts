import type { ModelRequest } from '@on.auto/reasoning';

import type { TurnStep } from './turn-steps.ts';

export const RESULT_LEFT_OUT =
  'The result of this call was left out to make room in the request. Call the tool again to get it.';

export interface FittedRequest {
  readonly request: ModelRequest;
  readonly leftOut: boolean;
  readonly fits: boolean;
}

interface Position {
  readonly step: number;
  readonly call: number;
}

function positionsOf(steps: readonly TurnStep[]): readonly Position[] {
  const all = steps.flatMap((step, stepIndex) => step.calls.map((_, call) => ({ step: stepIndex, call })));
  return all.slice(0, -1);
}

function withResultLeftOut(steps: readonly TurnStep[], { step, call }: Position): readonly TurnStep[] {
  return steps.map((each, stepIndex) =>
    stepIndex === step
      ? {
          ...each,
          calls: each.calls.map((answered, callIndex) =>
            callIndex === call ? { asked: answered.asked, reply: { text: RESULT_LEFT_OUT, isError: false } } : answered,
          ),
        }
      : each,
  );
}

export function fittedRequest(
  build: (steps: readonly TurnStep[]) => ModelRequest,
  steps: readonly TurnStep[],
  fitsWithin: (request: ModelRequest) => boolean,
): FittedRequest {
  const first = build(steps);
  if (fitsWithin(first)) {
    return { request: first, leftOut: false, fits: true };
  }
  const reduced = positionsOf(steps).reduce<{
    readonly steps: readonly TurnStep[];
    readonly request: ModelRequest;
    readonly fits: boolean;
  }>(
    (state, position) => {
      if (state.fits) {
        return state;
      }
      const next = withResultLeftOut(state.steps, position);
      const request = build(next);
      return { steps: next, request, fits: fitsWithin(request) };
    },
    { steps, request: first, fits: false },
  );
  return { request: reduced.request, leftOut: reduced.request !== first, fits: reduced.fits };
}
