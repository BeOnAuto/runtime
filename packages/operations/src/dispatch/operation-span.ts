import { Effect, type Tracer } from 'effect';

import type { Runnable } from '../definition/registration.ts';
import type { Outcome, Rejected, Succeeded } from '../outcome/outcome.ts';
import { withErrorBoundary } from './error-boundary.ts';
import type { IncidentReporter } from './incident-reporter.ts';
import { callSummaryOf, type OrgRequest, type PlaybookRequest } from './request.ts';

type SpanAttributes = Readonly<Record<string, string | number>>;

const succeeded: SpanAttributes = { 'auto.on.outcome': 'succeeded' };

function chainOf({ playbook, lineage, depth, callDepth }: PlaybookRequest): SpanAttributes {
  return {
    'auto.on.playbook': playbook,
    ...(depth === undefined ? {} : { 'auto.on.depth': depth }),
    ...(callDepth === undefined ? {} : { 'auto.on.call_depth': callDepth }),
    ...(lineage === undefined || lineage.correlationId === null
      ? {}
      : { 'auto.on.correlation_id': lineage.correlationId }),
  };
}

function requestAttributesOf(registration: Runnable, request: OrgRequest | PlaybookRequest): SpanAttributes {
  return {
    'auto.on.operation': registration.name,
    'auto.on.operation.kind': registration.kind,
    'auto.on.org': request.org,
    'auto.on.caller': request.caller.id,
    ...('playbook' in request ? chainOf(request) : {}),
  };
}

function rejectionOf({ reason, kind, because }: Rejected): SpanAttributes {
  return {
    'auto.on.outcome': 'rejected',
    'error.type': reason,
    ...(kind === undefined ? {} : { 'auto.on.rejection.kind': kind }),
    ...(because === undefined ? {} : { 'auto.on.rejection.because': because }),
  };
}

function traced<A extends Succeeded, R>(
  name: string,
  attributes: SpanAttributes,
  pipeline: Effect.Effect<A, Rejected, R>,
): Effect.Effect<A, Rejected, Exclude<R, Tracer.ParentSpan>> {
  return pipeline.pipe(
    Effect.tap(() => Effect.annotateCurrentSpan(succeeded)),
    Effect.tapError((rejection) => Effect.annotateCurrentSpan(rejectionOf(rejection))),
    Effect.result,
    Effect.withSpan(name, { attributes }),
    Effect.flatMap(Effect.fromResult),
  );
}

export function withinOperation<A extends Succeeded, R>(
  registration: Runnable,
  request: OrgRequest | PlaybookRequest,
  pipeline: Effect.Effect<A, Rejected, R>,
): Effect.Effect<Outcome<A>, never, Exclude<R, Tracer.ParentSpan> | IncidentReporter> {
  const playbook = 'playbook' in request ? request.playbook : undefined;
  return withErrorBoundary(
    traced(registration.name, requestAttributesOf(registration, request), pipeline),
    callSummaryOf(registration.name, request, playbook),
  );
}
