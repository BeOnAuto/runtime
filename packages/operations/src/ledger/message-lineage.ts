import { uuidV5 } from '../uuid/uuid-v5.ts';

const ledgerMessages = '5f8d7a5a-8d50-4340-9de3-ba16e8fe732e';

export interface Lineage {
  readonly causationId: string | null;
  readonly correlationId: string | null;
}

export const noLineage: Lineage = { causationId: null, correlationId: null };

export const lineageAttributeNames: readonly string[] = ['causationid', 'correlationid'];

export function messageIdOf(stream: string, position: number): string {
  return uuidV5(ledgerMessages, JSON.stringify([stream, position]));
}
