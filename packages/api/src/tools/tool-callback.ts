import type { CallToolResult } from '@modelcontextprotocol/server';
import { ServedAsTool, settle, type DispatcherServices, type Outcome } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { OrgCall } from '../hand-off/caller-hand-off.ts';
import { withDroppedArgument } from '../hand-off/dropped-arguments.ts';
import type { RunCall } from '../operations/operation-handler.ts';
import type { ReportThrown } from '../problem/error-boundary.ts';
import { linksOfMeta, underTraceParent } from '../tracing/trace-parent.ts';
import { toolResultOf, type ToolWords } from './tool-result.ts';

export type Arguments = Readonly<Record<string, unknown>>;

export type Dispatch = (input: Arguments) => Effect.Effect<Outcome, never, DispatcherServices>;

export interface CallServing {
  readonly runCall: RunCall;
  readonly reportThrown: ReportThrown;
}

export interface CalledTool extends ToolWords {
  readonly name: string;
  readonly dispatch: Dispatch;
  readonly operationInputOf: (input: Arguments) => Arguments;
}

export interface ToolContext {
  readonly mcpReq: {
    readonly id: string | number;
    readonly signal: AbortSignal;
    readonly _meta?: Readonly<Record<string, unknown>>;
    readonly envelope?: Readonly<Record<string, unknown>>;
    readonly requestState: () => unknown;
  };
}

const argumentsOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

function toolSpanOf(name: string, id: string | number, meta: Readonly<Record<string, unknown>> | undefined) {
  return Effect.withSpan(`tools/call ${name}`, {
    kind: 'server',
    attributes: {
      'mcp.method.name': 'tools/call',
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': name,
      'jsonrpc.request.id': String(id),
    },
    links: linksOfMeta(meta),
  });
}

export function callbackFor(
  { runCall, reportThrown }: CallServing,
  { requestId, trace, dropped, context }: OrgCall,
  { name, dispatch, operationInputOf, ...words }: CalledTool,
): (input: unknown, context: ToolContext) => Promise<CallToolResult> {
  return async (input, { mcpReq: { id, signal, _meta: meta } }) => {
    let operationInput: unknown = input;
    try {
      const restored = withDroppedArgument(
        argumentsOf(input),
        dropped.find((argument) => argument.id === id),
      );
      operationInput = operationInputOf(restored);
      const call = settle(dispatch(restored).pipe(Effect.provideContext(context)), signal).pipe(
        Effect.provideService(ServedAsTool, true),
        Effect.annotateLogs({ requestId }),
        toolSpanOf(name, id, meta),
      );
      return toolResultOf(await runCall(underTraceParent(call, trace)), signal.aborted, words, operationInput);
    } catch (thrown) {
      return toolResultOf(reportThrown(thrown, requestId), false, words, operationInput);
    }
  };
}
