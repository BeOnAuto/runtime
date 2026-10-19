import { fileSetting, type FileSetting } from '@on.auto/config';
import { connectionsSortsOfCredential, ConnectionsSettingSchema } from '@on.auto/connections';
import { ApiKeysSchema } from '@on.auto/identity';
import { entryProse } from '@on.auto/providers';
import { AllowedModelsSchema, DeclaredModelsSchema, ModelAliasesSchema, ModelGatewaysSchema } from '@on.auto/reasoning';
import { ToolServersSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { Origin } from '../settings/origin.ts';

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

export const fileSettings: readonly FileSetting[] = [
  fileSetting(
    'ALLOWED_ORIGINS',
    Schema.Array(Origin).annotate({
      description:
        'The origins a page in a browser may call the API from, such as https://app.example.com. ALLOWED_ORIGINS wins over it',
    }),
    (origins) => origins.join(','),
  ),
  fileSetting(
    'API_KEYS',
    ApiKeysSchema.annotate({
      description: 'The API keys the server accepts, each as the key command prints it. API_KEYS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'MODEL_GATEWAYS',
    ModelGatewaysSchema.annotate({
      description: 'OpenAI-compatible gateways, each a provider prefix of its own. MODEL_GATEWAYS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'MODEL_ALIASES',
    ModelAliasesSchema.annotate({
      description:
        'Model references a reasoning function may give, each sent on as another reference; a trailing * on both sides covers every model of a provider. MODEL_ALIASES wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'DECLARED_MODELS',
    DeclaredModelsSchema.annotate({
      description:
        'The models list_models shows for bedrock, bedrock-anthropic, azure, vertex and vertex-anthropic, which do not list their own, and for a gateway whose list cannot be read, keyed by the provider prefix. DECLARED_MODELS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'ALLOWED_MODELS',
    AllowedModelsSchema.annotate({
      description:
        'The only model references a reasoning function may give, by name or through an alias, and list_models shows, each provider/model or provider/* for every model of a provider; every model when left out. ALLOWED_MODELS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'TOOL_SERVERS',
    ToolServersSchema.annotate({
      description:
        'The tool servers whose tools a function may name, each bound to an org and optionally its playbooks: url for a remote MCP server, command for an MCP server run as a process, document for an HTTP API described by an OpenAPI document. Secrets are references such as ${GRAPH_API_KEY}. TOOL_SERVERS wins over it',
    }),
    asJson,
    { references: 'kept', judgedByShape: ['placeholders'] },
  ),
  fileSetting('CONNECTIONS', ConnectionsSettingSchema, asJson, {
    references: 'kept',
    sortsOfCredential: connectionsSortsOfCredential,
    prose: entryProse,
    judgedByShape: ['placeholders'],
  }),
];
