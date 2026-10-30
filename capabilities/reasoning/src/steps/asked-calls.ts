import type { CallFailed, CallsEndedBecause, OfferedTool } from '@on.auto/tool-servers';
import {
  admission,
  countsAgainstTheRun,
  failureReply,
  failedOnce,
  failingBecause,
  failuresEnded,
  type CallTally,
  type ToolReply,
} from '@on.auto/tool-servers/policy';
import { Option, Schema } from 'effect';

import type { FactData } from './attempt-facts.ts';

export const notAnObject = 'The arguments of this call are not a JSON object, so it was not sent; send an object.';

export function noLongerOffered(tool: string): string {
  return `The run no longer offers the tool ${tool}, since its server changed while the run was stopped, so this call was not sent.`;
}

type StartingTool = Pick<OfferedTool, 'reference' | 'start'>;

export interface Offer {
  readonly final: boolean;
  readonly offered: ReadonlyMap<string, StartingTool>;
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

const isArguments = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

export interface AskedCall {
  readonly callId: string;
  readonly tool: string;
  readonly input: unknown;
}

export interface AdmittedCall extends AskedCall {
  readonly input: Readonly<Record<string, unknown>>;
  readonly offer: StartingTool;
}

interface OpenCall {
  readonly number: number;
  readonly call: AskedCall;
  readonly server: string;
  readonly readOnly: boolean;
}

export interface Asking {
  readonly asked: readonly AskedCall[];
  readonly admitted: readonly AdmittedCall[];
  readonly results: ReadonlyMap<string, Schema.JsonObject>;
  readonly open: readonly OpenCall[];
  readonly unread: readonly string[];
  readonly final: boolean;
}

export const noAsking: Asking = { asked: [], admitted: [], results: new Map(), open: [], unread: [], final: false };

export interface Admitted {
  readonly asking: Asking;
  readonly tally: CallTally;
  readonly refusals: readonly string[];
}

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

function libraryResults(response: readonly Schema.JsonObject[]): ReadonlyMap<string, Schema.JsonObject> {
  return new Map(
    partsOf(response, isToolMessage)
      .filter((part) => isToolResultPart(part))
      .map((part) => [part.toolCallId, part]),
  );
}

function resultPart({ callId, tool }: AskedCall, { text, isError }: ToolReply): Schema.JsonObject {
  return {
    type: 'tool-result',
    toolCallId: callId,
    toolName: tool,
    output: isError ? { type: 'error-text', value: text } : { type: 'text', value: text },
  };
}

function admittedOne(admitted: Admitted, call: AskedCall, offered: Offer['offered']): Admitted {
  const { asking, tally, refusals } = admitted;
  const refused = (text: string): Admitted => ({
    asking: {
      ...asking,
      results: new Map([...asking.results, [call.callId, resultPart(call, { text, isError: true })]]),
    },
    tally,
    refusals: [...refusals, text],
  });
  if (asking.results.has(call.callId)) {
    return admitted;
  }
  const offer = offered.get(call.tool);
  if (offer === undefined) {
    return refused(noLongerOffered(call.tool));
  }
  if (!isArguments(call.input)) {
    return refused(notAnObject);
  }
  const input = call.input;
  const admitting = admission(tally, { tool: call.tool, callId: call.callId, input });
  return admitting.admitted
    ? {
        asking: { ...asking, admitted: [...asking.admitted, { ...call, input, offer }] },
        tally: admitting.tally,
        refusals,
      }
    : { ...refused(admitting.refusal), tally: admitting.tally };
}

export function admittedFrom(
  response: readonly Schema.JsonObject[],
  tally: CallTally,
  { final, offered }: Offer,
): Admitted {
  const asked = askedIn(response);
  const asking: Asking = { asked, admitted: [], results: libraryResults(response), open: [], unread: [], final };
  return asked.reduce<Admitted>((admitted, call) => admittedOne(admitted, call, offered), {
    asking,
    tally,
    refusals: [],
  });
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
  return { ...asking, open: [...asking.open, ...opened] };
}

export interface Ended {
  readonly asking: Asking;
  readonly replies: readonly ToolReply[];
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
  return {
    asking: {
      ...asking,
      open: asking.open.filter((open) => open.number !== number),
      results: new Map([...asking.results, ...answered]),
    },
    replies: ended.map(({ reply }) => reply),
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
