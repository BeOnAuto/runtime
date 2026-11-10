import { hash } from 'node:crypto';

import type { RenderClock } from '@on.auto/definitions/template';
import { renderedArguments, type ArgumentsFailure, type RenderedArguments } from '@on.auto/definitions/tool-blocks';
import { Result } from 'effect';

import type { DeliveredAs, Replies } from '../tool-blocks/tool-block-schemas.ts';

interface ReadRequest {
  readonly to: string;
  readonly sent: DeliveredAs;
  readonly key: string;
}

export function readArgumentsOf(
  replies: Pick<Replies, 'with'>,
  { to, sent, key }: ReadRequest,
  since: string,
  clock: RenderClock,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return renderedArguments(replies.with, { to, sent: { ...sent }, conversation: key, since }, clock);
}

export function readingOf(
  replies: Pick<Replies, 'with'>,
  request: ReadRequest,
  clock: RenderClock,
): Result.Result<string, ArgumentsFailure> {
  return Result.map(readArgumentsOf(replies, request, '', clock), ({ input }) =>
    hash('sha256', JSON.stringify(input), 'hex'),
  );
}

export function readNamesItsMessage(replies: Pick<Replies, 'with'>, request: ReadRequest, clock: RenderClock): boolean {
  const readOf = (sent: DeliveredAs) =>
    Result.map(readArgumentsOf(replies, { ...request, sent }, '', clock), ({ input }) => JSON.stringify(input));
  const asSent = Result.getOrUndefined(readOf(request.sent));
  const withoutIt = Result.getOrUndefined(readOf({ ...request.sent, id: '' }));
  return asSent !== undefined && withoutIt !== undefined && asSent !== withoutIt;
}
