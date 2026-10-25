import { Effect } from 'effect';

import { generation } from '../model-calls/generation.ts';
import type { ModelAccessOptions } from '../providers/model-access-options.ts';
import type { ModelFactory } from '../providers/sdk-model.ts';
import { gatewayOptionsCheck } from '../settings/gateway-options.ts';
import { providersShowingMessages, secretScrubber } from '../settings/message-exposure.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import type { ProviderStatus } from '../settings/provider-status.ts';
import { LanguageModel } from './language-model.ts';
import { modelResolution } from './model-resolution.ts';

export function resolvedLanguageModel(
  models: ReadonlyMap<string, ModelFactory>,
  settings: ModelSettings,
  status: ProviderStatus,
  { reportProviderMessage, reportOperatorHint, telemetry }: ModelAccessOptions,
): LanguageModel['Service'] {
  const showing = providersShowingMessages(settings);
  return LanguageModel.of(
    generation(modelResolution(models, settings, status), {
      configured: status.configured,
      showsProviderMessages: (provider) => showing.has(provider),
      scrub: secretScrubber(settings),
      report: reportProviderMessage ?? (() => Effect.void),
      reportHint: reportOperatorHint ?? (() => Effect.void),
      admitsOptions: gatewayOptionsCheck(settings.gateways),
      telemetry,
    }),
  );
}
