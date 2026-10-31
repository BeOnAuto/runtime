import { Context } from 'effect';

type ServesOperation = (name: string) => boolean;

function servesEveryOperation(): boolean {
  return true;
}

export const OperationsServed = Context.Reference<ServesOperation>('@on.auto/operations/OperationsServed', {
  defaultValue: () => servesEveryOperation,
});
