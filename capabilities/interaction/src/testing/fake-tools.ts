import { Buffer } from 'node:buffer';

import type {
  AnsweredOnce,
  CalledOnce,
  NotOfferedBecause,
  OneCall,
  StartedFields,
  ToolAccess,
  ToolServer,
} from '@on.auto/tool-servers';
import { ToolNotOffered } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { chatBoard, type BoardAnswer, type ChatBoard } from './chat-board.ts';

export type FakeAnswer =
  | BoardAnswer
  | { readonly kind: 'not_offered' }
  | { readonly kind: 'unopened'; readonly detail: string };

export type ToolPorts = Pick<
  ToolAccess,
  'named' | 'configured' | 'preparedCall' | 'callOnce' | 'listServers' | 'takesConnections'
>;

export interface FakeTools extends ToolPorts, Pick<ChatBoard, 'posted' | 'reply'> {
  readonly calls: () => readonly OneCall[];
  readonly answerNext: (...answers: readonly FakeAnswer[]) => void;
  readonly disallow: (tool: string) => void;
}

interface Refusal {
  readonly because: NotOfferedBecause;
  readonly detail: string;
}

const digest = 'd'.repeat(64);

function notAllowed(tool: string): Refusal {
  return { because: 'tool_not_allowed', detail: `The operator of this server does not allow chat/${tool}` };
}

function notConfigured(server: string): Refusal {
  return {
    because: 'tool_server_not_configured',
    detail: `No tool server named ${server} is configured for this playbook`,
  };
}

interface Offering {
  readonly disallowed: ReadonlySet<string>;
}

function refusalOf({ server, tool }: OneCall['reference'], { disallowed }: Offering): Refusal | undefined {
  if (server !== 'chat') {
    return notConfigured(server);
  }
  return disallowed.has(tool) ? notAllowed(tool) : undefined;
}

function notOfferedBy(refusal: Refusal): CalledOnce {
  return { kind: 'unopened', refused: 'tool_not_offered', ...refusal };
}

function startOf({ reference, input }: Pick<OneCall, 'reference' | 'input'>): Effect.Effect<StartedFields> {
  const argumentsJson = JSON.stringify(input);
  return Effect.succeed({
    ...reference,
    arguments_bytes: Buffer.byteLength(argumentsJson),
    arguments_sha256: digest,
  });
}

function notOfferedOnce({ reference }: OneCall): Effect.Effect<CalledOnce> {
  return Effect.succeed(notOfferedBy(notConfigured(reference.server)));
}

function unsentBy(answer: Exclude<FakeAnswer, BoardAnswer>, { reference }: OneCall): CalledOnce {
  return answer.kind === 'unopened'
    ? { kind: 'unopened', refused: 'tool_server_failed', because: 'failing', detail: answer.detail }
    : notOfferedBy(notAllowed(reference.tool));
}

function answeredOf(bytes: number, isError: boolean, number: number) {
  return {
    is_error: isError,
    result_bytes: bytes,
    result_sha256: digest,
    duration_ms: 3,
    jsonrpc_id: number,
  };
}

function answeredWith(answer: BoardAnswer, number: number): AnsweredOnce {
  const { detail, retryAfterMs } = answer;
  const answering = { kind: 'answered', annotations: undefined, detail, retryAfterMs } as const;
  if (answer.outcome === 'result') {
    const bytes = Buffer.byteLength(JSON.stringify(answer.answer));
    return { ...answering, outcome: 'result', answer: answer.answer, answered: answeredOf(bytes, false, number) };
  }
  const { outcome } = answer;
  if (outcome === 'tool_error') {
    return { ...answering, outcome, answered: answeredOf(0, true, number) };
  }
  return { ...answering, outcome, failed: { because: outcome, duration_ms: 3, jsonrpc_id: number } };
}

function chatTool(name: string, description: string, readOnly: boolean) {
  return {
    name,
    description,
    input_schema: { type: 'object', properties: { channel: { type: 'string' } } },
    ...(readOnly ? { annotations: { readOnlyHint: true } } : {}),
  };
}

const theChat: ToolServer = {
  name: 'chat',
  type: 'mcp',
  record_content: true,
  playbooks: ['*'],
  connection: 'conn_chat',
  provider: 'chat',
  tools: [
    chatTool('post_message', 'Posts a message to a channel or a thread.', false),
    chatTool('thread_replies', 'Lists the replies of a thread, oldest first.', true),
  ],
};

function namedBy(refusals: readonly (Refusal | undefined)[]): Effect.Effect<void, ToolNotOffered> {
  const refusal = refusals.find((each) => each !== undefined);
  return refusal === undefined ? Effect.void : Effect.fail(new ToolNotOffered(refusal));
}

export function fakeTools(duringCall: (call: OneCall) => Effect.Effect<unknown> = () => Effect.void): FakeTools {
  const board = chatBoard();
  const calls: OneCall[] = [];
  const queued: FakeAnswer[] = [];
  const offering = { disallowed: new Set<string>() };
  const sent = (call: OneCall): Effect.Effect<CalledOnce> => {
    const refusal = refusalOf(call.reference, offering);
    if (refusal !== undefined) {
      return Effect.succeed(notOfferedBy(refusal));
    }
    const next = queued.shift() ?? board.answerOf(call);
    if ('kind' in next) {
      return Effect.succeed(unsentBy(next, call));
    }
    calls.push(call);
    return Effect.as(duringCall(call), answeredWith(next, calls.length));
  };
  return {
    configured: true,
    takesConnections: true,
    listServers: () => Effect.succeed([theChat]),
    named: (_address, references) => namedBy(references.map((reference) => refusalOf(reference, offering))),
    preparedCall: (call) =>
      Effect.map(startOf(call), (fields) => ({ fields, called: Effect.suspend(() => sent(call)) })),
    callOnce: sent,
    calls: () => [...calls],
    posted: board.posted,
    reply: board.reply,
    answerNext: (...answers) => {
      queued.push(...answers);
    },
    disallow: (tool) => {
      offering.disallowed.add(tool);
    },
  };
}

export const noTools: ToolPorts = {
  configured: false,
  takesConnections: false,
  listServers: () => Effect.succeed([]),
  named: (_address, references) => namedBy(references.map(({ server }) => notConfigured(server))),
  preparedCall: (call) => Effect.map(startOf(call), (fields) => ({ fields, called: notOfferedOnce(call) })),
  callOnce: notOfferedOnce,
};
