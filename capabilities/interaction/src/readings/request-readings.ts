import { hash } from 'node:crypto';

import { renderedArguments, type ArgumentsFailure, type RenderedArguments } from '@on.auto/definitions/tool-blocks';
import { Result, type Schema } from 'effect';

import type { KeptRequest } from '../replies/reply-taking.ts';
import type { DeliveredAs, Replies } from '../tool-blocks/tool-block-schemas.ts';
import type { CallRendering } from './call-rendering.ts';

interface ReadRequest {
  readonly to: string;
  readonly sent: DeliveredAs;
  readonly key: string;
  readonly input?: Schema.Json;
}

export type RequestInputs = ReadonlyMap<string, Schema.Json>;

export function readRequestOf(request: KeptRequest, key: string, inputs: RequestInputs): ReadRequest {
  const input = inputs.get(request.runId);
  return { to: request.row.party, sent: request.sent, key, ...(input === undefined ? {} : { input }) };
}

function variablesOf({ to, sent, key, input }: ReadRequest, since: string) {
  return { ...(input === undefined ? {} : { input }), to, sent: { ...sent }, conversation: key, since };
}

export function readArgumentsOf(
  replies: Pick<Replies, 'with'>,
  request: ReadRequest,
  since: string,
  { clock, mostBytes }: CallRendering,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return renderedArguments(replies.with, variablesOf(request, since), clock, mostBytes);
}

export function readingOf(
  replies: Pick<Replies, 'with'>,
  request: ReadRequest,
  rendering: CallRendering,
): Result.Result<string, ArgumentsFailure> {
  return Result.map(readArgumentsOf(replies, request, '', rendering), ({ input }) =>
    hash('sha256', JSON.stringify(input), 'hex'),
  );
}

export function readNamesItsMessage(
  replies: Pick<Replies, 'with'>,
  request: ReadRequest,
  rendering: CallRendering,
): boolean {
  const readOf = (sent: DeliveredAs) =>
    Result.map(readArgumentsOf(replies, { ...request, sent }, '', rendering), ({ input }) => JSON.stringify(input));
  const asSent = Result.getOrUndefined(readOf(request.sent));
  const withoutIt = Result.getOrUndefined(readOf({ ...request.sent, id: '' }));
  return asSent !== undefined && withoutIt !== undefined && asSent !== withoutIt;
}
