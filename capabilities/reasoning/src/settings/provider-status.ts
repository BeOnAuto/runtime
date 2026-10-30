import type { ModelSettings } from './model-settings.ts';
import type { AzureSettings } from './provider-settings.ts';
import { unconfigured, type Availability } from './setting-values.ts';

export interface UnconfiguredProvider {
  readonly provider: string;
  readonly missing: readonly string[];
  readonly partial?: true;
}

export interface ProviderStatus {
  readonly configured: readonly string[];
  readonly unconfigured: readonly UnconfiguredProvider[];
}

export interface OptionalPackages {
  readonly entraId: boolean;
}

const entraIdPackage = '@azure/identity';

interface ProviderAvailability {
  readonly provider: string;
  readonly availability: Availability<unknown>;
}

function azureAvailability(
  azure: Availability<AzureSettings>,
  packages: OptionalPackages,
): Availability<AzureSettings> {
  const credentialMissing = azure.configured && azure.settings.api_key === null && !packages.entraId;
  return credentialMissing
    ? unconfigured([`AZURE_API_KEY, or the optional package ${entraIdPackage} for Microsoft Entra ID`], true)
    : azure;
}

function availabilities(settings: ModelSettings, packages: OptionalPackages): readonly ProviderAvailability[] {
  return [
    { provider: 'anthropic', availability: settings.anthropic },
    { provider: 'openai', availability: settings.openai },
    { provider: 'google', availability: settings.google },
    { provider: 'bedrock', availability: settings.bedrock },
    { provider: 'bedrock-anthropic', availability: settings.bedrock },
    { provider: 'azure', availability: azureAvailability(settings.azure, packages) },
    { provider: 'vertex', availability: settings.vertex },
    { provider: 'vertex-anthropic', availability: settings.vertex },
  ];
}

function unconfiguredProvider(
  provider: string,
  { missing, partial }: Omit<UnconfiguredProvider, 'provider'>,
): UnconfiguredProvider {
  return partial === true ? { provider, missing, partial } : { provider, missing };
}

export function providerStatus(settings: ModelSettings, packages: OptionalPackages): ProviderStatus {
  const all = availabilities(settings, packages);
  return {
    configured: [
      ...all.filter(({ availability }) => availability.configured).map(({ provider }) => provider),
      ...settings.gateways.map(({ name }) => name),
    ],
    unconfigured: all.flatMap(({ provider, availability }) =>
      availability.configured ? [] : [unconfiguredProvider(provider, availability)],
    ),
  };
}
