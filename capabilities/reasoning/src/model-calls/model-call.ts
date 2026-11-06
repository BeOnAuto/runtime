import { generateText, isStepCount, wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { Result } from 'effect';

import type { ModelRequest } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import { describedInstructions } from '../schema/described-answers.ts';
import { jsonOutput } from '../schema/json-output.ts';
import { costOf } from './answer-mapping.ts';
import {
  describedOutput,
  projected,
  readOutput,
  settledAnswer,
  type CallMode,
  type ReadOutput,
  type Responded,
  type SdkResult,
  type SettledAnswer,
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

function bytesSent({ instructions, messages, tools }: SentRequest): number {
  return utf8.encode(JSON.stringify({ instructions, messages, tools })).byteLength;
}

interface RespondingModel {
  readonly model: ReturnType<typeof wrapLanguageModel>;
  readonly responded: () => Responded;
}

function respondingModel(target: ModelTarget): RespondingModel {
  const response: { id: string | null; cost: number | undefined } = { id: null, cost: undefined };
  const model = wrapLanguageModel({
    model: target.model(),
    middleware: {
      wrapGenerate: async ({ doGenerate }: { readonly doGenerate: DoGenerate }) => {
        const generated = await doGenerate();
        response.id = generated.response?.id ?? null;
        response.cost = costOf(generated.response?.headers, target.costHeader);
        return generated;
      },
    },
  });
  return {
    model,
    responded: () => ({ id: response.id, cost: response.cost === undefined ? {} : { cost_usd: response.cost } }),
  };
}

const described: CallMode = { output_mode: 'described' };

function askedTools({ finishReason }: Pick<SdkResult, 'finishReason'>): boolean {
  return finishReason === 'tool-calls';
}

export async function modelAnswer(
  target: ModelTarget,
  request: ModelRequest,
  signal: Readonly<AbortSignal>,
  telemetry: CallTelemetry,
): Promise<SettledAnswer> {
  const { model, responded } = respondingModel(target);
  const sent = { bytes: 0 };
  const call = {
    model,
    ...promptOf(request),
    ...callSettingsOf(request.settings),
    ...providerOptionsOf(request.provider_options),
    ...telemetryOf(telemetry),
    ...toolsOf(request.tools),
    stopWhen: isStepCount(1),
    abortSignal: signal,
    maxRetries: retriesOf(request),
    onLanguageModelCallStart: (started: SentRequest) => {
      sent.bytes = bytesSent(started);
    },
  };
  const settled = (result: SdkResult, output: ReadOutput, mode?: CallMode) =>
    settledAnswer(target, projected(result, responded(), sent.bytes), output, mode);
  const { output } = request;
  if (output.type === 'text') {
    return settled(await generateText(call), { kind: 'text' });
  }
  if (!target.takesSchemas) {
    const instructions = describedInstructions(request.instructions, output.schema.document);
    const result = await generateText({ ...call, instructions });
    return settled(result, askedTools(result) ? { kind: 'text' } : describedOutput(result.text, output), described);
  }
  const enforced = jsonOutput(output);
  if (Result.isFailure(enforced)) {
    return Result.fail(enforced.failure);
  }
  const result = await generateText({ ...call, output: enforced.success });
  return settled(result, askedTools(result) ? { kind: 'text' } : readOutput(() => result.output));
}
