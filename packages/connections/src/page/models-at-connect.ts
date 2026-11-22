import { Effect } from 'effect';

import {
  chatAnswerOf,
  chatOfferedFor,
  mayChooseTheModel,
  maySetModel,
  modelGivenOf,
  type ChatReading,
  type Chatting,
} from '../operations/connection-chat.ts';
import type { ChatOffered } from '../registry/connection-commands.ts';
import { modelRefusalAtConnect, type ModelAtConnect } from '../registry/model-decisions.ts';
import type { KeptConnection } from '../registry/registry.ts';

interface Asked {
  readonly model: string | undefined;
  readonly appsGiven: Readonly<Record<string, string>>;
}

interface ModelChoice {
  readonly choice: ModelAtConnect;
  readonly chat: ChatOffered | undefined;
  readonly may: boolean;
}

function opensTheChat(chat: ChatOffered | undefined, { appsGiven }: Asked): boolean {
  return chat !== undefined && Object.hasOwn(appsGiven, chat.credential);
}

function mayAsked(asked: Asked, chat: ChatOffered | undefined, chatting: Chatting) {
  return asked.model === undefined && chat === undefined ? Effect.succeed(false) : maySetModel(chatting);
}

const modelOfTheConnect = Effect.fnUntraced(function* (model: string, opens: boolean, chatting: Chatting) {
  yield* mayChooseTheModel(chatting);
  return opens ? yield* modelGivenOf(model, chatting) : { model };
});

const chattedChoice = Effect.fnUntraced(function* (asked: Asked, chat: ChatOffered | undefined, chatting: Chatting) {
  const opens = opensTheChat(chat, asked);
  const may = yield* mayAsked(asked, chat, chatting);
  const model = asked.model === undefined ? undefined : yield* modelOfTheConnect(asked.model, opens, chatting);
  const chosen: ModelChoice = {
    choice: {
      ...(model === undefined ? {} : { model }),
      ...(chat === undefined ? {} : { chat }),
    },
    chat,
    may,
  };
  return chosen;
});

const choiceOf = Effect.fnUntraced(function* (kept: KeptConnection, asked: Asked, reading: ChatReading) {
  const chat = chatOfferedFor(kept.connection, reading);
  const { chatting } = reading;
  if (chatting === undefined) {
    const unchatted: ModelChoice = {
      choice: asked.model === undefined ? {} : { model: { model: asked.model } },
      chat,
      may: false,
    };
    return unchatted;
  }
  return yield* chattedChoice(asked, chat, chatting);
});

export const modelAtConnect = Effect.fnUntraced(function* (kept: KeptConnection, asked: Asked, reading: ChatReading) {
  const { choice, chat, may } = yield* choiceOf(kept, asked, reading);
  const refusal = modelRefusalAtConnect(kept, choice, asked.appsGiven);
  if (refusal !== undefined) {
    return yield* Effect.fail(refusal);
  }
  return { choice, answerOf: (after: KeptConnection) => chatAnswerOf(after, chat, may) };
});
