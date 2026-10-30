import {
  settle,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
  type OrgRequest,
  type Outcome,
  type RouteRegistration,
  type Settled,
  type Succeeded,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { callerOfAnotherOrg, insufficientScope } from '../authentication/challenges.ts';
import { problemResponse } from '../problem/problem.ts';
import type { RouteHandler, Routes } from '../routes.ts';
import { underTraceParent } from '../tracing/trace-parent.ts';
import { parseCallInput } from './call-input.ts';
import { toHttpResponse } from './outcome-response.ts';

export type RunCall = <S extends Succeeded>(
  call: Effect.Effect<Settled<S>, never, DispatcherServices>,
) => Promise<Settled<S>>;

export interface OperationRoutesOptions {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly runCall: RunCall;
}

function dispatched(
  dispatcher: Dispatcher,
  registration: RouteRegistration,
  c: Context<ApiEnv>,
  request: OrgRequest,
): Effect.Effect<Outcome, never, DispatcherServices> {
  return registration.scope === 'org'
    ? dispatcher.dispatchToOrg(registration, request)
    : dispatcher.dispatchToPlaybook(registration, { ...request, playbook: String(c.req.param('playbook')) });
}

export function handlerFor(
  registration: RouteRegistration,
  { dispatcher, runCall }: OperationRoutesOptions,
  { resource, callContext }: Routes,
): RouteHandler {
  const forbidden = insufficientScope(resource, registration.permissions);
  return async (c) => {
    const org = String(c.req.param('org'));
    const caller = c.get('principal').callerIn(org);
    if (caller === undefined) {
      return problemResponse(callerOfAnotherOrg, forbidden);
    }
    const given = await parseCallInput(c, registration);
    if (Result.isFailure(given)) {
      return problemResponse(given.failure);
    }
    const requestId = c.get('requestId');
    const call = dispatched(dispatcher, registration, c, { caller, org, ...given.success });
    const inTheCall = call.pipe(Effect.provideContext(callContext(c.req.raw)));
    const settled = await runCall(
      underTraceParent(
        settle(inTheCall, c.req.raw.signal).pipe(Effect.annotateLogs({ requestId })),
        c.get('traceParent'),
      ),
    );
    return toHttpResponse(settled, { status: registration.successStatus, signal: c.req.raw.signal, forbidden });
  };
}
