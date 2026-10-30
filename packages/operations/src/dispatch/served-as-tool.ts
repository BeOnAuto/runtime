import { Context } from 'effect';

export const ServedAsTool = Context.Reference<boolean>('@on.auto/operations/ServedAsTool', {
  defaultValue: () => false,
});
