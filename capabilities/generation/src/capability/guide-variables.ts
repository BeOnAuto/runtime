import type { GuideVariables } from '@on.auto/definitions';
import { changedOnlyByWhoeverRunsTheServer, sizeInWords } from '@on.auto/phrasing';

import { generationBounds, type GenerationBounds } from './generation-ports.ts';

interface Offered {
  readonly bounds: GenerationBounds;
  readonly gateway: string;
}

type Words = (offered: Offered) => string;

const day = 86_400_000;

const counted = new Intl.NumberFormat('en');

const gatewayOfThePages = 'gateway';

const gatewayToFillIn = '<gateway>';

const modelsOfTheExamples = {
  image: 'openai/gpt-image-2',
  audio: 'vertex_ai/gemini-3.8-flash-tts',
  video: 'vertex_ai/veo-3.1-fast-generate-001',
};

function daysIn(milliseconds: number): string {
  const days = milliseconds / day;
  return `${counted.format(days)} ${days === 1 ? 'day' : 'days'}`;
}

const wordsOfEachValue: Readonly<Record<string, Words>> = {
  'generation.most_image': ({ bounds }) => sizeInWords(bounds.mostBytes.image),
  'generation.most_audio': ({ bounds }) => sizeInWords(bounds.mostBytes.audio),
  'generation.most_video': ({ bounds }) => sizeInWords(bounds.mostBytes.video),
  'generation.most_kept': ({ bounds }) => sizeInWords(bounds.mostPlaybookBytes),
  'generation.kept': ({ bounds }) => daysIn(bounds.keptMs),
  'generation.bounds_changed_by': () => changedOnlyByWhoeverRunsTheServer,
  'generation.example_image_model': ({ gateway }) => `${gateway}/${modelsOfTheExamples.image}`,
  'generation.example_audio_model': ({ gateway }) => `${gateway}/${modelsOfTheExamples.audio}`,
  'generation.example_video_model': ({ gateway }) => `${gateway}/${modelsOfTheExamples.video}`,
};

const asThePagesHaveIt: Offered = { bounds: generationBounds, gateway: gatewayOfThePages };

export function guideVariablesOf(bounds: GenerationBounds, gateways: readonly string[]): GuideVariables {
  const offered: Offered = { bounds, gateway: gateways[0] ?? gatewayToFillIn };
  return Object.fromEntries(
    Object.entries(wordsOfEachValue).map(([name, words]: readonly [string, Words]) => [
      name,
      { value: words(offered), default: words(asThePagesHaveIt) },
    ]),
  );
}
