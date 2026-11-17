import { renderClock } from '@on.auto/definitions/template';
import {
  smallerInputRemedy,
  unworkable,
  type ArgumentsFailure,
  type TextFailure,
} from '@on.auto/definitions/tool-blocks';
import { Unavailable, type PlaybookAddress, type Conflict } from '@on.auto/operations';
import { sendableInWords, type ToolAccess, type ToolNotOffered } from '@on.auto/tool-servers';
import type { ToolReference } from '@on.auto/tool-servers/policy';
import { Effect, Result, type Schema } from 'effect';

import type { ConversationsOf } from '../tellings/telling-routes.ts';
import { deliveryArgumentsOf } from '../tool-blocks/delivery-arguments.ts';
import type { RequestRecord } from './request-record.ts';

export interface InteractionPorts {
  readonly tools: Pick<
    ToolAccess,
    'named' | 'configured' | 'callOnce' | 'listServers' | 'takesConnections' | 'mostRequestBytes' | 'mostRequestBytesTo'
  >;
  readonly openRequests: (playbook: PlaybookAddress) => Effect.Effect<number>;
  readonly mostOpenRequests: number;
  readonly conversationsOf: ConversationsOf;
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

function argumentWords(reason: TextFailure['reason'], most: number): string {
  const words: Readonly<Record<TextFailure['reason'], string>> = {
    not_text: 'renders a value that is not text for this request',
    too_long: `renders more than ${sendableInWords(most)} for this request; ${smallerInputRemedy}`,
    missing_variable: 'reads what this request does not have',
    limit_exceeded: 'cannot be rendered for this request',
    failed: 'cannot be rendered for this request',
  };
  return words[reason];
}

function argumentsRefusal(failure: ArgumentsFailure): Conflict {
  return failure.reason === 'too_large'
    ? unworkable(
        '/deliver/with',
        `The arguments of the call that delivers the request take ${failure.bytes} bytes, more than ${sendableInWords(failure.most)}; ${smallerInputRemedy}`,
      )
    : unworkable(
        `/deliver/with/${failure.argument}`,
        `The argument ${failure.argument} of the call that delivers the request ${argumentWords(failure.failure.reason, failure.most)}`,
      );
}

export interface Asking {
  readonly input: Schema.Json;
  readonly runId: string;
  readonly functionName: string;
}

export function checkedArguments(
  record: RequestRecord,
  asking: Asking,
  mostRequestBytesTo: InteractionPorts['tools']['mostRequestBytesTo'],
): Effect.Effect<void, Conflict> {
  if (record.deliver === undefined) {
    return Effect.void;
  }
  const { deliver } = record;
  return Effect.flatMap(renderClock, (clock) =>
    Result.match(
      deliveryArgumentsOf(deliver.with, record, asking, { clock, mostBytes: mostRequestBytesTo(deliver.server) }),
      {
        onSuccess: () => Effect.void,
        onFailure: (failure) => Effect.fail(argumentsRefusal(failure)),
      },
    ),
  );
}
