import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logServedStudio, logStudioKeptInMemory } from './logging.ts';

const served = { origin: 'https://studio.on.auto', served: true };

describe('logServedStudio', () => {
  it('warns where SERVE_STUDIO is on outside local mode, since the Studio served there signs no one in and sends no key', async () => {
    const [line] = await linesLoggedBy(logServedStudio({ mode: 'credentials', studio: served }));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain(
      '"message":"SERVE_STUDIO is on outside local mode, where the Studio this runtime serves at /studio/ cannot work yet: its policy loads no script of the identity service, so it signs no one in, and it sends no key"',
    );
  });

  it('says nothing in local mode, nor where no Studio is served', async () => {
    expect([
      await linesLoggedBy(logServedStudio({ mode: 'local', studio: served })),
      await linesLoggedBy(logServedStudio({ mode: 'closed', studio: { ...served, served: false } })),
    ]).toEqual([[], []]);
  });
});

describe('logStudioKeptInMemory', () => {
  it('warns that the Studio served is kept in memory alone, saying why', async () => {
    const [line] = await linesLoggedBy(logStudioKeptInMemory('the folder /data/auto-runtime-studio could not be made'));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain(
      '"message":"The Studio this runtime serves is kept in memory alone, since the folder /data/auto-runtime-studio could not be made"',
    );
  });
});
