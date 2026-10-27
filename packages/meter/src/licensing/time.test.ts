import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { licenseProtocol } from '../index.ts';
import { licenseFixture } from '../testing/license-fixture.ts';

const requestBody = Schema.decodeUnknownSync(Schema.Struct({ requestId: Schema.String }));

async function fixture() {
  const f = await licenseFixture();
  const state: { monotonic: number; elapsed: number; serverTime: number; replay: string | undefined } = {
    monotonic: 3.2,
    elapsed: 10,
    serverTime: 5000,
    replay: undefined,
  };
  const tokens: string[] = [];
  const requests: Readonly<Request>[] = [];
  const protocol = licenseProtocol({
    trust: f.trust,
    installation: f.installation,
    monotonicTime: () => state.monotonic,
    fetch: async (request) => {
      requests.push(request);
      const { requestId } = requestBody(await request.json());
      const timeToken = state.replay ?? (await f.timeToken(requestId, state.serverTime));
      tokens.push(timeToken);
      state.monotonic += state.elapsed;
      return Response.json({ timeToken });
    },
  });
  return { ...f, protocol, state, tokens, requests };
}

describe('fresh signed license time', () => {
  it('uses a new unpredictable request identity and includes round-trip time conservatively', async () => {
    const f = await fixture();
    const first = await f.protocol.freshTime();
    const second = await f.protocol.freshTime();
    expect(first.serverTime).toBe(5011);
    expect(second.serverTime).toBe(5011);
    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^time_[a-f0-9-]{36}$/u);
    expect(f.requests.map((request) => new URL(request.url).pathname)).toEqual(['/licenses/time', '/licenses/time']);
  });

  it('refuses a replayed signed response from an earlier exchange', async () => {
    const f = await fixture();
    await f.protocol.freshTime();
    const [token] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String]))(f.tokens);
    f.state.replay = token;
    await expect(f.protocol.freshTime()).rejects.toThrow('another authority');
  });

  it('does not accept an unsigned time value or a changed signature', async () => {
    const f = await fixture();
    f.state.replay = 'not-a-signed-time';
    await expect(f.protocol.freshTime()).rejects.toThrow('JWS');
  });
});

describe('time-response delay bounds', () => {
  it('refuses an unsigned server-time field in place of the signed envelope', async () => {
    const f = await licenseFixture();
    f.respond({ serverTime: 5000 });
    await expect(f.protocol.freshTime()).rejects.toThrow('timeToken');
  });

  it.each([-10, NaN, Infinity])('refuses an invalid monotonic response interval %s', async (elapsed) => {
    const f = await fixture();
    f.state.elapsed = elapsed;
    await expect(f.protocol.freshTime()).rejects.toThrow('license_clock_invalid');
  });

  it('refuses an excessively delayed response even if transport returns it', async () => {
    const f = await fixture();
    f.state.elapsed = 30_001;
    await expect(f.protocol.freshTime()).rejects.toThrow('license_time_delayed');
  });

  it('refuses time arithmetic beyond the supported date range', async () => {
    const f = await fixture();
    f.state.serverTime = 8_640_000_000_000_000;
    await expect(f.protocol.freshTime()).rejects.toThrow('license_clock_invalid');
  });
});
