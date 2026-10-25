import type { OptionalPackages } from '../settings/provider-status.ts';
import { entraIdentityLoader, isMissingModule, type EntraIdentityLoader } from './entra-id.ts';

export const loadEntraIdentity: EntraIdentityLoader = entraIdentityLoader(() => import('@azure/identity'));

export type Resolve = (specifier: string) => string;

function resolvedInPlace(specifier: string): string {
  return import.meta.resolve(specifier);
}

export function installedPackages(resolve: Resolve = resolvedInPlace): OptionalPackages {
  try {
    resolve('@azure/identity');
    return { entraId: true };
  } catch (error) {
    if (isMissingModule(error)) {
      return { entraId: false };
    }
    throw error;
  }
}
