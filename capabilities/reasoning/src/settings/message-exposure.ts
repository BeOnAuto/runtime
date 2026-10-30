import { Predicate, Redacted } from 'effect';

import type { ModelSettings } from './model-settings.ts';
import type { Availability } from './setting-values.ts';

type Showing = readonly [string, boolean];

const leastSecretCharacters = 8;

function when<S>(availability: Availability<S>, atDefaultEndpoint: (settings: S) => boolean): boolean {
  return availability.configured && atDefaultEndpoint(availability.settings);
}

export function providersShowingMessages(settings: ModelSettings): ReadonlySet<string> {
  const bedrock = when(settings.bedrock, ({ endpoint }) => endpoint === null);
  const showing: readonly Showing[] = [
    ['anthropic', when(settings.anthropic, ({ base_url }) => base_url === null)],
    ['openai', when(settings.openai, ({ base_url }) => base_url === null)],
    ['google', settings.google.configured],
    ['bedrock', bedrock],
    ['bedrock-anthropic', bedrock],
    ['azure', when(settings.azure, ({ endpoint }) => 'resource_name' in endpoint)],
    ['vertex', settings.vertex.configured],
    ['vertex-anthropic', settings.vertex.configured],
    ...settings.gateways.map(({ name, expose_provider_messages }): Showing => [name, expose_provider_messages]),
  ];
  return new Set(showing.filter(([, shows]) => shows).map(([provider]) => provider));
}

function secretsIn(value: unknown): readonly string[] {
  if (Redacted.isRedacted(value)) {
    return [String(Redacted.value(value))];
  }
  if (value instanceof Map) {
    return [...value.values()].flatMap((entry: unknown) => secretsIn(entry));
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry: unknown) => secretsIn(entry));
  }
  return Predicate.isObject(value) ? Object.values(value).flatMap((entry: unknown) => secretsIn(entry)) : [];
}

export function secretScrubber(settings: ModelSettings): (text: string) => string {
  const secrets = secretsIn(settings).filter((secret) => secret.length >= leastSecretCharacters);
  return (text) => secrets.reduce((scrubbed, secret) => scrubbed.replaceAll(secret, '[redacted]'), text);
}
