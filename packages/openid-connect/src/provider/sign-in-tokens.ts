import { fetchUserInfo, tokenRevocation, type Configuration, type TokenEndpointResponse } from 'openid-client';

import { failureOf } from './provider-requests.ts';
import { textClaim, verifiedClaim, type StandardClaims } from './standard-claims.ts';

export interface EndpointsDeclared {
  readonly userinfo: boolean;
  readonly revocation: boolean;
}

export interface TokensReleased extends Pick<StandardClaims, 'name' | 'email_verified'> {
  readonly userInfoUnread?: string;
  readonly notRevoked?: string;
}

export interface TokensHeld {
  readonly released: (asked: boolean) => Promise<TokensReleased>;
}

export interface IdTokenRead {
  readonly subject: string;
  readonly named: boolean;
  readonly addressUnverified?: string;
}

type TokenAnswer = Pick<TokenEndpointResponse, 'access_token' | 'refresh_token'>;

function verifiedFor(answer: unknown, address: string | undefined): Pick<StandardClaims, 'email_verified'> {
  return address !== undefined && textClaim(answer, 'email').email === address ? verifiedClaim(answer) : {};
}

async function userInfoRead(
  configuration: Readonly<Configuration>,
  accessToken: string,
  { subject, named, addressUnverified }: IdTokenRead,
): Promise<TokensReleased> {
  try {
    const answer = await fetchUserInfo(configuration, accessToken, subject);
    return { ...(named ? {} : textClaim(answer, 'name')), ...verifiedFor(answer, addressUnverified) };
  } catch (error) {
    return { userInfoUnread: failureOf(error) };
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

function leftToRead({ named, addressUnverified }: IdTokenRead): boolean {
  return !named || addressUnverified !== undefined;
}

export function tokensHeldBy(
  configuration: Readonly<Configuration>,
  declared: EndpointsDeclared,
  answer: TokenAnswer,
  read: IdTokenRead,
): TokensHeld | undefined {
  const accessToken = declared.userinfo && leftToRead(read) ? answer.access_token : undefined;
  const refreshToken = declared.revocation ? answer.refresh_token : undefined;
  if (accessToken === undefined && refreshToken === undefined) {
    return undefined;
  }
  return {
    released: async (asked) => {
      const claims = accessToken !== undefined && asked ? await userInfoRead(configuration, accessToken, read) : {};
      const revoked = refreshToken === undefined ? {} : await handedBack(configuration, refreshToken);
      return { ...claims, ...revoked };
    },
  };
}
