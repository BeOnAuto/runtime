import { credentialProblems, credentialShapesIn } from '@on.auto/config';
import { Schema, Struct } from 'effect';

import type { ServerEntryFields } from './server-entries.ts';

const asJson = Schema.decodeUnknownSync(Schema.Json);

export function credentialPlacesIn(name: string, written: ServerEntryFields, pointer: string): readonly string[] {
  const { auth } = written;
  const request = auth?.token_request;
  if (auth === undefined || request === undefined) {
    return credentialProblems(name, written, pointer).map(({ pointer: place }) => place);
  }
  return [
    ...credentialProblems(name, { ...written, auth: Struct.omit(auth, ['token_request']) }, pointer),
    ...credentialShapesIn(asJson(request), `${pointer}/auth/token_request`, []),
  ].map(({ pointer: place }) => place);
}
