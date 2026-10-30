import { required } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { readProviders, providersShippedRoots, type ProviderEntry } from '@on.auto/providers';
import { Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { reconnectedFor } from '../testing/additions.ts';
import { startedAt } from '../testing/consents.ts';
import { vendorsOfTheShippedWays } from '../testing/shipped-vendors.ts';
import { consentedAtTheVendor, examplesOf, harnessAtTheVendor, servedAsTheVendor } from '../testing/vendor-fakes.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Growing {
  readonly entry: ProviderEntry;
  readonly issuer: string;
  readonly more: string;
}

const growing: readonly Growing[] = shipped.providers.flatMap(({ entry }) =>
  entry.credentials.flatMap(({ issuer = '', more = [] }) => more.map(({ name }) => ({ entry, issuer, more: name }))),
);

const connectedIdOf = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ id: Schema.String }) }));

async function moreAskedOf({ entry, issuer, more }: Growing) {
  const vendor = required(vendorsOfTheShippedWays[entry.name]);
  const fake = await servedAsTheVendor(vendor);
  closing.push(fake.close);
  const h = harnessAtTheVendor(fake, vendor, { providers: shipped, registeredIssuer: issuer });
  const placeholders = examplesOf(entry);
  const { finished } = await consentedAtTheVendor(h, { provider: entry.name, placeholders }, { fake, vendor });
  const link = await reconnectedFor(h, connectedIdOf(finished).output.id, more);
  const { searchParams } = new URL((await startedAt(h, link)).url);
  return [entry.name, more, searchParams.get('scope'), searchParams.get('access_type'), searchParams.get('prompt')];
}

const atGoogle = 'https://www.googleapis.com/auth/';

describe('every group of more of a shipped way of consent, against the fake authorization server at its vendor’s addresses', () => {
  it('asks the scopes the connection was granted with the group’s, with the parameters of the way alone', async () => {
    const asked = await Promise.all(growing.map((each) => moreAskedOf(each)));

    expect(asked).toEqual([
      [
        'google-drive',
        'edit',
        `${atGoogle}drive.readonly ${atGoogle}drive.file ${atGoogle}drive`,
        'offline',
        'consent',
      ],
    ]);
  });
});
