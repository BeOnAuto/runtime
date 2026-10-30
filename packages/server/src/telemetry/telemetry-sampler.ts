import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
} from '@opentelemetry/sdk-trace-node';

import type { SamplerName, SamplerSettings } from './telemetry-settings.ts';

const samplers: Readonly<Record<SamplerName, (ratio: number) => Sampler>> = {
  always_on: () => new AlwaysOnSampler(),
  always_off: () => new AlwaysOffSampler(),
  traceidratio: (ratio) => new TraceIdRatioBasedSampler(ratio),
  parentbased_always_on: () => new ParentBasedSampler({ root: new AlwaysOnSampler() }),
  parentbased_always_off: () => new ParentBasedSampler({ root: new AlwaysOffSampler() }),
  parentbased_traceidratio: (ratio) => new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
};

export function samplerOf({ name, ratio }: SamplerSettings): Sampler {
  return samplers[name](ratio);
}
