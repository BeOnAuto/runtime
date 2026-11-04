import { afterEach, describe, expect, it } from 'vitest';

import {
  brokenWords,
  clockAt,
  connectedByConsent,
  consentClientAt,
  rowOf,
  servedOf,
  servedTokensOf,
  type MemoryTokens,
} from '../testing/index.ts';
import { servedForConsent } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const renewalTime = 3_540_000;

const endingCodes = ['invalid_refresh_token', 'token_revoked'];

interface Refused {
  readonly row: MemoryTokens;
  readonly failed: unknown;
}

function refreshAnsweredUnder200With(code: string) {
  return (...[address, init]: readonly [unknown, unknown?]): Promise<Response> =>
    String(address).endsWith('/token')
      ? Promise.resolve(Response.json({ ok: false, error: code }))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

async function refreshRefusedWith(code: string, ending?: readonly string[]): Promise<Refused> {
  const fake = await servedForConsent();
  closing.push(fake.close);
  const connected = await connectedByConsent(fake);
  const clock = clockAt(0);
  const row = rowOf(connected, clock.now);
  const served = servedOf(connected, row);
  const way = ending === undefined ? served.way : { ...served.way, ending_codes: ending };
  const consent = consentClientAt(fake, { fetch: refreshAnsweredUnder200With(code) });
  const { source } = servedTokensOf({ ...served, way }, clock.now, consent);

  clock.setTo(renewalTime);
  const failed = await source.token().catch((error: unknown) => error);
  return { row, failed };
}

describe('a refresh the server refuses under HTTP 200 with a code of its own', () => {
  it('breaks the connection where the way of its consent names the code as one that ends the consent', async () => {
    const { row, failed } = await refreshRefusedWith('invalid_refresh_token', endingCodes);

    expect(failed).toEqual(new Error(brokenWords('consent_ended')));
    expect(row.ends()).toEqual(['consent_ended']);
  });

  it('fails the call and leaves the connection connected for a code the way does not name, or where it names none', async () => {
    const transient = await refreshRefusedWith('internal_error', endingCodes);
    const unnamed = await refreshRefusedWith('invalid_refresh_token');

    expect([transient.failed, unnamed.failed]).toMatchObject([
      { message: 'internal_error' },
      { message: 'invalid_refresh_token' },
    ]);
    expect([transient.row.ends(), unnamed.row.ends()]).toEqual([[], []]);
  });
});
