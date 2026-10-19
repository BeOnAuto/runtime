import { allPermissions } from '@on.auto/operations';
import { Result } from 'effect';

import { pageOriginsOf, type PageSettings } from '../access/page-origins.ts';
import { signedInPersonOf, type Authentication } from '../access/principal.ts';
import { verifiedPerson } from '../tokens/token-verification.ts';
import { keysOfIssuer } from './issuer-keys.ts';
import { issuerRequestsOverTheNetwork, type IssuerRequests } from './issuer-requests.ts';
import { UnusableIdentityServiceError } from './unusable-identity-service-error.ts';

export const autoIdentityService = 'https://clerk.on.auto';

const organizationScope = 'user:org:read';

export const signInScopes: readonly string[] = [organizationScope, ...allPermissions];

export interface ProtectedResource {
  readonly publicUrl: string;
  readonly authorizationServers: readonly string[];
}

export interface IdentityService {
  readonly resource: ProtectedResource;
  readonly personOf: (token: string, resourcePath: string, requestOrigin?: string) => Promise<Authentication>;
}

export interface SignInSettings {
  readonly issuer: string;
  readonly publicUrl: string;
}

export interface IdentityServiceSettings extends SignInSettings, PageSettings {}

function audiencesOf(publicUrl: string, resourcePath: string): readonly string[] {
  return [publicUrl, `${publicUrl}/`, ...(resourcePath === '' ? [] : [`${publicUrl}${resourcePath}`])];
}

export async function identityServiceOf(
  { issuer, publicUrl, studio, allowedOrigins }: IdentityServiceSettings,
  requests: IssuerRequests = issuerRequestsOverTheNetwork,
): Promise<IdentityService> {
  const keys = await keysOfIssuer(issuer, requests);
  if (Result.isFailure(keys)) {
    throw new UnusableIdentityServiceError({
      message: `The identity service at ${issuer} cannot be used: ${keys.failure}`,
    });
  }
  const pageOrigins = pageOriginsOf({ studio, allowedOrigins }, publicUrl);
  return {
    resource: { publicUrl, authorizationServers: [issuer] },
    personOf: async (token, resourcePath, requestOrigin) => {
      const audiences = audiencesOf(publicUrl, resourcePath);
      const expected = { issuer, audiences, pageOrigins, requestOrigin, now: requests.now() };
      const verified = await verifiedPerson(token, keys.success, expected);
      return Result.isSuccess(verified) ? signedInPersonOf(verified.success) : { because: verified.failure };
    },
  };
}
