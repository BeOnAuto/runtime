import type { OperatorHintReport, ProviderMessageReport, ProviderStatus } from '@on.auto/reasoning';
import { Effect } from 'effect';

const howToConfigureAModel = 'set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY or MODEL_GATEWAYS';

interface ProviderAnnotation {
  readonly provider: string;
  readonly configured: boolean;
  readonly missing?: readonly string[];
}

function providerAnnotations({ configured, unconfigured }: ProviderStatus): readonly ProviderAnnotation[] {
  return [
    ...configured.map((provider) => ({ provider, configured: true })),
    ...unconfigured.map(({ provider, missing }) => ({ provider, configured: false, missing })),
  ];
}

function providersSummary({ configured }: ProviderStatus): Effect.Effect<void> {
  return configured.length === 0
    ? Effect.logWarning(`No model provider is configured, so reasoning functions cannot run; ${howToConfigureAModel}`)
    : Effect.logInfo(`Model providers configured: ${configured.join(', ')}`);
}

export function logModelProviders(status: ProviderStatus): Effect.Effect<void> {
  const partlyConfigured = status.unconfigured.filter(({ partial }) => partial === true);
  return Effect.all(
    [
      providersSummary(status).pipe(Effect.annotateLogs({ providers: providerAnnotations(status) })),
      ...partlyConfigured.map(({ provider, missing }) =>
        Effect.logWarning(`Model provider ${provider} is not configured; it needs ${missing.join(' and ')}`).pipe(
          Effect.annotateLogs({ provider, configured: false, missing }),
        ),
      ),
    ],
    { discard: true },
  );
}

export function logProviderMessage({
  provider,
  model,
  status,
  message,
  run_id,
}: ProviderMessageReport): Effect.Effect<void> {
  return Effect.logWarning(`Model provider ${provider} answered with an error`).pipe(
    Effect.annotateLogs({ provider, model, status, run_id, provider_message: message }),
  );
}

export function logOperatorHint({ provider, model, hint, run_id }: OperatorHintReport): Effect.Effect<void> {
  return Effect.logWarning(`Model provider ${provider} could not be called: ${hint}`).pipe(
    Effect.annotateLogs({ provider, model, run_id }),
  );
}
