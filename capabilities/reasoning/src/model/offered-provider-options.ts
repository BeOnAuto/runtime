import type { AmazonBedrockLanguageModelChatOptions } from '@ai-sdk/amazon-bedrock';
import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import type { GoogleLanguageModelOptions } from '@ai-sdk/google';
import type { OpenAILanguageModelChatOptions, OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai';
import { Predicate, type Schema } from 'effect';

type Withholding =
  | 'it attributes the request on the operator account'
  | 'it stores or reuses state on the operator account'
  | 'it chooses routing, fallbacks or capacity'
  | 'it sets request headers or betas'
  | 'it brings in tools or servers'
  | 'it adds raw fields to the request'
  | 'the front matter sets it'
  | 'the runtime manages conversation state'
  | 'it asks for output the runtime does not read'
  | 'it changes how the runtime sends the request';

interface Offered {
  readonly offered: true;
  readonly only?: readonly string[];
}

interface Withheld {
  readonly offered: false;
  readonly why: Withholding;
}

type Decision = Offered | Withheld;

type Decisions<Options> = { readonly [Option in keyof Options]-?: Decision };

interface OptionVerdict {
  readonly path: readonly string[];
  readonly detail: string;
}

const offered: Offered = { offered: true };

function withheld(why: Withholding): Withheld {
  return { offered: false, why };
}

const attribution = withheld('it attributes the request on the operator account');
const stored = withheld('it stores or reuses state on the operator account');
const routing = withheld('it chooses routing, fallbacks or capacity');
const headers = withheld('it sets request headers or betas');
const tools = withheld('it brings in tools or servers');
const rawFields = withheld('it adds raw fields to the request');
const frontMatter = withheld('the front matter sets it');
const conversation = withheld('the runtime manages conversation state');
const unreadOutput = withheld('it asks for output the runtime does not read');
const sending = withheld('it changes how the runtime sends the request');

const anthropic: Decisions<AnthropicLanguageModelOptions> = {
  thinking: { offered: true, only: ['type', 'budgetTokens', 'display'] },
  sendReasoning: conversation,
  structuredOutputMode: frontMatter,
  disableParallelToolUse: tools,
  cacheControl: stored,
  metadata: attribution,
  mcpServers: tools,
  container: stored,
  toolStreaming: tools,
  effort: frontMatter,
  taskBudget: conversation,
  speed: routing,
  serviceTier: routing,
  inferenceGeo: routing,
  fallbacks: routing,
  anthropicBeta: headers,
  safeguards: tools,
  compaction: conversation,
  contextManagement: conversation,
};

const openAi: Decisions<OpenAILanguageModelChatOptions & OpenAILanguageModelResponsesOptions> = {
  textVerbosity: offered,
  reasoningMode: offered,
  logitBias: offered,
  logprobs: unreadOutput,
  include: unreadOutput,
  reasoningSummary: unreadOutput,
  parallelToolCalls: tools,
  maxToolCalls: tools,
  includeWebSearchSources: tools,
  allowedTools: tools,
  user: attribution,
  safetyIdentifier: attribution,
  metadata: attribution,
  reasoningEffort: frontMatter,
  reasoningEffortUpdate: frontMatter,
  maxCompletionTokens: frontMatter,
  strictJsonSchema: frontMatter,
  instructions: frontMatter,
  store: stored,
  previousResponseId: stored,
  conversation: stored,
  promptCacheKey: stored,
  promptCacheOptions: stored,
  promptCacheRetention: stored,
  prediction: rawFields,
  serviceTier: routing,
  systemMessageMode: sending,
  forceReasoning: sending,
  passThroughUnsupportedFiles: sending,
  reasoningContext: conversation,
  truncation: conversation,
  contextManagement: conversation,
  compactionTrigger: conversation,
};

const google: Decisions<GoogleLanguageModelOptions> = {
  thinkingConfig: offered,
  safetySettings: offered,
  threshold: offered,
  responseModalities: unreadOutput,
  imageConfig: unreadOutput,
  audioTimestamp: unreadOutput,
  cachedContent: stored,
  structuredOutputs: frontMatter,
  labels: attribution,
  mediaResolution: sending,
  retrievalConfig: tools,
  streamFunctionCallArguments: tools,
  serviceTier: routing,
  sharedRequestType: headers,
  requestType: headers,
};

const bedrockConverse: Decisions<AmazonBedrockLanguageModelChatOptions> = {
  reasoningConfig: offered,
  structuredOutputMode: frontMatter,
  additionalModelRequestFields: rawFields,
  anthropicBeta: headers,
  serviceTier: routing,
  requestMetadata: attribution,
};

type OptionDecisions = Readonly<Record<string, Decision>>;

function stricter(first: Decision | undefined, second: Decision): Decision {
  return first === undefined || first.offered ? second : first;
}

function readBoth(first: OptionDecisions, second: OptionDecisions): OptionDecisions {
  const decided = Object.entries(second).map(
    ([option, decision]: readonly [string, Decision]): readonly [string, Decision] => [
      option,
      stricter(first[option], decision),
    ],
  );
  return { ...first, ...Object.fromEntries(decided) };
}

function sentAsTheyAre(decisions: OptionDecisions): OptionDecisions {
  return Object.fromEntries(Object.keys(decisions).map((option) => [option, rawFields]));
}

const namespaceDecisions: ReadonlyMap<string, OptionDecisions> = new Map([
  ['anthropic', anthropic],
  ['openai', openAi],
  ['azure', openAi],
  ['google', google],
  ['vertex', google],
  ['googleVertex', readBoth(google, anthropic)],
  ['amazonBedrock', bedrockConverse],
  ['bedrock', readBoth(bedrockConverse, sentAsTheyAre(anthropic))],
]);

export const providerNamespaces: readonly string[] = [...namespaceDecisions.keys()];

export type OptionCheck = (option: string, value: Schema.Json) => readonly OptionVerdict[];

function offeredIn(decisions: OptionDecisions): readonly string[] {
  return Object.entries(decisions)
    .filter(([, decision]: readonly [string, Decision]) => decision.offered)
    .map(([option]: readonly [string, Decision]) => option);
}

function nestedVerdicts(option: string, only: readonly string[], value: Schema.Json): readonly OptionVerdict[] {
  const keys = Predicate.isObject(value) && !Array.isArray(value) ? Object.keys(value) : [];
  return keys
    .filter((key) => !only.includes(key))
    .map((key) => ({
      path: [option, key],
      detail: `${option}.${key} is not offered: ${option} takes ${only.join(', ')}`,
    }));
}

function checkOf(namespace: string, decisions: OptionDecisions): OptionCheck {
  return (option, value) => {
    const decision = decisions[option];
    if (decision === undefined) {
      const offers = offeredIn(decisions).join(', ');
      return [{ path: [option], detail: `${option} is not offered: ${namespace} offers ${offers}` }];
    }
    if (!decision.offered) {
      return [{ path: [option], detail: `${option} is not offered: ${decision.why}` }];
    }
    return decision.only === undefined ? [] : nestedVerdicts(option, decision.only, value);
  };
}

export function offeredOptions(namespace: string): readonly string[] {
  return offeredIn(namespaceDecisions.get(namespace) ?? {});
}

export function decidedOptions(namespace: string): readonly string[] {
  return Object.keys(namespaceDecisions.get(namespace) ?? {});
}

export function optionCheckFor(namespace: string): OptionCheck | undefined {
  const decisions = namespaceDecisions.get(namespace);
  return decisions === undefined ? undefined : checkOf(namespace, decisions);
}
