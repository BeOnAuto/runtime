import type { ModelFailure, ModelRequest, ModelResult } from '@on.auto/reasoning';
import { Option, Schema } from 'effect';

import type { ConversationMessage } from '../model/chat-model.ts';
import { fittedRequest, type FittedRequest } from './request-fit.ts';
import { retoldMessages } from './retold-turn.ts';
import { callsFrom } from './tool-calls.ts';
import { turnBoundsOf } from './turn-bounds.ts';
import { nothingSpent, requestTokensOf, spentAfter, tokensAfterTheNextCall } from './turn-input.ts';
import {
  boundedBy,
  endedWith,
  stoppedBeforeACall,
  thrownFrom,
  type BoundedTurn,
  type Ending,
  type Running,
  type Stepped,
  type Turn,
  type TurnEnded,
} from './turn-state.ts';
import { conversationOf, toolCallsSentIn, type Asked, type TurnStep } from './turn-steps.ts';

export const TIMED_OUT = 'timed_out';

const ResponseSchema = Schema.fromJsonString(Schema.Array(Schema.JsonObject));

const AssistantSchema = Schema.Struct({ role: Schema.Literal('assistant'), content: Schema.Array(Schema.Unknown) });

const ToolCallSchema = Schema.Struct({
  type: Schema.Literal('tool-call'),
  toolCallId: Schema.String,
  toolName: Schema.String,
  input: Schema.Unknown,
});

const TextSchema = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String });

const responseRead = Schema.decodeUnknownOption(ResponseSchema);

const isAssistant = Schema.is(AssistantSchema);

const isToolCall = Schema.is(ToolCallSchema);

const isText = Schema.is(TextSchema);

function askedIn({ response }: ModelResult): Asked {
  const read: readonly Schema.JsonObject[] = Option.getOrElse(responseRead(response), () => []);
  const assistant = read.filter((message) => isAssistant(message));
  const parts = assistant.flatMap((message) => message.content);
  return {
    assistant,
    said: parts.flatMap((part) => (isText(part) ? [part.text] : [])).join(''),
    calls: parts.flatMap((part) =>
      isToolCall(part) ? [{ callId: part.toolCallId, tool: part.toolName, input: part.input }] : [],
    ),
  };
}

const messagesOf = (messages: readonly ConversationMessage[]): ModelRequest['messages'] =>
  messages.map(({ role, text }) => ({ role, content: [{ type: 'text', text }] }));

const requestBeside = <Refused>({ id, instructions, model, bounds }: BoundedTurn<Refused>) =>
  ({
    model: model.name,
    instructions,
    output: { type: 'text' },
    settings: { max_output_tokens: bounds.outputTokens },
    run_id: id,
  }) as const;

function requestOf<Refused>(turn: BoundedTurn<Refused>, steps: readonly TurnStep[]): ModelRequest {
  const conversation = conversationOf(steps);
  return {
    ...requestBeside(turn),
    messages: messagesOf(turn.messages),
    ...(conversation.length === 0 ? {} : { conversation }),
    ...(turn.offered.length === 0 ? {} : { tools: turn.offered }),
  };
}

function retoldRequestOf<Refused>(turn: BoundedTurn<Refused>, steps: readonly TurnStep[]): ModelRequest {
  return { ...requestBeside(turn), messages: retoldMessages(turn.messages, steps, crypto.randomUUID()) };
}

const utf8 = new TextEncoder();

const requestBytesOf = (request: ModelRequest): number => utf8.encode(JSON.stringify(request)).byteLength;

const resultBytesOf = (step: TurnStep | undefined): number =>
  step === undefined ? 0 : step.calls.reduce((bytes, { reply }) => bytes + utf8.encode(reply.text).byteLength, 0);

function finalAnswerOf(text: string, retelling: boolean): Ending<never> {
  if (text.trim() !== '') {
    return { answer: text, bounded: retelling };
  }
  return { refused: retelling ? 'bound_reached' : 'model_unavailable' };
}

const failureEndingOf = (failure: ModelFailure['_tag'], byTheDeadline: boolean): Ending<never> =>
  failure === TIMED_OUT && byTheDeadline ? { refused: 'bound_reached' } : { refused: 'model_unavailable', failure };

interface Asking {
  readonly running: Running;
  readonly request: ModelRequest;
  readonly retelling: boolean;
  readonly room: number;
  readonly startedAt: number;
}

const passesTheInputOfATurn = <Refused>(
  turn: BoundedTurn<Refused>,
  running: Running,
  { request, leftOut }: FittedRequest,
): boolean =>
  tokensAfterTheNextCall(running.spent, {
    resultBytes: resultBytesOf(running.steps.at(-1)),
    requestBytes: requestBytesOf(request),
    leftOut,
  }) > turn.bounds.turnInputTokens;

function askingFrom<Refused>(turn: BoundedTurn<Refused>, running: Running): Asking | Ending<never> {
  const room = turn.bounds.toolCalls - toolCallsSentIn(running.steps);
  const retelling = room <= 0;
  const stopped = stoppedBeforeACall(turn, running.startedAt);
  if (stopped !== undefined) {
    return stopped;
  }
  const fitted = fittedRequest(
    (steps) => (retelling ? retoldRequestOf(turn, steps) : requestOf(turn, steps)),
    running.steps,
    (candidate) => requestTokensOf(running.spent, requestBytesOf(candidate)) <= turn.bounds.requestInputTokens,
  );
  if (!fitted.fits || passesTheInputOfATurn(turn, running, fitted)) {
    return { refused: 'bound_reached' };
  }
  const startedAt = running.startedAt ?? turn.now();
  const counted: Running = { ...running, startedAt, modelCalls: running.modelCalls + 1 };
  return { running: counted, request: fitted.request, retelling, room, startedAt };
}

async function answeredBy<Refused>(turn: BoundedTurn<Refused>, asking: Asking): Promise<Stepped<Refused>> {
  const { running, request, retelling, room, startedAt } = asking;
  const called = await boundedBy(turn, startedAt, turn.bounds.modelCallMs, (signal, ms) =>
    turn.model.generate({ ...request, timeout_ms: ms }, signal),
  );
  if ('ended' in called) {
    return { ended: endedWith(running, called.ended) };
  }
  if ('capped' in called) {
    return { ended: endedWith(running, { refused: 'model_unavailable', failure: TIMED_OUT }) };
  }
  const answer = called.settled;
  if ('failed' in answer) {
    const { _tag: failure } = answer.failed;
    return { ended: endedWith(running, failureEndingOf(failure, called.byTheDeadline)) };
  }
  if ('refused' in answer) {
    return { ended: endedWith(running, { refused: answer.refused }) };
  }
  const spent: Running = { ...running, spent: spentAfter(running.spent, answer.answered) };
  const asked = askedIn(answer.answered);
  if (retelling || asked.calls.length === 0) {
    return { ended: endedWith(spent, finalAnswerOf(answer.answered.text, retelling)) };
  }
  return callsFrom({ turn, running: spent, startedAt, asked, room }, []);
}

async function modelAsked<Refused>(turn: BoundedTurn<Refused>, asking: Asking): Promise<Stepped<Refused>> {
  try {
    return await answeredBy(turn, asking);
  } catch {
    return thrownFrom(asking.running);
  }
}

function stepFrom<Refused>(turn: BoundedTurn<Refused>, running: Running): Promise<Stepped<Refused>> {
  try {
    const asking = askingFrom(turn, running);
    return 'request' in asking ? modelAsked(turn, asking) : Promise.resolve({ ended: endedWith(running, asking) });
  } catch {
    return Promise.resolve(thrownFrom(running));
  }
}

async function turnFrom<Refused>(turn: BoundedTurn<Refused>, running: Running): Promise<TurnEnded<Refused>> {
  const stepped = await stepFrom(turn, running);
  return 'ended' in stepped ? stepped.ended : turnFrom(turn, stepped.running);
}

export function turnOf<Refused>(turn: Turn<Refused>): Promise<TurnEnded<Refused>> {
  const bounded: BoundedTurn<Refused> = { ...turn, bounds: turnBoundsOf(turn.bounds) };
  return turnFrom(bounded, { steps: [], modelCalls: 0, spent: nothingSpent, startedAt: undefined });
}
