import { reachesUnder, type ConnectionServices, type EventsReceived, type RuntimeAccess } from '@on.auto/connections';
import { accessModeOf } from '@on.auto/identity';
import type { OpensASocket } from '@on.auto/providers';

import type { Settings } from '../settings/settings.ts';
import { socketsOpenedOver } from '../sockets/socket-openings.ts';

type PolicySettings = Pick<Settings, 'connections' | 'signIn' | 'apiKeys' | 'host' | 'accessMode' | 'toolCalls'>;

export function accessOf({ host, signIn, apiKeys, accessMode }: PolicySettings): RuntimeAccess {
  if (accessModeOf({ host, apiKeys, signsIn: signIn !== undefined, accessMode }) === 'local') {
    return 'local';
  }
  return signIn === undefined ? 'keys' : 'people';
}

export function policyServedAt(settings: PolicySettings): ConnectionServices['policy'] {
  return { ...settings.connections, loopbackAllowed: accessOf(settings) === 'local' };
}

export function socketsOpenedAt(settings: PolicySettings): OpensASocket {
  return socketsOpenedOver({
    reaches: reachesUnder(policyServedAt(settings)),
    mostRequestBytes: settings.toolCalls.mostRequestBytes,
  });
}

export function eventsReceivedAt({ overHttp, webhookUrl }: Settings['receiving']): EventsReceived {
  return { perSubscription: overHttp && webhookUrl !== undefined, perApp: false, socket: true };
}
