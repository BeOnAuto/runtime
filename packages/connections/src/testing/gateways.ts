import type { Outcome } from '@on.auto/operations';
import { messagesThrough, providerListOf, providerOf } from '@on.auto/providers/testing';
import { serveFakeGateway, type FakeGateway, type FakeGatewayOptions } from '@on.auto/tool-servers/served-fakes';
import { onTestFinished } from 'vitest';

import { added, type Added } from './additions.ts';
import { startedAt } from './consents.ts';
import { ada, harness, loopbackPolicy, operationNamed, type Harness, type HarnessOptions } from './harness.ts';

export async function gatewayServed(options: FakeGatewayOptions = {}): Promise<FakeGateway> {
  const gateway = await serveFakeGateway(options);
  onTestFinished(gateway.close);
  return gateway;
}

export function providersThrough(gateway: FakeGateway) {
  return providerListOf(providerOf(messagesThrough({ url: gateway.url, document: gateway.document })));
}

export interface GatewayHarnessOptions extends HarnessOptions {
  readonly gateways?: boolean;
}

export function gatewayHarnessAt(gateway: FakeGateway, { gateways = true, ...options }: GatewayHarnessOptions = {}) {
  return harness({
    providers: providersThrough(gateway),
    policy: loopbackPolicy,
    mostSecretCharacters: 4096,
    ...options,
    consenting: { gateways, gatewayEndPauseMs: 0, ...options.consenting },
  });
}

export interface Returned {
  readonly state: string;
  readonly handle: string;
}

export async function allowedAt(h: Harness, gateway: FakeGateway, link: Added): Promise<Returned> {
  return gateway.allow((await startedAt(h, link)).url);
}

export interface Returning {
  readonly state: string;
  readonly handle?: string;
  readonly code?: string;
}

export function finishingWith(h: Harness, { id, token }: Added, returned: Returning) {
  return h.call(operationNamed(h.operations, 'finish'), ada, { id, token, ...returned });
}

export interface ConnectedThrough {
  readonly link: Added;
  readonly outcome: Outcome;
}

export async function connectedThrough(h: Harness, gateway: FakeGateway, link?: Added): Promise<ConnectedThrough> {
  const linked = link ?? (await added(h, { provider: 'messages' }));
  return { link: linked, outcome: await finishingWith(h, linked, await allowedAt(h, gateway, linked)) };
}

export function removing(h: Harness, id: string): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });
}
