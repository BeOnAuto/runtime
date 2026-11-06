import { generateText, isStepCount, NoObjectGeneratedError, wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { Result, type Schema } from 'effect';

import type { ModelRequest } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import { describedInstructions } from '../schema/described-answers.ts';
import { jsonOutput } from '../schema/json-output.ts';
import { costOf, isRefusal, type SdkWarning } from './answer-mapping.ts';
import { answerRepairedOnce, type Asking } from './answer-repair.ts';
import {
  describedOutput,
  projected,
  readOutput,
  settledAnswer,
  unreadAnswerOf,
  type CallMode,
  type ReadOutput,
  type Responded,
  type SdkResult,
  type SettledAnswer,
  type UnreadAnswer,
} from './answer-settling.ts';
import {
  callSettingsOf,
  promptOf,
  providerOptionsOf,
  retriesOf,
  telemetryOf,
  toolsOf,
  type CallTelemetry,
} from './call-options.ts';

type DoGenerate = Parameters<NonNullable<LanguageModelMiddleware['wrapGenerate']>>[0]['doGenerate'];

interface SentRequest {
  readonly instructions?: unknown;
  readonly messages: unknown;
  readonly tools?: unknown;
}

const utf8 = new TextEncoder();

function bytesSent({ instructions, messages, tools }: SentRequest, schema: Schema.JsonObject | undefined): number {
  return utf8.encode(JSON.stringify({ instructions, messages, tools, schema })).byteLength;
}

function schemaSentOf({ takesSchemas }: ModelTarget, { output }: ModelRequest): Schema.JsonObject | undefined {
  return takesSchemas && output.type === 'json' ? output.schema.document : undefined;
}

interface RespondingModel {
  readonly model: ReturnType<typeof wrapLanguageModel>;
  readonly responded: () => Responded;
}

function respondingModel(target: ModelTarget): RespondingModel {
  const response: { id: string | null; cost: number | undefined; refused: boolean; warnings: readonly SdkWarning[] } = {
    id: null,
    cost: undefined,
    refused: false,
    warnings: [],
  };
  const model = wrapLanguageModel({
    model: target.model(),
    middleware: {
      wrapGenerate: async ({ doGenerate }: { readonly doGenerate: DoGenerate }) => {
        const generated = await doGenerate();
        response.id = generated.response?.id ?? null;
        response.cost = costOf(generated.response?.headers, target.costHeader);
        response.refused = isRefusal(generated.response?.body);
        response.warnings = generated.warnings;
        return generated;
      },
    },
  });
  return {
    model,
    responded: () => ({
      id: response.id,
      cost: response.cost === undefined ? {} : { cost_usd: response.cost },
      refused: response.refused,
      warnings: response.warnings,
    }),
  };
}

const described: CallMode = { output_mode: 'described' };

const toolCallsAsked: ReadOutput = { kind: 'text' };

function requestedOf(request: ModelRequest, signal: Readonly<AbortSignal>, telemetry: CallTelemetry) {
  return {
    ...promptOf(request),
    ...callSettingsOf(request.settings),
    ...providerOptionsOf(request.provider_options),
    ...telemetryOf(telemetry),
    ...toolsOf(request.tools),
    stopWhen: isStepCount(1),
    abortSignal: signal,
    maxRetries: retriesOf(request),
  };
}

function askedOf(request: ModelRequest, { repairing }: Asking) {
  const { messages } = promptOf(request);
  if (repairing === undefined) {
    return { messages };
  }
  const told = [
    { role: 'assistant' as const, content: repairing.answer },
    { role: 'user' as const, content: repairing.words },
  ];
  return { messages: [...messages, ...told] };
}

function outputOf(result: SdkResult, { repairing }: Asking, read: () => ReadOutput): ReadOutput {
  return repairing === undefined && result.finishReason === 'tool-calls' ? toolCallsAsked : read();
}

function unreadOf(target: ModelTarget, error: unknown, responded: Responded, requestBytes: number): UnreadAnswer {
  if (!NoObjectGeneratedError.isInstance(error)) {
    throw error;
  }
  const { text, finishReason, usage, cause } = error;
  const reply = { text, finishReason, usage, modelId: error.response?.modelId, cause };
  return unreadAnswerOf(target, reply, responded, requestBytes);
}

export async function modelAnswer(
  target: ModelTarget,
  request: ModelRequest,
  signal: Readonly<AbortSignal>,
  telemetry: CallTelemetry,
): Promise<SettledAnswer> {
  const { model, responded } = respondingModel(target);
  const sent = { bytes: 0 };
  const schema = schemaSentOf(target, request);
  const call = {
    model,
    ...requestedOf(request, signal, telemetry),
    onLanguageModelCallStart: (started: SentRequest) => {
      sent.bytes = bytesSent(started, schema);
    },
  };
  const answerOf = (result: SdkResult, asking: Asking, read: () => ReadOutput): UnreadAnswer => ({
    generated: projected(result, responded(), sent.bytes),
    output: outputOf(result, asking, read),
  });
  const { output } = request;
  if (output.type === 'text') {
    return settledAnswer(target, projected(await generateText(call), responded(), sent.bytes), { kind: 'text' });
  }
  if (!target.takesSchemas) {
    const instructions = describedInstructions(request.instructions, output.schema.document);
    return answerRepairedOnce(target, request, {
      mode: described,
      ask: async (asking) => {
        const result = await generateText({ ...call, ...askedOf(request, asking), instructions });
        return answerOf(result, asking, () => describedOutput(result.text, output));
      },
    });
  }
  const enforced = jsonOutput(output);
  if (Result.isFailure(enforced)) {
    return Result.fail(enforced.failure);
  }
  return answerRepairedOnce(target, request, {
    mode: {},
    ask: async (asking) => {
      try {
        const result = await generateText({ ...call, ...askedOf(request, asking), output: enforced.success });
        return answerOf(result, asking, () => readOutput(() => result.output));
      } catch (error) {
        return unreadOf(target, error, responded(), sent.bytes);
      }
    },
  });
}
