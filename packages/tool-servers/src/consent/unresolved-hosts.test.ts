import { HostUnresolved, type Reaches } from '@on.auto/outbound';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { consentClientWith } from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(endpointHost?: string): Promise<FakeMcpServer> {
  const fake = await servedForConsent({
    dynamicRegistration: true,
    ...(endpointHost === undefined ? {} : { endpointHost }),
  });
  closing.push(fake.close);
  return fake;
}

const allowed: string | undefined = undefined;

function unresolvedAt(hostname: string): Reaches {
  return (url) =>
    new URL(url).hostname === hostname
      ? Promise.reject(new HostUnresolved({ host: hostname }))
      : Promise.resolve(allowed);
}

function refusedAt({ url }: Pick<FakeMcpServer, 'url'>, reaches: Reaches) {
  return Effect.runPromise(Effect.flip(consentClientWith().namedWay({ url, reaches })));
}

describe('the naming of a way whose hosts cannot be looked up', () => {
  it('is unanswered at the issuer, to try again and not refused, where an endpoint of its authorization server cannot', async () => {
    const elsewhere = await served('localhost');

    expect(await refusedAt(elsewhere, unresolvedAt('localhost'))).toEqual({
      refused: 'at_the_issuer',
      issuer: elsewhere.origin,
      refusal: { refused: 'unanswered' },
    });
  });

  it('is unanswered where the host of the server itself cannot', async () => {
    const fake = await served();

    expect(await refusedAt(fake, unresolvedAt('127.0.0.1'))).toEqual({ refused: 'unanswered' });
  });
});
