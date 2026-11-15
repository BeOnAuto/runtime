import { Context, Effect } from 'effect';

import { CallPermission, callPermissionDecidedBy } from '../access-control/call-permission.ts';
import type { PolicyDecisionPoint } from '../access-control/policy-decision-point.ts';
import { Ledger } from '../ledger/ledger.ts';
import { PlaybookRegistry } from '../ledger/playbook-registry.ts';
import { IncidentReporter } from './incident-reporter.ts';

export type DispatcherServices = Ledger | PlaybookRegistry | IncidentReporter;

export const withoutDispatcherServices = Effect.updateContext<never, never>(
  Context.omit(Ledger, PlaybookRegistry, IncidentReporter),
);

export function permittedAsDecidedBy<A, E, R>(
  decisionPoint: PolicyDecisionPoint | undefined,
): (handled: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  if (decisionPoint === undefined) {
    return (handled) => handled;
  }
  const permission = callPermissionDecidedBy(decisionPoint);
  return (handled) => Effect.provideService(handled, CallPermission, permission);
}
