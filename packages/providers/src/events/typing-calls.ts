import { renderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import { Effect, Result } from 'effect';

import { isRefusedForTheAccount, type Conversations } from '../entry/conversation-parts.ts';
import type { ThroughTheConnection } from '../subscriptions/subscription-ports.ts';

type Typing = NonNullable<Conversations['typing']>;

interface RepliedIn {
  readonly to: string;
  readonly sent: { readonly conversation: string; readonly id: string };
  readonly reply: { readonly id: string; readonly to: string };
}

interface TypingAsked {
  readonly org: string;
  readonly playbook: string;
  readonly connection: string;
  readonly typing: Typing;
  readonly failureCodes: Parameters<typeof isRefusedForTheAccount>[2];
  readonly repliedIn: RepliedIn;
}

type TypingShown = 'shown' | 'refused' | 'failed';

const noLine = '';

export function typingShownThrough(
  through: Pick<ThroughTheConnection, 'callOnce' | 'mostRequestBytesTo'>,
  { org, playbook, connection, typing, failureCodes, repliedIn }: TypingAsked,
): Effect.Effect<TypingShown> {
  return Effect.gen(function* () {
    const variables = { ...repliedIn, message: noLine };
    const mostBytes = through.mostRequestBytesTo(connection);
    const rendered = renderedArguments(typing.with, variables, yield* renderClock, mostBytes);
    if (Result.isFailure(rendered)) {
      return 'failed';
    }
    const reference = { server: connection, tool: typing.tool };
    const { input } = rendered.success;
    const called = yield* through.callOnce({ org, playbook, reference, input, meta: {}, recordContent: false });
    if (called.kind === 'answered' && called.outcome === 'result') {
      return 'shown';
    }
    return isRefusedForTheAccount(called, typing, failureCodes) ? 'refused' : 'failed';
  });
}
