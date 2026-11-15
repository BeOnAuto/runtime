import { Effect } from 'effect';

import {
  accessRequestOfOrgCall,
  accessRequestOfPlaybookCall,
  playbookNamedBy,
} from '../access-control/access-request-of-a-call.ts';
import { enforcedBy } from '../access-control/enforcement.ts';
import type { PolicyDecisionPoint } from '../access-control/policy-decision-point.ts';
import { checkedReportingTo, type AskedCall } from '../access-control/report-only.ts';
import type { Runnable } from '../definition/registration.ts';
import { callSummaryOf, type OrgRequest, type PlaybookRequest } from '../dispatch/request.ts';
import type { LivePlaybookStatus, PlaybookRegistry } from '../ledger/playbook-registry.ts';
import type { Rejected } from '../outcome/outcome.ts';
import {
  authorizeOrgCall,
  authorizePlaybookCall,
  confirmOrgExists,
  confirmPlaybookTakesCall,
} from './authorization.ts';

export type DispatcherOptions =
  | { readonly reportOnly?: PolicyDecisionPoint; readonly decidedBy?: never }
  | { readonly decidedBy: PolicyDecisionPoint; readonly reportOnly?: never };

function admittedAs(
  { reportOnly, decidedBy }: DispatcherOptions,
  call: () => AskedCall,
  check: Effect.Effect<void, Rejected>,
): Effect.Effect<void, Rejected> {
  if (decidedBy !== undefined) {
    return enforcedBy(decidedBy, call(), check);
  }
  return reportOnly === undefined ? check : checkedReportingTo(reportOnly, call(), check);
}

function authorizedOrgCall(
  options: DispatcherOptions,
  registration: Runnable<'org'>,
  request: OrgRequest,
): Effect.Effect<void, Rejected> {
  return admittedAs(
    options,
    () => ({
      registration,
      summary: callSummaryOf(registration.name, request, playbookNamedBy(registration, request)),
      request: accessRequestOfOrgCall(registration, request),
    }),
    authorizeOrgCall(registration, request),
  );
}

function authorizedPlaybookCall(
  options: DispatcherOptions,
  registration: Runnable<'playbook'>,
  request: PlaybookRequest,
): Effect.Effect<void, Rejected> {
  return admittedAs(
    options,
    () => ({
      registration,
      summary: callSummaryOf(registration.name, request, request.playbook),
      request: accessRequestOfPlaybookCall(registration, request),
    }),
    authorizePlaybookCall(registration, request),
  );
}

export function admittedOrgCall(
  options: DispatcherOptions,
  registration: Runnable<'org'>,
  request: OrgRequest,
): Effect.Effect<void, Rejected> {
  return Effect.gen(function* () {
    yield* authorizedOrgCall(options, registration, request);
    yield* confirmOrgExists(request);
  });
}

export function admittedPlaybookCall(
  options: DispatcherOptions,
  registration: Runnable<'playbook'>,
  request: PlaybookRequest,
): Effect.Effect<LivePlaybookStatus, Rejected, PlaybookRegistry> {
  return Effect.gen(function* () {
    yield* authorizedPlaybookCall(options, registration, request);
    return yield* confirmPlaybookTakesCall(registration, request);
  });
}
