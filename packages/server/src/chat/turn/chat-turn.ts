import {
  addresseeChecked,
  conversationWithin,
  memoryWindow,
  turnRemembered,
  UNADDRESSED,
  type Earlier,
  type TurnEnded,
  type TurnTaken,
} from '@on.auto/chat';
import type { ChatRendering, ChatWords } from '@on.auto/interaction';
import { randomUUIDv7 } from '@on.auto/operations';

import type { ChatService, WhereWritten } from '../service/service-calls.ts';
import type { LeasedConversation } from '../store/leased-memory.ts';
import { endedBy, type ToolParts } from './turn-tools.ts';
import { statusShownFor, type StatusParts } from './working-status.ts';

export interface TurnAsked {
  readonly person: string;
  readonly where: WhereWritten;
  readonly app: string | undefined;
  readonly text: string;
  readonly autoNotNamed: boolean;
  readonly leased: LeasedConversation;
  readonly answering: () => void;
}

export interface TurnParts extends Omit<StatusParts, 'service' | 'working'>, Omit<ToolParts, 'render'> {
  readonly service: ChatService;
  readonly render: ChatRendering;
}

export type TurnSettled = 'answered' | 'refused' | 'unaddressed' | 'failed';

type Ended = TurnEnded<never>;

function refusalWordsOf({ refused, toolCalls }: Extract<Ended, { readonly refused: unknown }>, words: ChatWords) {
  const said =
    refused === 'bound_reached'
      ? words.boundReached
      : refused === 'not_admitted'
        ? words.notAdmitted
        : words.notAnswered;
  return toolCalls > 0 ? `${said} ${words.stepsAlreadyDone}` : said;
}

function postedOf(ended: Ended, render: ChatRendering, people: ReadonlySet<string>): string {
  if ('answer' in ended) {
    return render.answerOf(ended.answer, ended.bounded, people);
  }
  return 'refused' in ended ? refusalWordsOf(ended, render.words) : render.words.notAnswered;
}

function settledOf(ended: Ended): TurnSettled {
  if ('answer' in ended) {
    return 'answered';
  }
  return 'refused' in ended ? 'refused' : 'failed';
}

function rememberedOutcome(ended: Ended, render: ChatRendering, people: ReadonlySet<string>): Ended {
  return 'answer' in ended ? { ...ended, answer: render.madeSafe(ended.answer, people) } : ended;
}

interface Told {
  readonly taken: TurnTaken;
  readonly messages: ReturnType<ChatRendering['conversationOf']>['messages'];
  readonly people: ReadonlySet<string>;
}

async function earlierOf(asked: TurnAsked, parts: TurnParts, remembered: number): Promise<readonly Earlier[]> {
  const { where, app } = asked;
  if (remembered > 0 || where.thread === undefined) {
    return [];
  }
  const thread = await parts.service.thread(where);
  return parts.render.earlierIn(thread, { id: where.id, app }, parts.chosen.memory.threadMessages);
}

async function toldFor(asked: TurnAsked, parts: TurnParts): Promise<Told> {
  const remembered = await memoryWindow(asked.leased.memory, parts.chosen.memory);
  const earlier = await earlierOf(asked, parts, remembered.length);
  const { sender } = asked.where;
  const told = parts.render.conversationOf([...remembered, ...earlier], { sender, text: asked.text });
  const messages = conversationWithin(told.messages, parts.chosen.memory.conversationBytes);
  return { taken: { remembered, earlier, sender, text: asked.text }, messages, people: told.people };
}

async function isAddressed(asked: TurnAsked, parts: TurnParts, told: Told): Promise<boolean> {
  if (!asked.autoNotNamed) {
    return true;
  }
  const checked = await addresseeChecked<never>({
    id: randomUUIDv7(),
    model: parts.chosen.model,
    instructions: parts.render.checkInstructions,
    messages: told.messages,
    signal: parts.signal,
    waits: parts.waits,
  });
  return checked === 'addressed';
}

export async function turnTaken(asked: TurnAsked, parts: TurnParts): Promise<TurnSettled> {
  const told = await toldFor(asked, parts);
  if (!(await isAddressed(asked, parts, told))) {
    await turnRemembered(asked.leased.memory, told.taken, UNADDRESSED, parts.chosen.memory);
    return 'unaddressed';
  }
  asked.answering();
  const status = await statusShownFor(asked.where, { ...parts, working: parts.render.words.working });
  const toolsAsked = { person: asked.person, autoNotNamed: asked.autoNotNamed, messages: told.messages };
  const ended = await endedBy(toolsAsked, parts).catch((): Ended => ({
    refused: 'model_unavailable',
    modelCalls: 0,
    toolCalls: 0,
  }));
  await status.answered(postedOf(ended, parts.render, told.people));
  const remembered = rememberedOutcome(ended, parts.render, told.people);
  await turnRemembered(asked.leased.memory, told.taken, remembered, parts.chosen.memory);
  return settledOf(ended);
}
