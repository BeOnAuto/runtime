import { OutboundFailure } from './outbound-failure.ts';

export const googleCredentialVariables: readonly string[] = ['GOOGLE_APPLICATION_CREDENTIALS'];

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export type AwsCredentialSource = () => Promise<AwsCredentials>;

export type AccessTokenSource = () => Promise<string>;

export interface GoogleTokenClient {
  readonly getAccessToken: () => Promise<string | null | undefined>;
}

export interface CredentialSources {
  readonly aws?: AwsCredentialSource;
  readonly google?: AccessTokenSource;
  readonly azure?: AccessTokenSource;
}

export function guarded<Credential>(source: () => Promise<Credential>): () => Promise<Credential> {
  return async () => {
    try {
      return await source();
    } catch {
      throw new OutboundFailure('credential_lookup_failed');
    }
  };
}

export function googleAccessTokens(client: GoogleTokenClient): AccessTokenSource {
  return async () => {
    const token = await client.getAccessToken();
    if (token === null || token === undefined || token === '') {
      throw new OutboundFailure('credential_lookup_failed');
    }
    return token;
  };
}
