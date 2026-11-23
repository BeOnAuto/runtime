import { renderClock } from '@on.auto/definitions/template';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import type { CalledOnce } from '@on.auto/tool-servers';
import { Effect, Result } from 'effect';

import { isRefusedForTheAccount, type Conversations } from '../entry/conversation-parts.ts';
import type { ThroughTheConnection } from '../subscriptions/subscription-ports.ts';

type Typing = NonNullable<Conversations['typing']>;

interface RepliedIn {
  readonly to: string;
  readonly sent: { readonly conversation: string; readonly id: string };
  readonly reply: { readonly id: string; readonly to: string };
}

interface TypingShowing {
  readonly typing: Typing;
  readonly failureCodes: Parameters<typeof isRefusedForTheAccount>[2];
  readonly repliedIn: RepliedIn;
}

interface TypingAsked extends TypingShowing {
  readonly org: string;
  readonly playbook: string;
  readonly connection: string;
}

type TypingShown = 'shown' | 'refused' | 'failed';

type ToolCalled = (tool: string, input: Readonly<Record<string, unknown>>) => Effect.Effect<CalledOnce | undefined>;

const noLine = '';

export function typingShownBy(
  called: ToolCalled,
  mostBytes: number,
  { typing, failureCodes, repliedIn }: TypingShowing,
): Effect.Effect<TypingShown> {
  return Effect.gen(function* () {
    const variables = { ...repliedIn, message: noLine };
    const rendered = renderedArguments(typing.with, variables, yield* renderClock, mostBytes);
    if (Result.isFailure(rendered)) {
      return 'failed';
    }
    const answered = yield* called(typing.tool, rendered.success.input);
    if (answered === undefined) {
      return 'failed';
    }
    if (answered.kind === 'answered' && answered.outcome === 'result') {
      return 'shown';
    }
    return isRefusedForTheAccount(answered, typing, failureCodes) ? 'refused' : 'failed';
  });
}

export function typingShownThrough(
  through: Pick<ThroughTheConnection, 'callOnce' | 'mostRequestBytesTo'>,
  { org, playbook, connection, ...showing }: TypingAsked,
): Effect.Effect<TypingShown> {
  const called: ToolCalled = (tool, input) =>
    through.callOnce({ org, playbook, reference: { server: connection, tool }, input, meta: {}, recordContent: false });
  return typingShownBy(called, through.mostRequestBytesTo(connection), showing);
}
