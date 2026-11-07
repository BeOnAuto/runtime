import { generateText, isStepCount, NoObjectGeneratedError, wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { Result, type Schema } from 'effect';

import type { JsonOutput, ModelRequest } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import { describedInstructions, portableOutput, unreadableSchemaOf } from '../schema/json-output.ts';
import { costOf, isRefusal, type SdkWarning } from './answer-mapping.ts';
import { answerModeFor, type PortableMode } from './answer-mode.ts';
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

const portable: CallMode = { output_mode: 'portable' };

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

export interface Calling {
  readonly signal: Readonly<AbortSignal>;
  readonly telemetry: CallTelemetry;
  readonly calledAt: number;
  readonly refusal?: CallMode['schema_refusal'];
}

function describedModeOf(refusal: CallMode['schema_refusal']): CallMode {
  return refusal === undefined ? described : { ...described, schema_refusal: refusal };
}

function preparedCall(
  target: ModelTarget,
  request: ModelRequest,
  { signal, telemetry }: Calling,
  schema?: Schema.JsonObject,
) {
  const { model, responded } = respondingModel(target);
  const sent = { bytes: 0 };
  const call = {
    model,
    ...requestedOf(request, signal, telemetry),
    onLanguageModelCallStart: (started: SentRequest) => {
      sent.bytes = bytesSent(started, schema);
    },
  };
  const generatedOf = (result: SdkResult) => projected(result, responded(), sent.bytes);
  return {
    call,
    generatedOf,
    answerOf: (result: SdkResult, asking: Asking, read: () => ReadOutput): UnreadAnswer => ({
      generated: generatedOf(result),
      output: outputOf(result, asking, read),
    }),
    unreadAfter: (error: unknown) => unreadOf(target, error, responded(), sent.bytes),
  };
}

interface JsonAsked {
  readonly target: ModelTarget;
  readonly request: ModelRequest;
  readonly output: JsonOutput;
  readonly calling: Calling;
}

function describedAnswer({ target, request, output, calling }: JsonAsked): Promise<SettledAnswer> {
  const { call, answerOf } = preparedCall(target, request, calling);
  const instructions = describedInstructions(request.instructions, output.schema.document);
  return answerRepairedOnce(target, request, {
    mode: describedModeOf(calling.refusal),
    calledAt: calling.calledAt,
    ask: async (asking) => {
      const result = await generateText({ ...call, ...askedOf(request, asking), instructions });
      return answerOf(result, asking, () => describedOutput(result.text, output));
    },
  });
}

function portableAnswer(
  { target, request, output, calling }: JsonAsked,
  { form }: PortableMode,
): Promise<SettledAnswer> {
  const { call, answerOf, unreadAfter } = preparedCall(target, request, calling, form.sent);
  const enforced = portableOutput(output, form);
  return answerRepairedOnce(target, request, {
    mode: portable,
    calledAt: calling.calledAt,
    ask: async (asking) => {
      try {
        const result = await generateText({ ...call, ...askedOf(request, asking), output: enforced });
        return answerOf(result, asking, () => readOutput(() => result.output));
      } catch (error) {
        return unreadAfter(error);
      }
    },
  });
}

export async function modelAnswer(
  target: ModelTarget,
  request: ModelRequest,
  calling: Calling,
): Promise<SettledAnswer> {
  const { output } = request;
  if (output.type === 'text') {
    const { call, generatedOf } = preparedCall(target, request, calling);
    return settledAnswer(target, generatedOf(await generateText(call)), { kind: 'text' });
  }
  const unreadable = target.takesSchemas ? unreadableSchemaOf(output) : undefined;
  if (unreadable !== undefined) {
    return Result.fail(unreadable);
  }
  const asked = { target, request, output, calling };
  const chosen = answerModeFor(target, output);
  return chosen.mode === 'portable' ? portableAnswer(asked, chosen) : describedAnswer(asked);
}
