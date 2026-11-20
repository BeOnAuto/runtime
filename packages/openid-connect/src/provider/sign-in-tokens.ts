import { fetchUserInfo, tokenRevocation, type Configuration, type TokenEndpointResponse } from 'openid-client';

import { failureOf } from './provider-requests.ts';
import { textClaim } from './standard-claims.ts';

export interface EndpointsDeclared {
  readonly userinfo: boolean;
  readonly revocation: boolean;
}

export interface TokensReleased {
  readonly name?: string;
  readonly nameUnread?: string;
  readonly notRevoked?: string;
}

export interface TokensHeld {
  readonly released: (nameAsked: boolean) => Promise<TokensReleased>;
}

interface IdTokenRead {
  readonly subject: string;
  readonly named: boolean;
}

type TokenAnswer = Pick<TokenEndpointResponse, 'access_token' | 'refresh_token'>;

async function nameRead(configuration: Readonly<Configuration>, accessToken: string, subject: string) {
  try {
    return textClaim(await fetchUserInfo(configuration, accessToken, subject), 'name');
  } catch (error) {
    return { nameUnread: failureOf(error) };
  }
}

async function handedBack(configuration: Readonly<Configuration>, refreshToken: string) {
  try {
    await tokenRevocation(configuration, refreshToken, { token_type_hint: 'refresh_token' });
    return {};
  } catch (error) {
    return { notRevoked: failureOf(error) };
  }
}

export function tokensHeldBy(
  configuration: Readonly<Configuration>,
  declared: EndpointsDeclared,
  answer: TokenAnswer,
  { subject, named }: IdTokenRead,
): TokensHeld | undefined {
  const accessToken = declared.userinfo && !named ? answer.access_token : undefined;
  const refreshToken = declared.revocation ? answer.refresh_token : undefined;
  if (accessToken === undefined && refreshToken === undefined) {
    return undefined;
  }
  return {
    released: async (nameAsked) => {
      const name = accessToken !== undefined && nameAsked ? await nameRead(configuration, accessToken, subject) : {};
      const revoked = refreshToken === undefined ? {} : await handedBack(configuration, refreshToken);
      return { ...name, ...revoked };
    },
  };
}
