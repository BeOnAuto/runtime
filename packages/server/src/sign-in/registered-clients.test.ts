import { ClientRegistrationError, type RegisteredClient, type RegistrationRefusal } from '@on.auto/openid-connect';
import { Redacted } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClientsReport } from '../logging/sign-in-logging.ts';
import type { SignInClientRegistrations } from './client-registrations.ts';
import { registeredClientsOf } from './registered-clients.ts';
import { refusedAtStart } from './registration-refusals.ts';

const issuer = 'https://login.example.com/tenant/v2.0';

const redirectUri = 'https://auto.example.com/auth/oidc/callback';

afterEach(() => {
  vi.useRealTimers();
});

function clientOf(clientId: string, secretExpiresAt = 0): RegisteredClient {
  return {
    clientId,
    clientSecret: Redacted.make('a-secret'),
    tokenEndpointAuthMethod: 'client_secret_basic',
    secretExpiresAt,
  };
}

interface Kept extends SignInClientRegistrations {
  readonly forget: (clientId: string) => void;
  readonly recordFirst: (client: RegisteredClient) => void;
  readonly reads: () => number;
}

function keptClients(): Kept {
  const order: string[] = [];
  const secrets = new Map<string, RegisteredClient>();
  const elsewhere: RegisteredClient[] = [];
  const counted = { reads: 0 };
  return {
    forget: (clientId) => {
      secrets.delete(clientId);
    },
    recordFirst: (client) => {
      elsewhere.push(client);
    },
    reads: () => counted.reads,
    latestAt: () => Promise.resolve(order.at(-1)),
    named: (_place, clientId) => {
      counted.reads += 1;
      return Promise.resolve(secrets.get(clientId));
    },
    kept: (_place, client) => {
      const inUse = elsewhere.shift() ?? client;
      order.push(inUse.clientId);
      secrets.set(inUse.clientId, inUse);
      return Promise.resolve({ inUse, recordedFirstElsewhere: inUse !== client });
    },
  };
}

interface Registering {
  readonly asked: () => number;
  readonly next: (client: RegisteredClient | RegistrationRefusal) => void;
  readonly registered: () => Promise<RegisteredClient>;
}

function registering(): Registering {
  const answers: (RegisteredClient | RegistrationRefusal)[] = [];
  const counted = { asked: 0 };
  return {
    asked: () => counted.asked,
    next: (answer) => {
      answers.push(answer);
    },
    registered: () => {
      counted.asked += 1;
      const answer = answers.shift() ?? clientOf(`client-${counted.asked}`);
      return 'clientId' in answer
        ? Promise.resolve(answer)
        : Promise.reject(
            new ClientRegistrationError({ issuer, redirectUri, refusal: answer, message: 'Refused by the test' }),
          );
    },
  };
}

interface Reported {
  readonly report: ClientsReport;
  readonly lines: () => readonly (readonly unknown[])[];
}

function reported(): Reported {
  const lines: (readonly unknown[])[] = [];
  return {
    lines: () => [...lines],
    report: {
      registered: (clientId, replacing) => {
        lines.push(['registered', clientId, replacing]);
      },
      registeredElsewhereFirst: (clientId, unused) => {
        lines.push(['elsewhere', clientId, unused]);
      },
      notRegistered: () => {
        lines.push(['not registered']);
      },
    },
  };
}

function clientsOver(kept: Kept, provider: Registering, { report }: Reported) {
  return registeredClientsOf({ issuer, redirectUri, registered: provider.registered }, kept, report);
}

describe('the client a sign-in begins as, where the server registers its own', () => {
  it('is registered at the first sign-in, kept, and used again, after a restart too, with no second registration', async () => {
    const [kept, provider, lines] = [keptClients(), registering(), reported()];
    const first = await clientsOver(kept, provider, lines).inUse();
    const again = await clientsOver(kept, provider, lines).inUse();
    const restarted = clientsOver(kept, provider, lines);

    expect([first.clientId, again.clientId, (await restarted.inUse()).clientId]).toEqual([
      'client-1',
      'client-1',
      'client-1',
    ]);
    expect([provider.asked(), lines.lines()]).toEqual([1, [['registered', 'client-1', undefined]]]);
  });

  it('is registered anew in place of the one kept, where that one is no longer in the store or its secret has ended', async () => {
    const [kept, provider, lines] = [keptClients(), registering(), reported()];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-18T09:00:00Z'));
    await clientsOver(kept, provider, lines).inUse();
    kept.forget('client-1');
    provider.next(clientOf('client-2', Date.parse('2026-11-18T10:00:00Z') / 1000));
    await clientsOver(kept, provider, lines).inUse();
    vi.setSystemTime(Date.parse('2026-11-18T10:00:00Z'));

    const ended = await clientsOver(kept, provider, lines).inUse();

    expect(ended.clientId).toBe('client-3');
    expect(lines.lines().slice(1)).toEqual([
      ['registered', 'client-2', 'client-1'],
      ['registered', 'client-3', 'client-2'],
    ]);
  });
});

describe('the client a sign-in begins as, where another server registered one at the same moment', () => {
  it('is the one the other server registered, which this one uses', async () => {
    const [kept, provider, lines] = [keptClients(), registering(), reported()];
    kept.recordFirst(clientOf('client-of-another-server'));

    const inUse = await clientsOver(kept, provider, lines).inUse();

    expect(inUse.clientId).toBe('client-of-another-server');
    expect(lines.lines()).toEqual([['elsewhere', 'client-of-another-server', 'client-1']]);
  });
});

describe('the client a sign-in finishes as, where the server registers its own', () => {
  it('is read once from the store for each client it names', async () => {
    const kept = keptClients();
    const clients = clientsOver(kept, registering(), reported());
    await clients.inUse();
    const readsOnceRegistered = kept.reads();

    const named = [await clients.named('client-1'), await clients.named('client-1'), await clients.named('unknown')];

    expect(named.map((client) => client?.clientId)).toEqual(['client-1', 'client-1', undefined]);
    expect([readsOnceRegistered, kept.reads()]).toEqual([0, 1]);
  });
});

describe('the client the identity provider refused', () => {
  it('is registered anew once, however many sign-ins it refused at once, and not where another is in use already', async () => {
    const [kept, provider, lines] = [keptClients(), registering(), reported()];
    const clients = clientsOver(kept, provider, lines);
    const refusedOne = await clients.inUse();

    await Promise.all([clients.refused(refusedOne), clients.refused(refusedOne)]);
    await clients.refused(refusedOne);

    expect([(await clients.inUse()).clientId, provider.asked()]).toEqual(['client-2', 2]);
    expect(lines.lines()).toEqual([
      ['registered', 'client-1', undefined],
      ['registered', 'client-2', 'client-1'],
    ]);
  });

  it('is told in a line where the provider refuses to register anew, and the sign-in goes on to its refusal', async () => {
    const [kept, provider, lines] = [keptClients(), registering(), reported()];
    const clients = clientsOver(kept, provider, lines);
    const refusedOne = await clients.inUse();
    provider.next({ refused: 'invalid_client_metadata' });

    await clients.refused(refusedOne);

    expect(lines.lines().at(-1)).toEqual(['not registered']);
  });
});

function settingNamedBy(refusal: RegistrationRefusal): string | undefined {
  const failure = new ClientRegistrationError({ issuer, redirectUri, refusal, message: 'Refused by the test' });
  return /^([A-Z_]+):/u.exec(String(Reflect.get(new Object(refusedAtStart(failure)), 'message')))?.[1];
}

describe('a start the registration of its client refuses', () => {
  it('names the setting to change, and leaves any other failure as it is', async () => {
    const other = new Error('Another failure');

    const refusals: readonly RegistrationRefusal[] = [
      { notOffered: ['https://login.example.com/.well-known/openid-configuration'] },
      { refused: 'invalid_client_metadata' },
      { unreached: 'cannot be reached' },
      { unusable: 'it answered no client_secret' },
      { withoutScopes: ['profile'] },
    ];

    expect(refusals.map((refusal) => settingNamedBy(refusal))).toEqual([
      'OIDC_CLIENT_ID',
      'OIDC_ISSUER',
      'OIDC_ISSUER',
      'OIDC_ISSUER',
      'OIDC_SCOPES',
    ]);
    expect(refusedAtStart(other)).toBe(other);
    await expect(clientsOver(keptClients(), failingFirst(), reported()).inUse()).rejects.toBeInstanceOf(
      ClientRegistrationError,
    );
  });
});

function failingFirst(): Registering {
  const provider = registering();
  provider.next({ refused: 'invalid_client_metadata' });
  return provider;
}
