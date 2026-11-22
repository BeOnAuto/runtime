import { McpServer, ProtocolError, type CallToolResult, type Transport } from '@modelcontextprotocol/server';
import { rejected, resolutionOf, type Rejected, type Unavailable } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { problemOfOutcome } from '../problem/outcome-problem.ts';
import { refusedResultOf, unsuccessfulResultOf, type ToolWords } from '../tools/tool-result.ts';
import { serverTitle, type ServerInfo } from './mcp-connection.ts';

const refusalCode = -32_000;

const noChangesAnnounced = { listChanged: false };

const refusedMethods = [
  'initialize',
  'server/discover',
  'tools/list',
  'tools/call',
  'prompts/list',
  'prompts/get',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'completion/complete',
] as const;

const ToolCallSchema = Schema.Struct({ name: Schema.String, arguments: Schema.optionalKey(Schema.Unknown) });

const toolCallOf = Schema.decodeUnknownOption(ToolCallSchema);

export interface BusyTool extends ToolWords {
  readonly name: string;
}

/** Why a listing is unavailable: busy, with its wait, or a check that failed outright, plainly. */
export type UnavailableListing = Pick<Unavailable, 'detail' | 'kind' | 'retry_after'>;

interface Asked {
  readonly method: string;
  readonly params?: unknown;
}

function rejectionOf(unavailable: UnavailableListing): Rejected {
  return { ...rejected('unavailable', unavailable.detail, undefined, unavailable.kind), ...resolutionOf(unavailable) };
}

function busyToolResultOf(refusal: Rejected, tool: BusyTool, input: unknown): CallToolResult {
  const { kind, plainLanguage } = tool;
  return unsuccessfulResultOf(refusal, false, {
    kind,
    attempt: plainLanguage.attempt(input),
    remedies: plainLanguage.remedies,
    explanations: plainLanguage.explanations,
  });
}

interface CalledTool {
  readonly tool: BusyTool;
  readonly input: unknown;
}

function calledToolOf({ method, params }: Asked, tools: readonly BusyTool[]): Option.Option<CalledTool> {
  const asked = method === 'tools/call' ? toolCallOf(params) : Option.none();
  return Option.flatMap(asked, (call) =>
    Option.map(Option.fromNullishOr(tools.find(({ name }) => name === call.name)), (tool) => ({
      tool,
      input: call.arguments ?? {},
    })),
  );
}

/**
 * A tool call's answer: where the listing is busy, the busy refusal of the tool called, in its words, as every busy
 * call is answered; where its check failed outright, the refusal's own words, whatever tool is called, since none was
 * chosen. Any other request, and a busy call of a tool the listing does not have, is answered the JSON-RPC error.
 */
function refusedCallOf(asked: Asked, refusal: Rejected, tools: readonly BusyTool[]): Option.Option<CallToolResult> {
  if (refusal.kind === 'busy') {
    return Option.map(calledToolOf(asked, tools), ({ tool, input }) => busyToolResultOf(refusal, tool, input));
  }
  return asked.method === 'tools/call' ? Option.some(refusedResultOf(refusal)) : Option.none();
}

/**
 * The server of a request whose listing is unavailable: it lists nothing, runs nothing, and refuses each request
 * answered from the listing, the connection included. `ping` and notifications are answered as on any other server.
 * The handlers it refuses are removed as it is connected, the last step before it serves: `createMcpHandler` sets the
 * handler of `server/discover` on the server its factory made after the factory returns and before it connects it.
 */
class UnavailableServer extends McpServer {
  override async connect(transport: Readonly<Transport>): Promise<void> {
    for (const method of refusedMethods) {
      this.server.removeRequestHandler(method);
    }
    await super.connect(transport);
  }
}

export function unavailableServerOf(
  serverInfo: ServerInfo,
  unavailable: UnavailableListing,
  tools: readonly BusyTool[],
): McpServer {
  const refusal = rejectionOf(unavailable);
  const problem = problemOfOutcome(refusal, false);
  const server = new UnavailableServer(
    { ...serverInfo, title: serverTitle },
    { capabilities: { tools: noChangesAnnounced, resources: noChangesAnnounced, prompts: noChangesAnnounced } },
  );
  server.server.fallbackRequestHandler = (request: Asked) => {
    const refusedCall = Option.getOrUndefined(refusedCallOf(request, refusal, tools));
    return refusedCall === undefined
      ? Promise.reject(new ProtocolError(refusalCode, refusal.detail, problem))
      : Promise.resolve(refusedCall);
  };
  return server;
}
