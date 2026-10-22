import { servedStudio } from '@on.auto/identity/testing';
import { describe, expect, it } from 'vitest';

import { added, notes } from '../testing/additions.ts';
import { harness } from '../testing/harness.ts';

describe("the link to Studio's page that adding a connection answers", () => {
  it("is the page connect of the Studio the runtime serves, under the runtime's own origin, naming the connection and its token alone, since that page knows its server and asks it for the org", async () => {
    const runtime = 'http://127.0.0.1:5555';
    const { id, url, token } = await added(harness({ pages: { studio: servedStudio, runtime: () => runtime } }), notes);

    const page = new URL(url);
    expect([page.origin, page.pathname, Object.fromEntries(page.searchParams)]).toEqual([
      runtime,
      '/studio/connect',
      { connection: id, token },
    ]);
  });

  it('is the page connect at the root of the Studio host the runtime names, naming the runtime and the org too, where it serves no Studio', async () => {
    const studio = { origin: 'https://studio.example.com', served: false };
    const runtime = 'https://runtime.example.com';
    const { id, url, token } = await added(harness({ pages: { studio, runtime: () => runtime } }), notes);

    const page = new URL(url);
    expect([page.origin, page.pathname, [...page.searchParams]]).toEqual([
      'https://studio.example.com',
      '/connect',
      [
        ['server', runtime],
        ['org', 'acme'],
        ['connection', id],
        ['token', token],
      ],
    ]);
  });
});
