import { readFileSync } from 'node:fs';

import {
  acceptedModelRuntimeContracts,
  ExtensionManifestSchema,
  ModelRuntimeSchema,
} from '@on.auto/prediction-contract';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { manifest } from '../index.ts';
import { seriesRuntime } from './series-runtime.ts';

const VersionSchema = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

const ofTheModels: unknown = expect.stringMatching(/\/prediction-series\/src\/recipes\/series-models\.ts$/u);

const release = Schema.decodeUnknownSync(VersionSchema)(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
).version;

describe('the extension of the release that executes the runtime’s own models', () => {
  it('names its package and the release, and fills prediction/model-runtime with the contract it was built against', () => {
    const decoded = Schema.decodeUnknownSync(ExtensionManifestSchema)(manifest);
    const [provided] = decoded.provides;

    expect([decoded.name, decoded.version, provided?.point, provided?.contract]).toEqual([
      '@on.auto/prediction-series',
      release,
      'prediction/model-runtime',
      acceptedModelRuntimeContracts.most,
    ]);
    expect(Schema.decodeUnknownSync(ModelRuntimeSchema)(provided?.implementation)).toEqual(seriesRuntime);
  });

  it('executes the format series in the server’s own process, takes every input, reads the calendar and fits its own models', () => {
    const binding = { ...seriesRuntime.binding, module: seriesRuntime.binding.module().pathname };

    expect({ ...seriesRuntime, binding }).toEqual({
      name: 'series',
      version: release,
      formats: ['series'],
      capabilities: { features: true, given: true, totals: true, calendar: true, fits: true },
      binding: { kind: 'inline', module: ofTheModels },
    });
  });
});
