import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logExtensions } from './extension-logging.ts';

describe('the log of the extensions a server loaded', () => {
  it('names each in its order of precedence, with its version, where it was listed and the points it fills', async () => {
    const [line] = await linesLoggedBy(
      logExtensions([
        {
          package: '@acme/models',
          provenance: 'configured',
          name: '@acme/models',
          version: '2.0.0',
          provides: [{ point: 'prediction/model-runtime', contract: 1 }],
        },
        {
          package: '@on.auto/prediction-series',
          provenance: 'release',
          name: '@on.auto/prediction-series',
          version: '0.36.0',
          provides: [{ point: 'prediction/model-runtime', contract: 1 }],
        },
      ]),
    );

    expect(line).toContain(
      '"message":"Extensions loaded, in their order of precedence: @acme/models 2.0.0, listed in the settings, filling prediction/model-runtime; @on.auto/prediction-series 0.36.0, of the release, filling prediction/model-runtime","level":"INFO"',
    );
    expect(line).toContain(
      '"annotations":{"extensions":[{"package":"@acme/models","version":"2.0.0","provenance":"configured","provides":["prediction/model-runtime@1"]},{"package":"@on.auto/prediction-series","version":"0.36.0","provenance":"release","provides":["prediction/model-runtime@1"]}]}',
    );
  });

  it('says none were loaded when none were', async () => {
    const [line] = await linesLoggedBy(logExtensions([]));

    expect(line).toContain('"message":"Extensions loaded, in their order of precedence: none"');
  });
});
