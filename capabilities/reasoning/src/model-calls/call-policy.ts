import type { ModelRequest } from '../model/model-request.ts';
import type { ModelTelemetry, ReportOperatorHint, ReportProviderMessage } from '../providers/model-access-options.ts';
import type { ProviderOptionsCheck } from '../settings/gateway-options.ts';

export interface CallPolicy {
  readonly configured: readonly string[];
  readonly showsProviderMessages: (provider: string) => boolean;
  readonly scrub: (text: string) => string;
  readonly report: ReportProviderMessage;
  readonly reportHint: ReportOperatorHint;
  readonly admitsOptions: ProviderOptionsCheck;
  readonly telemetry?: ModelTelemetry | undefined;
}

const leastQuotedCharacters = 8;

function promptTextsOf({ instructions, messages }: ModelRequest): readonly string[] {
  const texts = [instructions ?? '', ...messages.flatMap(({ content }) => content.map(({ text }) => text))];
  return texts.map((text) => text.trim()).filter((text) => text.length >= leastQuotedCharacters);
}

export function scrubberFor(policy: CallPolicy, request: ModelRequest): (text: string) => string {
  const prompts = promptTextsOf(request);
  return (text) => policy.scrub(prompts.reduce((scrubbed, prompt) => scrubbed.replaceAll(prompt, '[prompt]'), text));
}
