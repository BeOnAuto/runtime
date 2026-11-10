import { hash } from 'node:crypto';

import type { RenderClock } from '@on.auto/definitions/template';
import { renderedArguments, type ArgumentsFailure } from '@on.auto/definitions/tool-blocks';
import { Result } from 'effect';

import type { DeliveredAs, Replies } from '../tool-blocks/tool-block-schemas.ts';

export interface ReadRequest {
  readonly to: string;
  readonly sent: DeliveredAs;
  readonly key: string;
}

export function readingOf(
  replies: Pick<Replies, 'with'>,
  { to, sent, key }: ReadRequest,
  clock: RenderClock,
): Result.Result<string, ArgumentsFailure> {
  const variables = { to, sent: { ...sent }, conversation: key, since: '' };
  return Result.map(renderedArguments(replies.with, variables, clock), ({ input }) =>
    hash('sha256', JSON.stringify(input), 'hex'),
  );
}
