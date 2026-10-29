import type { CallResult } from '@on.auto/operations';

import type { DefinitionArguments } from '../document/definition-arguments.ts';

export function summarizing({ name, input }: DefinitionArguments): CallResult {
  return { status: 'succeeded', output: { summary: `${name} of ${JSON.stringify(input)}` } };
}

export function flakyTwice(_definition: DefinitionArguments, run: number): CallResult {
  return run < 3
    ? { status: 'rejected', reason: 'unavailable', detail: `busy on call ${run}` }
    : { status: 'succeeded', output: { calls: run } };
}

export const fewerThanOneSeat = 'seats, How many seats to hold: expected at least 1.';

export const refusedSeats = [{ pointer: '/input/seats', detail: fewerThanOneSeat }];

export function refusingSeats(): CallResult {
  return { status: 'rejected', reason: 'invalid_input', detail: fewerThanOneSeat, issues: refusedSeats };
}

const outOfCredits: CallResult = {
  status: 'rejected',
  reason: 'conflict',
  detail: 'The account has no credits left for this run',
  kind: 'credits_exhausted',
  because: 'none_left',
  resolve_at: 'https://studio.example.com/billing',
  admission: 'refused',
};

export function admittedOnTheThirdTry(definition: DefinitionArguments, run: number): CallResult {
  return definition.name === 'tally' && run < 3 ? outOfCredits : summarizing(definition);
}
