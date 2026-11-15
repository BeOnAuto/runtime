import { Conflict } from '@on.auto/operations';
import { replacementOf, type Provider, type ProviderList } from '@on.auto/providers';

export interface Replaced {
  readonly provider: string;
  readonly replacement: Provider;
}

export function replacedOf(providers: ProviderList, provider: string | null): Replaced | undefined {
  const replacement = replacementOf(providers, provider);
  return provider === null || replacement === undefined ? undefined : { provider, replacement };
}

function replacingName({ replacement }: Replaced): string {
  return replacement.entry.name;
}

export function replacedWayWords(replaced: Replaced): string {
  return `The provider ${replaced.provider} is replaced here by ${replacingName(replaced)}, which a connection is added from instead`;
}

export function replacedConnectionWords(name: string, replaced: Replaced): string {
  return `The connection ${name} was added from the provider ${replaced.provider}, which ${replacingName(replaced)} replaces here, so no playbook may use it until it is reconnected, which adds it again from ${replacingName(replaced)} under the same name`;
}

export function replacedConsent(name: string, replaced: Replaced): Conflict {
  return new Conflict({
    detail: `The connection ${name} was added from the provider ${replaced.provider}, which ${replacingName(replaced)} replaces here, so it is not signed in to again: reconnecting it adds it again from ${replacingName(replaced)} under the same name`,
  });
}
