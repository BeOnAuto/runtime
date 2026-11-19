import { ofEachSubscription, providerListOf, providerOf } from '@on.auto/providers/testing';
import { keptTokensIn } from '@on.auto/tool-servers';
import { consentedAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Option, Redacted, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, reconnected, type Added } from '../testing/additions.ts';
import { consentFake, consentHarnessAt, filesAt } from '../testing/consents.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const declaredOrigin = 'https://api.tracker.example.com';

const later = '2026-10-15T14:05:00.000Z';

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake();
  closing.push(fake.close);
  return fake;
}

function declaringARequest(fake: FakeMcpServer) {
  return providerListOf(providerOf({ ...filesAt(fake).entry, events: { destinations: [ofEachSubscription] } }));
}

function recordedIn({ secrets }: Harness): readonly string[] {
  return [...secrets.values().values()].flatMap((value) =>
    Option.toArray(keptTokensIn(Redacted.make(value))).flatMap(({ resources = [] }) => resources),
  );
}

const pageOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ authorize: Schema.Struct({ url: Schema.String }) }) }),
);

async function signedIn(h: Harness, link: Added, operations = h.operations, at?: string) {
  const started = await h.call(operationNamed(operations, 'start'), ada, { id: link.id, token: link.token }, at);
  const url = new URL(pageOf(started).output.authorize.url);
  const { code, state, iss } = await consentedAt(url.href);
  const finish = operationNamed(operations, 'finish');
  const finished = await h.call(finish, ada, { id: link.id, token: link.token, code, state, iss }, at);
  return { asked: url.searchParams.getAll('resource'), status: finished.status, recorded: recordedIn(h) };
}

describe('the resources a sign-in asks for', () => {
  it("are its server's, then the origin its provider's requests are written out to, which its tokens record", async () => {
    const fake = await served();
    const h = consentHarnessAt(fake, { providers: declaringARequest(fake) });

    expect(await signedIn(h, await added(h, { provider: 'files' }))).toEqual({
      asked: [fake.url, declaredOrigin],
      status: 'succeeded',
      recorded: [declaredOrigin],
    });
  });

  it("are its server's alone for a provider that declares no request, and are asked again by a reconnection once it declares one", async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    const before = await signedIn(h, link);
    const declaring = h.operationsWith({ providers: declaringARequest(fake) });

    const after = await signedIn(h, await reconnected(h, link.id, later), declaring, later);

    expect([before, after]).toEqual([
      { asked: [fake.url], status: 'succeeded', recorded: [] },
      { asked: [fake.url, declaredOrigin], status: 'succeeded', recorded: [declaredOrigin] },
    ]);
  });
});
