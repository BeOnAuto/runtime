import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logExtensions } from './extension-logging.ts';

describe('the log of the extensions a server loaded', () => {
  it('names each in its order of precedence, with its version, where it was listed and the points it fills', async () => {
    const [line] = await linesLoggedBy(
      logExtensions([
        {
          package: '@acme/extension',
          provenance: 'configured',
          name: '@acme/extension',
          version: '2.0.0',
          provides: [{ point: 'example/greeter', contract: 1 }],
        },
        {
          package: '@on.auto/greeters',
          provenance: 'release',
          name: '@on.auto/greeters',
          version: '0.36.0',
          provides: [{ point: 'example/greeter', contract: 1 }],
        },
      ]),
    );

    expect(line).toContain(
      '"message":"Extensions loaded, in their order of precedence: @acme/extension 2.0.0, listed in the settings, filling example/greeter; @on.auto/greeters 0.36.0, of the release, filling example/greeter","level":"INFO"',
    );
    expect(line).toContain(
      '"annotations":{"extensions":[{"package":"@acme/extension","version":"2.0.0","provenance":"configured","provides":["example/greeter@1"]},{"package":"@on.auto/greeters","version":"0.36.0","provenance":"release","provides":["example/greeter@1"]}]}',
    );
  });

  it('says an extension that provides no point fills none', async () => {
    const [line] = await linesLoggedBy(
      logExtensions([
        { package: '@acme/plain', provenance: 'configured', name: '@acme/plain', version: '1.0.0', provides: [] },
      ]),
    );

    expect(line).toContain(
      '"message":"Extensions loaded, in their order of precedence: @acme/plain 1.0.0, listed in the settings, filling no point"',
    );
  });

  it('says none were loaded when none were', async () => {
    const [line] = await linesLoggedBy(logExtensions([]));

    expect(line).toContain('"message":"Extensions loaded, in their order of precedence: none"');
  });
});
