import { Effect } from 'effect';

import {
  chatAnswerOf,
  chatAnsweringOf,
  chatOfferedFor,
  mayChooseTheModel,
  modelGivenOf,
  type ChatReading,
  type Chatting,
} from '../operations/connection-chat.ts';
import type { ChatAnswering } from '../providers/chat-answers.ts';
import type { ChatOffered } from '../registry/connection-commands.ts';
import {
  chatOpenedWithoutAModel,
  modelRefusalAtConnect,
  opensTheChat,
  type ModelAtConnect,
} from '../registry/model-decisions.ts';
import type { KeptConnection } from '../registry/registry.ts';

interface Asked {
  readonly model: string | undefined;
  readonly appsGiven: Readonly<Record<string, string>>;
}

interface ModelChoice {
  readonly choice: ModelAtConnect;
  readonly chat: ChatOffered | undefined;
  readonly answering: ChatAnswering;
}

const modelOfTheConnect = Effect.fnUntraced(function* (model: string, opens: boolean, chatting: Chatting) {
  yield* mayChooseTheModel(chatting);
  return opens ? yield* modelGivenOf(model, chatting) : { model };
});

const waitsForAModel = Effect.fnUntraced(function* (
  kept: KeptConnection,
  chosen: ModelAtConnect,
  { appsGiven }: Asked,
  chatting: Chatting,
) {
  return chatOpenedWithoutAModel(kept.model, chosen, appsGiven) !== undefined && (yield* chatting.models.listsAModel);
});

const chattedChoice = Effect.fnUntraced(function* (
  kept: KeptConnection,
  asked: Asked,
  chat: ChatOffered | undefined,
  chatting: Chatting,
) {
  const opens = opensTheChat(chat, asked.appsGiven);
  const answering = yield* chatAnsweringOf([chat], chatting);
  const model = asked.model === undefined ? undefined : yield* modelOfTheConnect(asked.model, opens, chatting);
  const chosen: ModelAtConnect = {
    ...(model === undefined ? {} : { model }),
    ...(chat === undefined ? {} : { chat }),
  };
  const waits = answering.may && (yield* waitsForAModel(kept, chosen, asked, chatting));
  const choice: ModelChoice = {
    choice: waits ? { ...chosen, waitsForAModel: true } : chosen,
    chat,
    answering,
  };
  return choice;
});

const choiceOf = Effect.fnUntraced(function* (kept: KeptConnection, asked: Asked, reading: ChatReading) {
  const chat = chatOfferedFor(kept.connection, reading);
  const { chatting } = reading;
  if (chatting === undefined) {
    const unchatted: ModelChoice = {
      choice: asked.model === undefined ? {} : { model: { model: asked.model } },
      chat,
      answering: { may: false, defaultModel: {} },
    };
    return unchatted;
  }
  return yield* chattedChoice(kept, asked, chat, chatting);
});

export const modelAtConnect = Effect.fnUntraced(function* (kept: KeptConnection, asked: Asked, reading: ChatReading) {
  const { choice, chat, answering } = yield* choiceOf(kept, asked, reading);
  const refusal = modelRefusalAtConnect(kept, choice, asked.appsGiven);
  if (refusal !== undefined) {
    return yield* Effect.fail(refusal);
  }
  return { choice, answerOf: (after: KeptConnection) => chatAnswerOf(after, chat, answering) };
});
