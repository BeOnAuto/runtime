import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { createGoogleVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

import type { VertexSettings } from '../settings/provider-settings.ts';
import { googleAccessTokens, type AccessTokenSource } from './credential-sources.ts';
import type { Fetch, ModelFactory } from './sdk-model.ts';

const googleCloudScope = 'https://www.googleapis.com/auth/cloud-platform';

export function googleCredentialChain(project: string): AccessTokenSource {
  return googleAccessTokens(new GoogleAuth({ scopes: [googleCloudScope], projectId: project }));
}

function refreshingGoogleClient(tokens: AccessTokenSource): OAuth2Client {
  const client = new OAuth2Client();
  client.refreshHandler = async () => ({ access_token: await tokens(), expiry_date: Date.now() });
  return client;
}

export function vertexModels(settings: VertexSettings, tokens: AccessTokenSource, fetch: Fetch): ModelFactory {
  const provider = createGoogleVertex({
    project: settings.project,
    location: settings.location,
    apiKey: '',
    googleAuthOptions: { authClient: refreshingGoogleClient(tokens) },
    fetch,
  });
  return (modelId) => provider.languageModel(modelId);
}

export function vertexAnthropicModels(settings: VertexSettings, tokens: AccessTokenSource, fetch: Fetch): ModelFactory {
  const provider = createGoogleVertexAnthropic({
    project: settings.project,
    location: settings.location,
    generateAuthToken: tokens,
    fetch,
  });
  return (modelId) => provider.languageModel(modelId);
}
