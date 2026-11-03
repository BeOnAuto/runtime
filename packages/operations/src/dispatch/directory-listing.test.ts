import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineQuery, DirectoryListing } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toOrg, toPlaybook } from '../testing/harness.ts';

const answering = {
  title: 'Listing',
  description: 'Answers whether it serves the directory listing. Use it to see the listing. It changes nothing.',
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ directory: Schema.Boolean }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    return { directory: yield* DirectoryListing };
  }),
};

const inTheOrg = defineQuery('org', { ...answering, name: 'org_listing', route: { method: 'GET', path: '/listing' } });

const inAPlaybook = defineQuery('playbook', {
  ...answering,
  name: 'playbook_listing',
  route: { method: 'GET', path: '/listing' },
});

describe('the directory listing of a call', () => {
  it('reaches an operation of the org or of a playbook when the request names it, and is false otherwise', async () => {
    const { dispatcher, run } = harness();
    const listed: { readonly directoryListing: true } = { directoryListing: true };

    const answers = await Promise.all([
      run(dispatcher.dispatchToOrg(inTheOrg.registration, { ...toOrg('acme')(acmeAdmin), ...listed })),
      run(dispatcher.dispatchToOrg(inTheOrg.registration, toOrg('acme')(acmeAdmin))),
      run(
        dispatcher.dispatchToPlaybook(inAPlaybook.registration, {
          ...toPlaybook('acme', 'alpha')(acmeAdmin),
          ...listed,
        }),
      ),
      run(dispatcher.dispatchToPlaybook(inAPlaybook.registration, toPlaybook('acme', 'alpha')(acmeAdmin))),
    ]);

    expect(answers).toMatchObject([
      { status: 'succeeded', output: { directory: true } },
      { status: 'succeeded', output: { directory: false } },
      { status: 'succeeded', output: { directory: true } },
      { status: 'succeeded', output: { directory: false } },
    ]);
  });
});

describe('the directory listing outside a call', () => {
  it('is false where no request names it', () => {
    expect(
      Effect.runSync(
        Effect.gen(function* () {
          return yield* DirectoryListing;
        }),
      ),
    ).toBe(false);
  });
});
