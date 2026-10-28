import type { ModelRuntime } from '@on.auto/prediction-contract';

const scriptedFormat = 'scripted';

export const scriptedRuntime: ModelRuntime = {
  name: 'scripted-runtime',
  version: '1.0.0',
  formats: [scriptedFormat],
  capabilities: { features: true, given: true, totals: true },
  binding: { kind: 'process', module: () => new URL('./scripted-recipes.ts', import.meta.url) },
};
