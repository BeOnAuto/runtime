import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Signer } from '@aws-sdk/rds-signer';

import type { ProxySettings } from '../proxy/proxy-settings.ts';

interface ProxiedAgent {
  readonly proxyEnv: Record<string, string | undefined>;
}

export interface AwsClientSettings {
  readonly requestHandler?: { readonly httpAgent: ProxiedAgent; readonly httpsAgent: ProxiedAgent };
}

export type AwsCredentialChain = ReturnType<typeof fromNodeProviderChain>;

export interface DatabaseTokenRequest {
  readonly hostname: string;
  readonly port: number;
  readonly username: string;
  readonly region: string;
}

export type DatabaseTokenSigner = () => Promise<string>;

export function awsClientSettingsOf(proxy: ProxySettings): AwsClientSettings {
  if (!proxy.enabled) {
    return {};
  }
  const agent = { proxyEnv: { ...proxy.environment } };
  return { requestHandler: { httpAgent: agent, httpsAgent: agent } };
}

export function awsCredentialChain(proxy: ProxySettings): AwsCredentialChain {
  return fromNodeProviderChain({ clientConfig: awsClientSettingsOf(proxy) });
}

export function awsDatabaseTokenSigner(proxy: ProxySettings, request: DatabaseTokenRequest): DatabaseTokenSigner {
  const signer = new Signer({ ...request, credentials: awsCredentialChain(proxy) });
  return () => signer.getAuthToken();
}
