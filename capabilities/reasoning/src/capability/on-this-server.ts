import { listed } from '@on.auto/phrasing';

import { aliasPatternOf, isWildcardAlias } from '../model/model-alias.ts';
import type { OfferedModels } from '../model/offered-models.ts';
import { unknownWindows, type InputTokensAllowed } from './run-bounds.ts';

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

const counted = new Intl.NumberFormat('en');

function budgetInWords({ defaultInputTokens, mostInputTokens }: InputTokensAllowed): string {
  const most = counted.format(mostInputTokens);
  return defaultInputTokens < mostInputTokens
    ? `a run reads at most ${counted.format(defaultInputTokens)} input tokens, or its function's max_input_tokens, up to ${most}`
    : `a run reads at most ${most} input tokens, which max_input_tokens may only lower`;
}

function setupOf({ providers, aliases }: OfferedModels, providerSetup: string | undefined): string {
  return providers.length === 0 && aliases.length === 0 && providerSetup !== undefined ? ` ${providerSetup}` : '';
}

interface ServerOffer {
  readonly offered: OfferedModels;
  readonly toolsConfigured: boolean;
  readonly reading?: InputTokensAllowed | undefined;
  readonly providerSetup?: string | undefined;
}

export function onThisServer({
  offered,
  toolsConfigured,
  reading = unknownWindows,
  providerSetup,
}: ServerOffer): string {
  const offer = [modelsOf(offered), toolsOf(toolsConfigured), budgetInWords(reading)].join('; ');
  return `On this server, ${offer}.${setupOf(offered, providerSetup)}`;
}
