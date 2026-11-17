import { hash } from 'node:crypto';

import { renderedArguments, type ArgumentsFailure, type RenderedArguments } from '@on.auto/definitions/tool-blocks';
import { Result } from 'effect';

import type { DeliveredAs, Replies } from '../tool-blocks/tool-block-schemas.ts';
import type { CallRendering } from './call-rendering.ts';

interface ReadRequest {
  readonly to: string;
  readonly sent: DeliveredAs;
  readonly key: string;
}

export function readArgumentsOf(
  replies: Pick<Replies, 'with'>,
  { to, sent, key }: ReadRequest,
  since: string,
  { clock, mostBytes }: CallRendering,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return renderedArguments(replies.with, { to, sent: { ...sent }, conversation: key, since }, clock, mostBytes);
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
