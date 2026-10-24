import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import type { ProxySettings } from '@on.auto/outbound';
import {
  defineListModels,
  installedPackages,
  makeModelAccess,
  makeReasoningFunctionAdapter,
  offeredModels,
  providerStatus,
  type LanguageModel,
  type ModelAccess,
  type ModelCatalog,
  type ModelSettings,
  type ModelTelemetry,
} from '@on.auto/reasoning';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Context, Effect, Layer } from 'effect';

import { logReasoning } from '../logging/logging.ts';
import { logModelProviders, logOperatorHint, logProviderMessage } from '../logging/provider-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export type ModelAccessOf = (
  settings: ModelSettings,
  proxy: ProxySettings,
  telemetry?: ModelTelemetry,
) => Effect.Effect<ModelAccess>;

export interface ReasoningServices {
  readonly tools: ToolAccess;
  readonly telemetry: ModelTelemetry | undefined;
}

export interface ServedReasoning {
  readonly capability: ReturnType<typeof makeReasoningFunctionAdapter>;
  readonly listModels: ReturnType<typeof defineListModels>;
}

type ReasoningSettings = Pick<Settings, 'models' | 'proxy' | 'reasoning' | 'providerSetup'>;

export class ComposedModels extends Context.Service<ComposedModels, ModelAccess>()('@on.auto/server/ComposedModels') {}

export const loggedModelAccess: ModelAccessOf = (settings, proxy, telemetry) =>
  makeModelAccess(settings, {
    proxy,
    reportProviderMessage: logProviderMessage,
    reportOperatorHint: logOperatorHint,
    telemetry,
  });

export function modelsComposedBy(
  { models, proxy, providerSetup }: ReasoningSettings,
  modelAccessOf: ModelAccessOf,
  telemetry?: ModelTelemetry,
): Layer.Layer<ComposedModels> {
  return Layer.effect(ComposedModels, modelAccessOf({ ...models, providerSetup }, proxy, telemetry));
}

function languageModelOf(models: Effect.Effect<ModelAccess>): LanguageModel['Service'] {
  return {
    admit: (request) => Effect.flatMap(models, ({ languageModel }) => languageModel.admit(request)),
    generate: (request) => Effect.flatMap(models, ({ languageModel }) => languageModel.generate(request)),
  };
}

function catalogOf(models: Effect.Effect<ModelAccess>): ModelCatalog {
  return {
    list: (provider) => Effect.flatMap(models, ({ catalog }) => catalog.list(provider)),
    contextWindowOf: (model) => Effect.flatMap(models, ({ catalog }) => catalog.contextWindowOf(model)),
  };
}

export async function reasoningServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: ReasoningSettings,
  models: Effect.Effect<ModelAccess>,
  { tools, telemetry }: ReasoningServices,
): Promise<ServedReasoning> {
  const status = providerStatus(settings.models, installedPackages());
  await runtime.run(logModelProviders(status));
  const { mostInputTokens } = settings.reasoning;
  await runtime.run(logReasoning(mostInputTokens));
  const catalog = catalogOf(models);
  return {
    capability: makeReasoningFunctionAdapter({
      languageModel: languageModelOf(models),
      offered: offeredModels(status.configured, settings.models.aliases, settings.models.allowed),
      tools,
      content: runtimeLedger(runtime).content,
      telemetry,
      reading: { mostInputTokens, contextWindowOf: catalog.contextWindowOf },
      providerSetup: settings.providerSetup,
    }),
    listModels: defineListModels(catalog, settings.providerSetup),
  };
}
