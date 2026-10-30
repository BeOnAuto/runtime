import { Option, Result, Schema } from 'effect';

import { jsonAt, type IssuerRequests } from './issuer-requests.ts';

export interface IssuerMetadata {
  readonly jwksUri: string;
}

const mostMetadataBytes = 65_536;

const MetadataSchema = Schema.Struct({
  issuer: Schema.String,
  jwks_uri: Schema.String,
});

const decodeMetadata = Schema.decodeUnknownOption(MetadataSchema);

export function metadataAddressesOf(issuer: string): readonly string[] {
  const { origin } = new URL(issuer);
  return [`${origin}/.well-known/oauth-authorization-server`, `${origin}/.well-known/openid-configuration`];
}

function metadataIn(json: unknown, issuer: string): Result.Result<IssuerMetadata, string> {
  const decoded = decodeMetadata(json);
  if (Option.isNone(decoded)) {
    return Result.fail('answers no metadata with an issuer and a jwks_uri');
  }
  const { issuer: named, jwks_uri: jwksUri } = decoded.value;
  if (named !== issuer) {
    return Result.fail(`names the issuer ${named}`);
  }
  return URL.parse(jwksUri)?.protocol === 'https:'
    ? Result.succeed({ jwksUri })
    : Result.fail('names a jwks_uri that is not an https URL');
}

async function firstMetadataAt(
  addresses: readonly string[],
  issuer: string,
  requests: IssuerRequests,
  refusals: readonly string[],
): Promise<Result.Result<IssuerMetadata, string>> {
  const [address, ...rest] = addresses;
  if (address === undefined) {
    return Result.fail(`no metadata of ${issuer} could be used: ${refusals.join('; ')}`);
  }
  const read = Result.flatMap(await jsonAt(requests, address, mostMetadataBytes), (json) => metadataIn(json, issuer));
  return Result.isSuccess(read)
    ? read
    : firstMetadataAt(rest, issuer, requests, [...refusals, `${address} ${read.failure}`]);
}

export function metadataOf(issuer: string, requests: IssuerRequests): Promise<Result.Result<IssuerMetadata, string>> {
  return firstMetadataAt(metadataAddressesOf(issuer), issuer, requests, []);
}
