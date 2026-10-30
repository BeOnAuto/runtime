import { describe, expect, it } from 'vitest';

import { samplerOf } from './telemetry-sampler.ts';
import type { SamplerName } from './telemetry-settings.ts';

const samplers: ReadonlyArray<readonly [SamplerName, string]> = [
  ['always_on', 'AlwaysOnSampler'],
  ['always_off', 'AlwaysOffSampler'],
  ['traceidratio', 'TraceIdRatioBased{0.25}'],
  ['parentbased_always_on', 'ParentBased{root=AlwaysOnSampler'],
  ['parentbased_always_off', 'ParentBased{root=AlwaysOffSampler'],
  ['parentbased_traceidratio', 'ParentBased{root=TraceIdRatioBased{0.25}'],
];

describe('the sampler of a trace', () => {
  it.each(samplers)('is %s as OTEL_TRACES_SAMPLER names it', (name, described) => {
    expect(samplerOf({ name, ratio: 0.25 }).toString()).toContain(described);
  });
});
