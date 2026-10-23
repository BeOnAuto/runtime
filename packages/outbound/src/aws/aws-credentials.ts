import type { ProxySettings } from '../proxy/proxy-settings.ts';
import type { AwsCredentialChain } from './aws-clients.ts';

export const awsCredentialVariables: readonly string[] = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
];

export async function awsCredentialChainOf(proxy: ProxySettings): Promise<AwsCredentialChain> {
  const { awsCredentialChain } = await import('./aws-clients.ts');
  return awsCredentialChain(proxy);
}
