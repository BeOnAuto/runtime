import type { DefinitionPlace, StrippedForms } from '@on.auto/definitions';
import type { InvalidInput, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { checkedExpressions, checkedWithoutGoals, type ExpressionCheck } from '../document/expression-check.ts';
import type { ReadWorkflow } from '../document/workflow-document.ts';
import type { ConnectionEvents } from '../triggers/connection-ports.ts';
import { connectionTriggersChecked } from '../triggers/connection-triggers.ts';

export interface SaveChecks {
  readonly check: ExpressionCheck;
  readonly connectionEvents: ConnectionEvents;
}

export function checkedWhenSaved(
  { check, connectionEvents }: SaveChecks,
  goals: boolean,
): (
  read: ReadWorkflow,
  source: string,
  place: DefinitionPlace,
) => Effect.Effect<StrippedForms, InvalidInput | Unavailable> {
  const expressions = goals ? checkedExpressions(check) : checkedWithoutGoals(check);
  const triggers = connectionTriggersChecked(connectionEvents);
  return (read, _source, place) => Effect.tap(expressions(read), () => triggers(read, place));
}
