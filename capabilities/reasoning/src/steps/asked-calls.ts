import type { CallFailed, CallsEndedBecause, OfferedTool } from '@on.auto/tool-servers';
import {
  countsAgainstTheRun,
  failureReply,
  failedOnce,
  failingBecause,
  failuresEnded,
  noCalls,
  type CallCount,
  type CallTally,
  type ToolReply,
} from '@on.auto/tool-servers/policy';
import { Option, Schema } from 'effect';

import type { FactData } from './attempt-facts.ts';

export const notAnObject = 'The arguments of this call are not a JSON object, so it was not sent; send an object.';

export function noLongerOffered(tool: string): string {
  return `The run no longer offers the tool ${tool}, since its server changed while the run was stopped, so this call was not sent.`;
}

type StartingTool = Pick<OfferedTool, 'reference' | 'readOnly' | 'start'>;

export interface Offer {
  readonly final: boolean;
  readonly offered: ReadonlyMap<string, StartingTool>;
  readonly count: CallCount;
}

const ToolCallPartSchema = Schema.Struct({
  type: Schema.Literal('tool-call'),
  toolCallId: Schema.String,
  toolName: Schema.String,
  input: Schema.Unknown,
});

const isToolCallPart = Schema.is(ToolCallPartSchema);

const isTextPart = Schema.is(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }));

const isToolResultPart = Schema.is(Schema.Struct({ type: Schema.Literal('tool-result'), toolCallId: Schema.String }));

const isAssistantMessage = Schema.is(
  Schema.Struct({ role: Schema.Literal('assistant'), content: Schema.Array(Schema.Unknown) }),
);

const isToolMessage = Schema.is(Schema.Struct({ role: Schema.Literal('tool'), content: Schema.Array(Schema.Unknown) }));

export interface AskedCall {
  readonly callId: string;
  readonly tool: string;
  readonly input: unknown;
}

export interface AdmittedCall extends AskedCall {
  readonly input: Readonly<Record<string, unknown>>;
  readonly offer: StartingTool;
  readonly reads: boolean;
}

interface OpenCall {
  readonly number: number;
  readonly call: AskedCall;
  readonly server: string;
  readonly readOnly: boolean;
}

export interface Asking {
  readonly asked: readonly AskedCall[];
  readonly before: CallTally;
  readonly started: ReadonlyMap<string, boolean>;
  readonly admitted: readonly AdmittedCall[];
  readonly refused: ReadonlyMap<string, string>;
  readonly results: ReadonlyMap<string, Schema.JsonObject>;
  readonly open: readonly OpenCall[];
  readonly unread: readonly string[];
  readonly final: boolean;
  readonly outdated: boolean;
}

export const noAsking: Asking = {
  asked: [],
  before: noCalls,
  started: new Map(),
  admitted: [],
  refused: new Map(),
  results: new Map(),
  open: [],
  unread: [],
  final: false,
  outdated: false,
};

function partsOf(messages: readonly Schema.JsonObject[], isOfRole: typeof isToolMessage): readonly unknown[] {
  return messages.flatMap((message) => (isOfRole(message) ? message.content : []));
}

export function askedIn(response: readonly Schema.JsonObject[]): readonly AskedCall[] {
  return partsOf(response, isAssistantMessage)
    .filter((part) => isToolCallPart(part))
    .map(({ toolCallId, toolName, input }) => ({ callId: toolCallId, tool: toolName, input }));
}

export function assistantMessages(response: readonly Schema.JsonObject[]): readonly Schema.JsonObject[] {
  return response.filter((message) => isAssistantMessage(message));
}

export function libraryResults(response: readonly Schema.JsonObject[]): ReadonlyMap<string, Schema.JsonObject> {
  return new Map(
    partsOf(response, isToolMessage)
      .filter((part) => isToolResultPart(part))
      .map((part) => [part.toolCallId, part]),
  );
}

export function resultPart({ callId, tool }: AskedCall, { text, isError }: ToolReply): Schema.JsonObject {
  return {
    type: 'tool-result',
    toolCallId: callId,
    toolName: tool,
    output: isError ? { type: 'error-text', value: text } : { type: 'text', value: text },
  };
}

export function isAnswered({ asked, results }: Asking): boolean {
  return asked.every(({ callId }) => results.has(callId));
}

export function resultsMessage({ asked, results }: Asking): Schema.JsonObject {
  return {
    role: 'tool',
    content: asked.flatMap(({ callId }) => Option.toArray(Option.fromNullishOr(results.get(callId)))),
  };
}

export function unsent({ admitted, results }: Asking): readonly AdmittedCall[] {
  return admitted.filter(({ callId }) => !results.has(callId));
}

export function startedIn(asking: Asking, started: FactData<'tool_call_started'>): Asking {
  const { number, call_id: callId, server, read_only: readOnly } = started;
  const opened = asking.asked
    .filter((call) => call.callId === callId)
    .map((call) => ({ number, call, server, readOnly: readOnly === true }));
  const marked = asking.asked
    .filter((call) => call.callId === callId)
    .map((call): readonly [string, boolean] => [
      call.callId,
      asking.started.get(callId) !== false && readOnly === true,
    ]);
  return { ...asking, started: new Map([...asking.started, ...marked]), open: [...asking.open, ...opened] };
}

export interface Ended {
  readonly asking: Asking;
  readonly replies: readonly ToolReply[];
  readonly withdrawn: readonly string[];
}

interface EndedCall {
  readonly open: OpenCall;
  readonly reply: ToolReply;
}

function endedIn(asking: Asking, number: number, replyOf: (open: OpenCall) => ToolReply): Ended {
  const ended = asking.open
    .filter((open) => open.number === number)
    .map((open): EndedCall => ({ open, reply: replyOf(open) }));
  const answered = ended.map(({ open, reply }): readonly [string, Schema.JsonObject] => [
    open.call.callId,
    resultPart(open.call, reply),
  ]);
  const endedIds = new Set(ended.map(({ open }) => open.call.callId));
  return {
    asking: {
      ...asking,
      open: asking.open.filter((open) => open.number !== number),
      refused: new Map([...asking.refused].filter(([callId]: readonly [string, string]) => !endedIds.has(callId))),
      results: new Map([...asking.results, ...answered]),
    },
    replies: ended.map(({ reply }) => reply),
    withdrawn: [...asking.refused]
      .filter(([callId]: readonly [string, string]) => endedIds.has(callId))
      .map(([, text]: readonly [string, string]) => text),
  };
}

export function answeredIn(asking: Asking, number: number, reply: ToolReply): Ended {
  return endedIn(asking, number, () => reply);
}

export function failedIn(asking: Asking, failed: FactData<'tool_call_failed'>, reply: ToolReply | undefined): Ended {
  return endedIn(asking, failed.number, ({ server }) => reply ?? failureReply(failed, server));
}

export function interruptedIn(asking: Asking, number: number): Asking {
  return { ...asking, open: asking.open.filter((open) => open.number !== number) };
}

export function unreadIn(asking: Asking, number: number): Asking {
  const unread = asking.open.filter((open) => open.number === number).map(({ call }) => call.callId);
  return { ...interruptedIn(asking, number), unread: [...asking.unread, ...unread] };
}

export function failureCounted(
  tally: CallTally,
  serversEnded: CallsEndedBecause | null,
  { because, rate_limited: rateLimited }: CallFailed,
) {
  if (!countsAgainstTheRun(because)) {
    return { tally, serversEnded };
  }
  const counted = failedOnce(tally);
  const crossed = failuresEnded(counted) && !failuresEnded(tally);
  return { tally: counted, serversEnded: crossed ? failingBecause(rateLimited === true) : serversEnded };
}

export function answerTextOf(response: readonly Schema.JsonObject[]): string {
  return partsOf(response, isAssistantMessage)
    .filter((part) => isTextPart(part))
    .map(({ text }) => text)
    .join('');
}
