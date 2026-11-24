import { wayAddresses, type WayAddress } from '@on.auto/providers';
import { isPinnableUrl, pinnedUrlShape } from '@on.auto/tool-servers';

interface Addressed extends Partial<Readonly<Record<WayAddress, string>>> {
  readonly kind: string;
}

interface FieldIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

const addressesOfEachKind: Readonly<Record<string, readonly WayAddress[]>> = {
  client_credentials: ['issuer'],
  authorization: wayAddresses,
  jwt_bearer: ['issuer'],
  token_exchange: ['token_endpoint'],
};

export function addressIssuesOf(credential: Addressed): readonly FieldIssue[] {
  return (addressesOfEachKind[credential.kind] ?? []).flatMap((field) => {
    const address = credential[field];
    return address === undefined || isPinnableUrl(address) ? [] : [{ path: [field], issue: pinnedUrlShape }];
  });
}
