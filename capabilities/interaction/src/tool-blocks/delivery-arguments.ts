import type { RenderClock } from '@on.auto/definitions/template';
import {
  argumentsFailureWords,
  momentVariables,
  renderedArguments,
  smallerInputRemedy,
  type ArgumentsFailure,
  type RenderedArguments,
  type Templates,
} from '@on.auto/definitions/tool-blocks';
import type { Result, Schema } from 'effect';

import type { RequestRecord } from '../run/request-record.ts';

export interface DeliveryContext {
  readonly input: Schema.Json;
  readonly runId: string;
  readonly functionName: string;
}

export function deliveryVariablesOf(record: RequestRecord, { input, runId, functionName }: DeliveryContext) {
  return {
    ...momentVariables(input, record.requested_at),
    to: record.to,
    message: record.message,
    run_id: runId,
    function: functionName,
    expires_at: record.expires_at,
    answer_schema: record.answer_schema ?? null,
    ...(record.rendered === undefined ? {} : { rendered: record.rendered }),
  };
}

export function deliveryArgumentsOf(
  templates: Templates,
  record: RequestRecord,
  context: DeliveryContext,
  clock: RenderClock,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return renderedArguments(templates, deliveryVariablesOf(record, context), clock);
}

export function undeliverableWords(failure: ArgumentsFailure): string {
  return argumentsFailureWords(failure, 'the call that delivers the request', smallerInputRemedy);
}
