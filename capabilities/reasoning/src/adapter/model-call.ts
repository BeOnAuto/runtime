import { generateText, wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { Array as Arr, Result } from 'effect';

import type { ModelRequest, ToolCallSignals } from '../model/model-request.ts';
import { toolLoop, turnsOf } from '../tools/tool-loop.ts';
import { costOf } from './answer-mapping.ts';
import { projected, readOutput, settledAnswer, type Responded, type SettledAnswer } from './answer-settling.ts';
import {
  callSettingsOf,
  promptOf,
  providerOptionsOf,
  retriesOf,
  telemetryOf,
  type CallTelemetry,
} from './call-options.ts';
import { jsonOutput } from './json-output.ts';
import type { ModelTarget } from './model-resolution.ts';
import type { StepDeadline } from './stopped-call.ts';

type DoGenerate = Parameters<NonNullable<LanguageModelMiddleware['wrapGenerate']>>[0]['doGenerate'];

type Turns = ReturnType<typeof turnsOf>;

interface RespondingModel {
  readonly model: ReturnType<typeof wrapLanguageModel>;
  readonly responded: () => Responded;
}

function summedCost(costs: readonly number[]): Responded['cost'] {
  return costs.length === 0 ? {} : { cost_usd: costs.reduce((total, cost) => total + cost, 0) };
}

function respondingModel(target: ModelTarget): RespondingModel {
  const response: { id: string | null; costs: number[] } = { id: null, costs: [] };
  const model = wrapLanguageModel({
    model: target.model(),
    middleware: {
      wrapGenerate: async ({ doGenerate }: { readonly doGenerate: DoGenerate }) => {
        const generated = await doGenerate();
        response.id = generated.response?.id ?? null;
        response.costs.push(...Arr.fromNullishOr(costOf(generated.response?.headers, target.costHeader)));
        return generated;
      },
    },
  });
  return { model, responded: () => ({ id: response.id, cost: summedCost(response.costs) }) };
}

function callOf(request: ModelRequest, step: StepDeadline, turns: Turns) {
  return {
    ...promptOf(request),
    ...callSettingsOf(request.settings),
    ...providerOptionsOf(request.provider_options),
    onLanguageModelCallStart: (sent: Parameters<Turns['started']>[0]) => {
      step.started();
      turns.started(sent);
    },
    onLanguageModelCallEnd: (answered: Parameters<Turns['ended']>[0]) => {
      step.ended();
      turns.ended(answered);
    },
    maxRetries: retriesOf(request),
  };
}

interface Calling {
  readonly step: StepDeadline;
  readonly telemetry?: CallTelemetry;
}

interface CallHooks extends Calling {
  readonly turns: Turns;
}

export interface CallingModel {
  readonly turns: Turns;
  readonly settled: Promise<SettledAnswer>;
}

async function modelAnswer(
  target: ModelTarget,
  request: ModelRequest,
  signals: ToolCallSignals,
  { step, turns, telemetry }: CallHooks,
): Promise<SettledAnswer> {
  const { model, responded } = respondingModel(target);
  const loop = toolLoop(request.tools, signals.cancelled, turns);
  const { tools, prepareStep, stopWhen } = loop;
  const call = {
    model,
    ...callOf(request, step, turns),
    ...telemetryOf(telemetry),
    tools: { ...tools },
    prepareStep,
    stopWhen,
    abortSignal: signals.signal,
  };
  if (request.output.type === 'text') {
    const result = await generateText(call);
    return (
      loop.unanswered(target.provider, result.finishReason, result.usage) ??
      settledAnswer(target, projected(result, responded()), { kind: 'text' }, request.tools)
    );
  }
  const output = jsonOutput(request.output);
  if (Result.isFailure(output)) {
    return Result.fail(output.failure);
  }
  const result = await generateText({ ...call, output: output.success });
  return (
    loop.unanswered(target.provider, result.finishReason, result.usage) ??
    settledAnswer(
      target,
      projected(result, responded()),
      readOutput(() => result.output),
      request.tools,
    )
  );
}

export function callingModel(
  target: ModelTarget,
  request: ModelRequest,
  signals: ToolCallSignals,
  { step, telemetry }: Calling,
): CallingModel {
  const turns = turnsOf(request.tools);
  return { turns, settled: modelAnswer(target, request, signals, { step, turns, telemetry }) };
}
