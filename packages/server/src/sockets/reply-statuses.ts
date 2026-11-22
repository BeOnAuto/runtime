import type { PlaybookAddress } from '@on.auto/operations';
import { conversationsOf, typingShownThrough, type ProviderList, type ThroughTheConnection } from '@on.auto/providers';
import { background } from '@on.auto/workflow-host';
import { Effect, type Context } from 'effect';

import type { SocketMember } from './socket-registries.ts';

export type StatusTools = Pick<ThroughTheConnection, 'callOnce' | 'mostRequestBytesTo'>;

interface StatusParts {
  readonly tools: StatusTools;
  readonly providers: ProviderList;
  readonly context: Context.Context<never> | undefined;
}

interface AwaitedIn {
  readonly member: SocketMember;
  readonly playbook: PlaybookAddress;
  readonly conversation: string;
  readonly reply: { readonly id: string; readonly to: string };
  readonly party: string;
}

type Typing = NonNullable<NonNullable<ReturnType<typeof conversationsOf>>['typing']>;

const statusWords = {
  unshown:
    'The service did not show that Auto is working on a reply a request waits for; the reply is taken all the same',
  refused:
    'The service shows no working status in the account of a connection, so it is not asked for there again while the server runs',
} as const;

function accountKeyOf({ org, holder }: SocketMember): string {
  return JSON.stringify([org, holder.connection, holder.connectedAt, holder.account]);
}

function callKeyOf({ member: { org, holder }, conversation, reply }: AwaitedIn): string {
  return JSON.stringify([org, holder.connection, conversation, reply.id]);
}

class ReplyStatuses {
  readonly #parts: StatusParts;
  readonly #calls: ReturnType<typeof background>;
  #refused: ReadonlySet<string> = new Set();

  constructor(parts: StatusParts) {
    this.#parts = parts;
    this.#calls = background(parts.context);
  }

  readonly shown = (awaited: AwaitedIn): Effect.Effect<void> =>
    Effect.sync(() => {
      const typing = conversationsOf(this.#parts.providers, awaited.member.holder.provider)?.typing;
      if (typing !== undefined && !this.#refused.has(accountKeyOf(awaited.member))) {
        this.#calls.run(callKeyOf(awaited), this.#asked(awaited, typing));
      }
    });

  readonly stop = (): Effect.Effect<void> => this.#calls.stop();

  #asked(awaited: AwaitedIn, typing: Typing): Effect.Effect<void> {
    const { member, playbook, conversation, reply, party } = awaited;
    const { org, holder } = member;
    const asked = {
      ...playbook,
      connection: holder.name,
      typing,
      failureCodes: holder.failureCodes,
      repliedIn: { to: party, sent: { conversation, id: reply.to }, reply },
    };
    return Effect.flatMap(typingShownThrough(this.#parts.tools, asked), (shown) => {
      if (shown === 'refused') {
        this.#refused = new Set([...this.#refused, accountKeyOf(member)]);
        return Effect.logInfo(statusWords.refused);
      }
      return shown === 'failed' ? Effect.logWarning(statusWords.unshown) : Effect.void;
    }).pipe(
      Effect.catchCause(() => Effect.logWarning(statusWords.unshown)),
      Effect.annotateLogs({ org, connection: holder.connection }),
    );
  }
}

export function replyStatusesOf(parts: StatusParts): ReplyStatuses {
  return new ReplyStatuses(parts);
}
