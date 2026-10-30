import { listed } from '@on.auto/operations';

import { aliasPatternOf, isWildcardAlias } from '../model/model-alias.ts';
import type { OfferedModels } from '../model/offered-models.ts';

const noProvider =
  'no model provider is configured yet, so a reasoning function cannot run until whoever runs the server configures one';

function anyModelUnder(wildcards: readonly string[]): string {
  const examples = wildcards.map((wildcard) => `${aliasPatternOf(wildcard).prefix}<model id>`).join(' or ');
  return `, where a name that ends in * stands for any model id, so ${examples} runs`;
}

function namedModels(aliases: readonly string[]): string {
  const wildcards = aliases.filter((alias) => isWildcardAlias(alias));
  return `${aliases.join(', ')}${wildcards.length === 0 ? '' : anyModelUnder(wildcards)}`;
}

function modelsOf({ providers, aliases }: OfferedModels): string {
  if (providers.length === 0) {
    return aliases.length === 0
      ? noProvider
      : `a reasoning function names one of the models its operator named: ${namedModels(aliases)}`;
  }
  const examples = providers.map((provider) => `${provider}/<model id>`).join(' or ');
  const named = aliases.length === 0 ? '' : `, or one of the models its operator named: ${namedModels(aliases)}`;
  return `a reasoning function names its model through ${listed(providers)}, written ${examples}${named}`;
}

function toolsOf(toolsConfigured: boolean): string {
  return toolsConfigured
    ? 'it may name the tools of the tool servers that search finds'
    : 'no tool server is configured, so it may name no tools';
}

function setupOf({ providers, aliases }: OfferedModels, providerSetup: string | undefined): string {
  return providers.length === 0 && aliases.length === 0 && providerSetup !== undefined ? ` ${providerSetup}` : '';
}

export function onThisServer(offered: OfferedModels, toolsConfigured: boolean, providerSetup?: string): string {
  return `On this server, ${modelsOf(offered)}; ${toolsOf(toolsConfigured)}.${setupOf(offered, providerSetup)}`;
}
