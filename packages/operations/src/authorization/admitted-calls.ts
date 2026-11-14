import { Effect } from 'effect';

import {
  accessRequestOfOrgCall,
  accessRequestOfPlaybookCall,
  playbookNamedBy,
} from '../access-control/access-request-of-a-call.ts';
import type { PolicyDecisionPoint } from '../access-control/policy-decision-point.ts';
import { checkedReportingTo } from '../access-control/report-only.ts';
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

export interface DispatcherOptions {
  readonly reportOnly?: PolicyDecisionPoint;
}

function authorizedOrgCall(
  { reportOnly }: DispatcherOptions,
  registration: Runnable<'org'>,
  request: OrgRequest,
): Effect.Effect<void, Rejected> {
  const check = authorizeOrgCall(registration, request);
  if (reportOnly === undefined) {
    return check;
  }
  return checkedReportingTo(
    reportOnly,
    {
      registration,
      summary: callSummaryOf(registration.name, request, playbookNamedBy(registration, request)),
      request: accessRequestOfOrgCall(registration, request),
    },
    check,
  );
}

function authorizedPlaybookCall(
  { reportOnly }: DispatcherOptions,
  registration: Runnable<'playbook'>,
  request: PlaybookRequest,
): Effect.Effect<void, Rejected> {
  const check = authorizePlaybookCall(registration, request);
  if (reportOnly === undefined) {
    return check;
  }
  return checkedReportingTo(
    reportOnly,
    {
      registration,
      summary: callSummaryOf(registration.name, request, request.playbook),
      request: accessRequestOfPlaybookCall(registration, request),
    },
    check,
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
