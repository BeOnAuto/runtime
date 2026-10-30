import type {
  AuthSettings,
  ConnectionServer,
  ConnectionSource,
  ConsentCredential,
  OrgConnection,
} from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import type { ServingServices } from '../serving/serving-services.ts';
import { fixtureServing, type Harness } from './harness.ts';

export function sourceOver(h: Harness, changes: Partial<ServingServices> = {}): ConnectionSource {
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf({}),
    variables: new Map(),
    modelProviders: ['openai'],
    ...fixtureServing,
    ...changes,
  });
}

export async function servedAs(source: ConnectionSource, id: string): Promise<OrgConnection> {
  return Option.getOrThrow(
    Option.fromNullishOr((await Effect.runPromise(source.connectionsOf('acme'))).find((each) => each.id === id)),
  );
}

type Connected = Extract<OrgConnection['state'], { readonly status: 'connected' }>;

function isConnected(state: OrgConnection['state']): state is Connected {
  return state.status === 'connected';
}

export async function preparedOf(source: ConnectionSource, id: string): Promise<ConnectionServer> {
  const { state } = await servedAs(source, id);
  return Effect.runPromise(Option.getOrThrow(Option.liftPredicate(state, isConnected)).server);
}

function isConsent(credential: AuthSettings['credential'] | undefined): credential is ConsentCredential {
  return credential?.kind === 'consent';
}

export async function consentServedAs(source: ConnectionSource, id: string): Promise<ConsentCredential> {
  const { settings } = await preparedOf(source, id);
  return Option.getOrThrow(Option.liftPredicate(settings.auth?.credential, isConsent));
}
