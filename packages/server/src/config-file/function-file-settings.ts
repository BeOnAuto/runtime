import { fileSetting, type FileSetting } from '@on.auto/config';
import { AllowedModelsSchema, DeclaredModelsSchema, ModelAliasesSchema, ModelGatewaysSchema } from '@on.auto/reasoning';
import { ToolServersSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

export function asJson(value: unknown): string {
  return JSON.stringify(value);
}

export const functionFileSettings: readonly FileSetting[] = [
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
    'VOICE_MODEL',
    Schema.String.annotate({
      description:
        'The model that writes out what a person says, which Studio offers beside each comment field, as provider/model, its provider openai or the name of an entry of model_gateways, such as openai/whisper-1; none when left out. VOICE_MODEL wins over it',
    }),
    (model) => model,
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
];
