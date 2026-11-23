import type { SocketHolder } from '@on.auto/connections';
import { chatRenderingOf, type ChatRendering, type PlaybooksWaiting, type ReplyAwaited } from '@on.auto/interaction';
import type { PlaybookAddress } from '@on.auto/operations';
import { providerFoundBy, type ProviderList, type ThroughTheConnection } from '@on.auto/providers';
import { Effect } from 'effect';

import type { SocketMember } from '../../sockets/socket-registries.ts';
import type { ChatConnection } from '../arrivals/arrival-parts.ts';
import { chatServiceThrough, type ChatCalls } from '../service/service-calls.ts';

export interface ConnectionsComposing {
  readonly held: (org: string) => Effect.Effect<readonly SocketHolder[]>;
  readonly playbooks: (org: string) => Effect.Effect<readonly PlaybookAddress[]>;
  readonly providers: ProviderList;
  readonly requests: { readonly awaited: ReplyAwaited; readonly waitingIn: PlaybooksWaiting };
}

export interface ChatThrough {
  readonly tools: Pick<ThroughTheConnection, 'mostRequestBytesTo'>;
}

type Entry = NonNullable<ReturnType<typeof providerFoundBy>>['entry'];

export interface Rendered {
  readonly chat: NonNullable<Entry['chat']>;
  readonly entry: Entry;
  readonly render: ChatRendering;
  readonly account: string;
}

interface Through {
  readonly member: SocketMember;
  readonly rendered: Rendered;
}

export class ChatConnections {
  readonly #composing: ConnectionsComposing;
  readonly #calls: ChatCalls;
  readonly #notShown = new Set<string>();

  constructor(composing: ConnectionsComposing, calls: ChatCalls) {
    this.#composing = composing;
    this.#calls = calls;
  }

  readonly heldIn = (org: string): Promise<readonly SocketHolder[]> => Effect.runPromise(this.#composing.held(org));

  readonly renderOf = (holder: SocketHolder): Rendered | undefined => {
    const entry = providerFoundBy(this.#composing.providers, holder.provider)?.entry;
    const render = chatRenderingOf(entry?.renders);
    return entry?.chat === undefined || render === undefined || holder.account === undefined
      ? undefined
      : { chat: entry.chat, entry, render, account: holder.account };
  };

  readonly connectionOf = async (member: SocketMember): Promise<ChatConnection | undefined> => {
    const holder = await this.#heldNow(member);
    const rendered = holder === undefined ? undefined : this.renderOf(holder);
    return holder === undefined || rendered === undefined
      ? undefined
      : this.#connectionThrough({ member: { org: member.org, holder }, rendered });
  };

  #connectionThrough({ member, rendered }: Through): ChatConnection {
    const { org, holder } = member;
    const { chat, entry, render, account } = rendered;
    const service = chatServiceThrough({
      org,
      connection: { id: holder.connection, name: holder.name },
      chat,
      typing: entry.conversations?.typing,
      failureCodes: entry.failure_codes,
      tools: this.#calls,
    });
    const key = JSON.stringify([org, holder.connection, account]);
    return {
      connection: holder.connection,
      account,
      service,
      render,
      model: holder.model,
      accountName: holder.accountName,
      requestSentAs: (conversation, id) => this.#requestSentAs(org, holder.name, conversation, id),
      requestWaitsIn: async (conversation) =>
        (await Effect.runPromise(this.#composing.requests.waitingIn(org, conversation))).length > 0,
      notShownHere: {
        has: () => this.#notShown.has(key),
        add: () => {
          this.#notShown.add(key);
        },
      },
    };
  }

  async #heldNow({ org, holder }: SocketMember): Promise<SocketHolder | undefined> {
    return (await this.heldIn(org)).find(
      (each) => each.connection === holder.connection && each.connectedAt === holder.connectedAt,
    );
  }

  async #requestSentAs(org: string, connection: string, conversation: string, id: string): Promise<boolean> {
    const playbooks = await Effect.runPromise(this.#composing.playbooks(org));
    const awaited = await Promise.all(
      playbooks.map((playbook) =>
        Effect.runPromise(
          this.#composing.requests.awaited({ playbook, connection, conversation }, { id: '', sender: '', to: id }),
        ),
      ),
    );
    return awaited.some(({ awaited: sent }) => sent);
  }
}
