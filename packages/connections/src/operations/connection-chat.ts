import { Caller, Forbidden, mayCallEach, type Runnable } from '@on.auto/operations';
import { providerFoundBy } from '@on.auto/providers';
import { Effect } from 'effect';

import {
  chatThroughOf,
  type ChatAnswering,
  type ChatHosting,
  type DefaultModelAnswered,
} from '../providers/chat-answers.ts';
import { chatOfferedOn } from '../providers/provider-listing.ts';
import type { ChatOffered, ModelGiven } from '../registry/connection-commands.ts';
import { holdsTheChat } from '../registry/model-decisions.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { wayOfTheConnection } from '../registry/what-connections-act-as.ts';
import { opensSockets, type ChatModels, type ConnectionServices } from './connection-services.ts';

export interface Chatting {
  readonly models: ChatModels;
  readonly setting: Runnable<'org'>;
}

export type ChatReading = Pick<ConnectionServices, 'providers' | 'sockets'> & {
  readonly chatting: Chatting | undefined;
};

const modelForAdmins = new Forbidden({
  detail: 'Only admins can choose the model of a connection.',
  kind: 'permission_denied',
});

export function chatHostingOf(reading: Pick<ConnectionServices, 'sockets'>, { models }: Chatting): ChatHosting {
  return { opensSockets: opensSockets(reading), throughAGateway: models.throughAGateway !== undefined };
}

export function chatOfferedFor(
  connection: Pick<KeptConnection['connection'], 'provider' | 'credential'>,
  reading: ChatReading,
): ChatOffered | undefined {
  const { chatting } = reading;
  const provider = providerFoundBy(reading.providers, connection.provider);
  const way = wayOfTheConnection(connection, reading.providers);
  return chatting === undefined || provider === undefined || way === undefined
    ? undefined
    : chatOfferedOn(provider, way, chatHostingOf(reading, chatting));
}

const maySetModel = Effect.fnUntraced(function* ({ setting }: Chatting) {
  const caller = yield* Caller;
  const [may] = yield* mayCallEach([{ operation: setting, caller, org: caller.org }]);
  return may === true;
});

function isThroughAGateway(offered: ChatOffered | undefined): boolean {
  return offered?.through === 'gateway';
}

function defaultModelAnsweredOf(
  { models }: Chatting,
  offered: readonly (ChatOffered | undefined)[],
): Effect.Effect<DefaultModelAnswered> {
  const gateway = models.throughAGateway;
  return gateway === undefined || !offered.some((each) => isThroughAGateway(each))
    ? Effect.succeed({})
    : Effect.map(gateway.defaultModel, (model) => ({ default_model: model }));
}

export const chatAnsweringOf = Effect.fnUntraced(function* (
  offered: readonly (ChatOffered | undefined)[],
  chatting: Chatting | undefined,
) {
  const unanswered: ChatAnswering = { may: false, defaultModel: {} };
  if (chatting === undefined || offered.every((each) => each === undefined)) {
    return unanswered;
  }
  const answering: ChatAnswering = {
    may: yield* maySetModel(chatting),
    defaultModel: yield* defaultModelAnsweredOf(chatting, offered),
  };
  return answering;
});

interface ChatAnswer {
  readonly chat?: {
    readonly credential?: string;
    readonly held: boolean;
    readonly model: string | null;
    readonly default_model?: string;
    readonly may_set_model: boolean;
  };
}

export function chatAnswerOf(
  kept: KeptConnection,
  offered: ChatOffered | undefined,
  answering: ChatAnswering,
): ChatAnswer {
  return offered === undefined
    ? {}
    : {
        chat: {
          ...chatThroughOf(offered, answering),
          held: holdsTheChat(kept.connection, offered),
          model: kept.model,
          may_set_model: answering.may,
        },
      };
}

function answeredOf(kept: KeptConnection, reading: ChatReading): ChatOffered | undefined {
  return kept.connection.status === 'removed' ? undefined : chatOfferedFor(kept.connection, reading);
}

export const chatsAnsweredOf = Effect.fnUntraced(function* (kept: readonly KeptConnection[], reading: ChatReading) {
  const offered = kept.map((each) => answeredOf(each, reading));
  const answering = yield* chatAnsweringOf(offered, reading.chatting);
  return kept.map((each, at) => chatAnswerOf(each, offered[at], answering));
});

export function modelGivenOf(model: string, { models }: Chatting): Effect.Effect<ModelGiven> {
  return Effect.map(models.refusalOf(model), (notOffered) =>
    notOffered === undefined ? { model } : { model, notOffered },
  );
}

export function mayChooseTheModel(chatting: Chatting) {
  return Effect.flatMap(maySetModel(chatting), (may) => (may ? Effect.void : Effect.fail(modelForAdmins)));
}
