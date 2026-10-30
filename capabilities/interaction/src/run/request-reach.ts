import { renderClock } from '@on.auto/definitions/template';
import { Unavailable, type PlaybookAddress, type Conflict } from '@on.auto/operations';
import { toolBounds, type ToolAccess, type ToolNotOffered } from '@on.auto/tool-servers';
import type { ToolReference } from '@on.auto/tool-servers/policy';
import { Effect, Result, type Schema } from 'effect';

import { deliveryVariablesOf, renderedArguments, type ArgumentsFailure } from '../tool-blocks/rendered-arguments.ts';
import type { RequestRecord } from './request-record.ts';
import { unworkable } from './request-rendering.ts';

export interface InteractionPorts {
  readonly tools: Pick<ToolAccess, 'named' | 'configured' | 'callOnce'>;
  readonly openRequests: (playbook: PlaybookAddress) => Effect.Effect<number>;
  readonly mostOpenRequests: number;
}

export function offered(
  tools: readonly ToolReference[],
  ports: InteractionPorts,
  playbook: PlaybookAddress,
): Effect.Effect<void, Unavailable> {
  return Effect.mapError(
    ports.tools.named(playbook, tools),
    ({ because, detail }: Pick<ToolNotOffered, 'because' | 'detail'>) =>
      new Unavailable({ detail, kind: 'tool_not_offered', because }),
  );
}

export function roomFor(ports: InteractionPorts, playbook: PlaybookAddress): Effect.Effect<void, Unavailable> {
  return Effect.flatMap(ports.openRequests(playbook), (open) =>
    open < ports.mostOpenRequests
      ? Effect.void
      : Effect.fail(
          new Unavailable({
            detail: `The playbook holds ${open} open requests, the most it may; one must be answered, expire or be cancelled before another is asked`,
            kind: 'requests_full',
          }),
        ),
  );
}

const argumentWords = {
  not_text: 'renders a value that is not text for this request',
  too_long: `renders more than the ${toolBounds.argumentBytes} bytes a call may send for this request`,
  missing_variable: 'reads what this request does not have',
  limit_exceeded: 'cannot be rendered for this request',
  failed: 'cannot be rendered for this request',
} as const;

function argumentsRefusal(failure: ArgumentsFailure): Conflict {
  return failure.reason === 'too_large'
    ? unworkable(
        '/deliver/with',
        `The arguments of the call that delivers the request take ${failure.bytes} bytes, more than the ${toolBounds.argumentBytes} a call may send`,
      )
    : unworkable(
        `/deliver/with/${failure.argument}`,
        `The argument ${failure.argument} of the call that delivers the request ${argumentWords[failure.failure.reason]}`,
      );
}

export interface Asking {
  readonly input: Schema.Json;
  readonly runId: string;
  readonly functionName: string;
}

export function checkedArguments(record: RequestRecord, asking: Asking): Effect.Effect<void, Conflict> {
  if (record.deliver === undefined) {
    return Effect.void;
  }
  const { deliver } = record;
  return Effect.flatMap(renderClock, (clock) =>
    Result.match(renderedArguments(deliver.with, deliveryVariablesOf(record, asking), clock), {
      onSuccess: () => Effect.void,
      onFailure: (failure) => Effect.fail(argumentsRefusal(failure)),
    }),
  );
}
