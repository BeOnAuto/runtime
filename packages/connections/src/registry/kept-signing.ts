import type { SigningSecretRemoved, SigningSecretSet } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';

export interface KeptSigning {
  readonly current: { readonly secretId: string; readonly setAt: string };
  readonly previous: { readonly secretId: string; readonly until: string } | undefined;
}

export function signingShown(signing: KeptSigning | undefined): RecordedConnection['signing_secret'] {
  return signing === undefined
    ? null
    : { set_at: signing.current.setAt, previous_until: signing.previous?.until ?? null };
}

export function signingSet(signing: KeptSigning | undefined, { data, context }: SigningSecretSet): KeptSigning {
  const before = signing?.current;
  const previous =
    before === undefined || data.previous_until === undefined
      ? undefined
      : { secretId: before.secretId, until: data.previous_until };
  return { current: { secretId: data.secret_id, setAt: context.at }, previous };
}

export function signingRemoved(
  signing: KeptSigning | undefined,
  { data }: SigningSecretRemoved,
): KeptSigning | undefined {
  return data.which === 'all' || signing === undefined ? undefined : { ...signing, previous: undefined };
}

export function signingSecretsHeldBy(signing: KeptSigning | undefined): readonly string[] {
  return [signing?.current.secretId, signing?.previous?.secretId].filter((secretId) => secretId !== undefined);
}

export function signingSecretsVerifyingAt(signing: KeptSigning | undefined, at: string): readonly string[] {
  if (signing === undefined) {
    return [];
  }
  const { current, previous } = signing;
  return previous === undefined || previous.until <= at ? [current.secretId] : [current.secretId, previous.secretId];
}

export function signingSecretsReleasedOf(
  before: KeptSigning | undefined,
  after: KeptSigning | undefined,
): readonly string[] {
  const held = new Set(signingSecretsHeldBy(after));
  return signingSecretsHeldBy(before).filter((secretId) => !held.has(secretId));
}
