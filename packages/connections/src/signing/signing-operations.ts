import type { ConnectionServices } from '../operations/connection-services.ts';
import { defineRemoveConnectionSigningSecret } from './remove-signing-secret.ts';
import { defineSetConnectionSigningSecret } from './set-signing-secret.ts';

export function signingOperationsOf(services: Pick<ConnectionServices, 'secrets' | 'access'>) {
  return [defineSetConnectionSigningSecret(services), defineRemoveConnectionSigningSecret(services)];
}
