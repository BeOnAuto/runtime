import type { OfferedTool } from '@on.auto/tool-servers';
import { failureReply } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';

import type { ModelTelemetry } from '../adapter/model-access-options.ts';
import type { LanguageModel } from '../model/language-model.ts';
import { requestCompiler } from './compiled-request.ts';
import type { PerformJob, ToolCallAnswer, ToolCallJob } from './jobs.ts';

export type ToolCallTelemetry = Pick<ModelTelemetry, 'recordContent'> | undefined;

function toolCallSpan({ callId, tool, input }: ToolCallJob, telemetry: ToolCallTelemetry) {
  return {
    kind: 'internal' as const,
    attributes: {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': tool,
      'gen_ai.tool.call.id': callId,
      'gen_ai.tool.type': 'function',
      ...(telemetry?.recordContent === true ? { 'gen_ai.tool.call.arguments': JSON.stringify(input) } : {}),
    },
  };
}

function resultShown({ reply }: ToolCallAnswer, telemetry: ToolCallTelemetry): Effect.Effect<void> {
  return telemetry?.recordContent === true
    ? Effect.annotateCurrentSpan('gen_ai.tool.call.result', reply.text)
    : Effect.void;
}

function notOffered({ tool, server }: ToolCallJob): ToolCallAnswer {
  const data = {
    because: 'server_failure' as const,
    detail: `This process offers no tool ${tool}, so the call was not sent`,
    duration_ms: 0,
    jsonrpc_id: null,
  };
  return { ended: { type: 'tool_call_failed', data }, reply: failureReply(data, server) };
}

function toolCalled(offered: ReadonlyMap<string, OfferedTool>, job: ToolCallJob, telemetry: ToolCallTelemetry) {
  const { callId, tool, input, room } = job;
  const named = offered.get(tool);
  const answered: Effect.Effect<ToolCallAnswer> =
    named === undefined
      ? Effect.succeed(notOffered(job))
      : Effect.promise((signal: Readonly<AbortSignal>) =>
          named.send({ callId, input, ...(room === undefined ? {} : { room }) }, signal),
        );
  return answered.pipe(
    Effect.tap((answer) => resultShown(answer, telemetry)),
    Effect.withSpan(`execute_tool ${tool}`, toolCallSpan(job, telemetry)),
  );
}

export function performedInProcess(
  languageModel: LanguageModel['Service'],
  telemetry?: ToolCallTelemetry,
): (offered: readonly OfferedTool[]) => PerformJob {
  return (offered) => {
    const byName = new Map(offered.map((tool) => [tool.name, tool]));
    const compiledRequest = requestCompiler();
    return {
      modelCall: ({ request }) => Effect.flatMap(Effect.fromResult(compiledRequest(request)), languageModel.generate),
      toolCall: (job) => toolCalled(byName, job, telemetry),
    };
  };
}
