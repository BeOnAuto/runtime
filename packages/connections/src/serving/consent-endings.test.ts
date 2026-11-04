import { providerListOf } from '@on.auto/providers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, filesAt, filesWay, finishing } from '../testing/consents.ts';
import { loopbackPolicy } from '../testing/harness.ts';
import { consentServedAs, sourceOver } from '../testing/served-connections.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

describe('the ending codes of the way of consent of a provider', () => {
  it('are those its way names when a connection connected by consent is served, and none where it names none', async () => {
    const fake = await consentFake();
    closing.push(fake.close);
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    await finishing(h, link, await consentedOf(h, link));
    const ending = filesAt(fake, { ...filesWay, ending_codes: ['invalid_refresh_token', 'token_revoked'] });

    const served = await Promise.all(
      [ending, filesAt(fake)].map((files) =>
        consentServedAs(sourceOver(h, { policy: loopbackPolicy, providers: providerListOf(files) }), link.id),
      ),
    );

    expect(served.map(({ way }) => way.ending_codes)).toEqual([['invalid_refresh_token', 'token_revoked'], undefined]);
  });
});
