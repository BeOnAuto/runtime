import { Clock, Effect, Metric } from 'effect';

import type { ToolReference } from '../names/tool-reference.ts';
import type { ServerType } from '../settings/server-settings.ts';

export interface TracedServer {
  readonly type: ServerType;
  readonly connection: string | null;
}

type CallEnding = Readonly<Record<string, string>>;

type EndCall = (ending: CallEnding) => Effect.Effect<void>;

const operationSeconds = Metric.histogram('mcp.client.operation.duration', {
  description: 'How long a call of a tool of an MCP server took, in seconds',
  boundaries: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
});

const untraced: EndCall = () => Effect.void;

export function refusedEnding(refused: string, because: string): CallEnding {
  return { 'error.type': refused, 'auto.on.tool_call.because': because };
}

export function answeredEnding(outcome: string): CallEnding {
  return outcome === 'result' ? {} : { 'error.type': outcome };
}

function connectionAttributeOf(connection: string | null): Readonly<Record<string, string>> {
  return connection === null ? {} : { 'auto.on.connection_id': connection };
}

function spanned<A, E, R>(
  { server, tool }: ToolReference,
  connection: string | null,
  calling: (endCall: EndCall) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  const attributes = {
    'mcp.method.name': 'tools/call',
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': tool,
    'auto.on.tool_server': server,
  };
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const endCall: EndCall = (ending) =>
      Effect.gen(function* () {
        const finished = yield* Clock.currentTimeMillis;
        yield* Effect.annotateCurrentSpan(ending);
        yield* Metric.update(
          Metric.withAttributes(operationSeconds, { ...attributes, ...ending }),
          (finished - started) / 1000,
        );
      });
    return yield* calling(endCall);
  }).pipe(
    Effect.withSpan(`tools/call ${tool}`, {
      kind: 'client',
      attributes: { ...attributes, ...connectionAttributeOf(connection) },
    }),
  );
}

export function traced<A, E, R>(
  reference: ToolReference,
  server: TracedServer,
  calling: (endCall: EndCall) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return server.type === 'openapi' ? calling(untraced) : spanned(reference, server.connection, calling);
}

export function tracedByHand<A extends { readonly outcome: string }, E, R>(
  reference: ToolReference,
  server: TracedServer,
  calling: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return traced(reference, server, (endCall) =>
    calling.pipe(Effect.tap(({ outcome }) => endCall(answeredEnding(outcome)))),
  );
}
