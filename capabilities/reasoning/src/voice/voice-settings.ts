import { Option } from 'effect';

import { isModelId, parseModelReference } from '../model/model-reference.ts';
import type { GatewaySettings } from '../settings/gateway-settings.ts';
import type { OpenAiSettings } from '../settings/provider-settings.ts';
import { problem, type Availability, type SettingProblem } from '../settings/setting-values.ts';

export const voiceModelVariable = 'VOICE_MODEL';

export interface VoiceModel {
  readonly reference: string;
  readonly provider: string;
  readonly model: string;
}

interface VoiceReading {
  readonly problems: readonly SettingProblem[];
  readonly voice: VoiceModel | null;
}

interface VoiceProviders {
  readonly gateways: readonly GatewaySettings[];
  readonly openai: Availability<OpenAiSettings>;
}

const expected = 'Expected openai/<model> or <gateway>/<model> for a gateway of model_gateways';

function servesVoice(provider: string, { gateways, openai }: VoiceProviders): boolean {
  return provider === 'openai' ? openai.configured : gateways.some(({ name }) => name === provider);
}

function refused(): VoiceReading {
  return { problems: problem(voiceModelVariable, expected), voice: null };
}

export function voiceReading(text: string | undefined, providers: VoiceProviders): VoiceReading {
  if (text === undefined) {
    return { problems: [], voice: null };
  }
  return Option.match(parseModelReference(text), {
    onNone: refused,
    onSome: ({ provider, model }) =>
      isModelId(text) && servesVoice(provider, providers)
        ? { problems: [], voice: { reference: text, provider, model } }
        : refused(),
  });
}
