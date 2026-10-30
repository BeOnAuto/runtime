---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Set up a model provider

Reasoning functions call language models through the providers you configure. This guide sets up a provider, shows the settings for common deployments, and checks that the server can call a model. Which models you can call depends on your provider account.

The [model settings reference](../reference/model-settings.md) holds the rules behind these settings: aliases, allowed and declared models, how the list of models is built, and what happens when a model call fails. The [configuration reference](configuration.md#models) lists every setting in one place.

## Steps

1. [Choose a provider](#choose-a-provider).
2. [Set its credentials](#set-the-credentials) in the server's environment. Keys and tokens belong in the environment only. Gateways and aliases can also go in the [configuration file](configuration.md).
3. Start or restart the server. It reads the model settings once, at start, so a changed setting takes effect at the next start.
4. [Check the start-up line](#check-the-start-up-line) for `Model providers configured: ...`.
5. [Check which models you can call](#check-which-models-you-can-call) with `list_models`.
6. [Name a model](#name-a-model) in the definition.

## Choose a provider

A provider is configured when its required settings are present. A provider that is not configured is simply absent: nothing fails at start, and a definition that names it is refused when it runs (see [When a provider is not configured](../reference/model-settings.md#when-a-provider-is-not-configured)).

| Prefix              | Calls                                          | Required settings                                                                            | Optional settings                                                                                      |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `anthropic`         | Anthropic Messages API                         | `ANTHROPIC_API_KEY`, or `ANTHROPIC_AUTH_TOKEN` (sent as a bearer token)                      | `ANTHROPIC_BASE_URL`                                                                                   |
| `openai`            | OpenAI Responses API                           | `OPENAI_API_KEY`                                                                             | `OPENAI_BASE_URL`; `OPENAI_API=chat_completions` for an endpoint that only implements Chat Completions |
| `google`            | Gemini API                                     | `GOOGLE_GENERATIVE_AI_API_KEY`                                                               |                                                                                                        |
| `bedrock`           | Amazon Bedrock Converse API                    | `AWS_REGION`                                                                                 | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, `AWS_ENDPOINT_URL`                     |
| `bedrock-anthropic` | Anthropic models through Bedrock InvokeModel   | As `bedrock`                                                                                 | As `bedrock`                                                                                           |
| `azure`             | Azure OpenAI Responses API                     | `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`, and `AZURE_API_KEY` or a Microsoft Entra ID token | `AZURE_API_VERSION`                                                                                    |
| `vertex`            | Gemini on Google Vertex AI                     | `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION`                                         |                                                                                                        |
| `vertex-anthropic`  | Anthropic models on Google Vertex AI           | As `vertex`                                                                                  |                                                                                                        |
| A gateway's `name`  | An OpenAI-compatible Chat Completions endpoint | An entry in `model_gateways` or `MODEL_GATEWAYS`                                             | See [Gateway fields](../reference/model-settings.md#gateway-fields)                                    |

Every provider works in the default image and with `npx @on.auto/runtime`, with one exception. Azure with Microsoft Entra ID needs the optional package `@azure/identity`, which only an image built for it contains (see [Azure OpenAI with Microsoft Entra ID](#azure-openai-with-microsoft-entra-id-opt-in)).

There is no default provider. A model id without a provider prefix is never sent anywhere.

## Set the credentials

Put the provider's settings in the server's environment, as the [deployment shapes](#deployment-shapes) below show. The settings follow these rules. A value that breaks one stops the start with `model_settings_invalid`, which names every setting at fault and never repeats a value, such as `The model settings are invalid. OPENAI_API: Expected responses or chat_completions`.

- Set `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, not both.
- Set `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`, not both.
- `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `AZURE_BASE_URL` and the AWS endpoint URLs are http or https URLs.
- `OPENAI_API` is `responses`, the default, or `chat_completions`.
- `AWS_REGION`, `AZURE_RESOURCE_NAME` and `GOOGLE_VERTEX_LOCATION` hold only letters, digits and hyphens.
- `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` wins over `AWS_ENDPOINT_URL` when both are set.

### Where cloud credentials come from

- Bedrock (`bedrock` and `bedrock-anthropic`) signs every request with credentials from the AWS default credential chain. The chain tries environment variables, IAM roles for service accounts (a web identity token file), EKS Pod Identity and ECS task roles (a container credentials endpoint), instance roles, shared profiles and SSO. It reads its own variables (`AWS_ACCESS_KEY_ID`, `AWS_PROFILE`, `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE` and the rest) as the AWS SDK documents them. When `AWS_BEARER_TOKEN_BEDROCK` is set, it is sent instead.
- Vertex (`vertex` and `vertex-anthropic`) uses Google application default credentials: workload identity, an attached service account, or the file named by `GOOGLE_APPLICATION_CREDENTIALS`.
- Azure without `AZURE_API_KEY` uses Microsoft Entra ID, through `DefaultAzureCredential` of `@azure/identity`, with the scope `https://cognitiveservices.azure.com/.default`.

## Deployment shapes

Each section shows the settings a deployment needs and nothing else.

### Direct API keys

```sh
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

Definitions then name `anthropic/claude-sonnet-4-5`, `openai/gpt-5` or `google/gemini-2.5-flash`.

### Amazon Bedrock with an IAM role

Give the workload a role that may call `bedrock:InvokeModel`:

- on Kubernetes, through IAM roles for service accounts or EKS Pod Identity;
- on ECS, as a task role;
- on EC2, as an instance profile.

Then set only the region:

```sh
AWS_REGION=eu-central-1
```

To reach Bedrock through a VPC endpoint, add:

```sh
AWS_ENDPOINT_URL_BEDROCK_RUNTIME=https://vpce-0123456789abcdef0-abcdefgh.bedrock-runtime.eu-central-1.vpce.amazonaws.com
```

Definitions name `bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0`. To use Anthropic's own request format through InvokeModel, they name `bedrock-anthropic/<the same id>`. InvokeModel also accepts application inference profile ARNs.

### Azure OpenAI with an API key

```sh
AZURE_RESOURCE_NAME=acme-openai
AZURE_API_KEY=...
```

Definitions name the deployment: `azure/gpt-5-production`.

To address the resource by URL, set `AZURE_BASE_URL=https://acme-openai.openai.azure.com/openai` in place of `AZURE_RESOURCE_NAME`, and optionally `AZURE_API_VERSION`. When `AZURE_BASE_URL` is a host outside Azure, such as an API Management gateway, requests go to `<AZURE_BASE_URL>/responses` without an `api-version`. The gateway owns the path and the version.

### Azure OpenAI with Microsoft Entra ID (opt-in)

Microsoft Entra ID needs `@azure/identity`, an optional dependency of the runtime. Neither the default image nor the npm package contains it. Build an image with it:

```sh
docker build --build-arg AZURE_IDENTITY=true --file packages/server/Dockerfile --tag onauto/runtime:entra .
```

- `AZURE_IDENTITY=true` adds `@azure/identity`, at the exact version `capabilities/reasoning/package.json` pins, and nothing else. The other optional packages of the server's dependencies stay out.
- Any value other than `true` or `false` stops the build.
- Measured on arm64, the default image is 505 MB and this one 529 MB.

Then give the workload an identity with the role _Cognitive Services OpenAI User_ on the resource: Azure workload identity on AKS, or a managed identity. Leave `AZURE_API_KEY` unset:

```sh
AZURE_RESOURCE_NAME=acme-openai
```

On AKS, the workload identity webhook sets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_FEDERATED_TOKEN_FILE`, which `DefaultAzureCredential` reads.

Without the package, nothing fails at start. The start-up line reports `azure` as not configured, needing `AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID`.

### Google Vertex AI with workload identity

Bind the Kubernetes service account to a Google service account with the role _Vertex AI User_, then set:

```sh
GOOGLE_VERTEX_PROJECT=acme-ai
GOOGLE_VERTEX_LOCATION=europe-west4
```

Outside Kubernetes, `GOOGLE_APPLICATION_CREDENTIALS=/var/run/secrets/google/credentials.json` names a credentials file instead. Definitions name `vertex/gemini-2.5-flash` or `vertex-anthropic/claude-sonnet-4-5`.

### An internal OpenAI-compatible gateway with a custom header

In the server's [configuration file](configuration.md):

```yaml
model_gateways:
  - name: internal
    base_url: https://llm.internal.example/v1
    api_key: ${INTERNAL_LLM_KEY}
    headers:
      x-tenant: acme
    structured_outputs: true
```

Set `INTERNAL_LLM_KEY` in the environment. You can also set the same gateway as an environment variable, which wins over the file's `model_gateways` when both are set:

```sh
MODEL_GATEWAYS='[{"name":"internal","base_url":"https://llm.internal.example/v1","api_key_env":"INTERNAL_LLM_KEY","headers":{"x-tenant":"acme"},"structured_outputs":true}]'
INTERNAL_LLM_KEY=...
```

Definitions name `internal/llama-3.3-70b`. [Gateway fields](../reference/model-settings.md#gateway-fields) lists every field of an entry and the rules each must meet. To send every model of a provider through the gateway, add a wildcard alias such as `anthropic/*: gateway/anthropic/*` (see [Model aliases](../reference/model-settings.md#model-aliases)).

### Behind an outbound proxy with a private certificate authority

Node.js 26 handles both without code:

```sh
NODE_USE_ENV_PROXY=1
HTTPS_PROXY=http://proxy.internal.example:3128
NO_PROXY=localhost,127.0.0.1,169.254.169.254,169.254.170.2,169.254.170.23,metadata.google.internal,.svc.cluster.local
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/internal-ca.pem
```

- `NODE_USE_ENV_PROXY=1` makes Node's `fetch` and its default HTTP agents use `HTTPS_PROXY` and `NO_PROXY`. Every model call goes through the proxy.
- The AWS credential chain makes its STS and SSO calls with agents of its own. When `NODE_USE_ENV_PROXY=1` is set, the runtime gives them the same proxy settings.
- Google's token client reads `HTTPS_PROXY` and `NO_PROXY` itself. It matches a `NO_PROXY` entry only as an exact host name, or as a suffix that starts with `.`, so write the entries that way. Azure's identity library also reads them itself.
- The cloud credential endpoints must not go through the proxy: `169.254.169.254` (EC2, GCE and Azure instance metadata), `169.254.170.2` (ECS task roles), `169.254.170.23` (EKS Pod Identity) and `metadata.google.internal`.
- `NODE_EXTRA_CA_CERTS` adds the certificate authority to every TLS connection Node makes.

A provider certificate that is still not trusted is never retried. The caller is told that the provider's certificate is not trusted by this server and that its operator must add the certificate authority. You get a hint naming `NODE_EXTRA_CA_CERTS` in the log (see [Operator hints](../reference/model-settings.md#operator-hints)).

Mutual TLS to the model endpoints is not supported.

## Check the start-up line

When the server starts, it logs one line that names the configured providers. Its annotations list every provider, with the settings that each unconfigured one lacks:

```json
{"message":"Model providers configured: anthropic","level":"INFO","annotations":{"providers":[{"provider":"anthropic","configured":true},{"provider":"openai","configured":false,"missing":["OPENAI_API_KEY"]},…]}}
```

- With `npx @on.auto/runtime`, the log level is `error` and the format `console` unless you set them. Set `LOG_LEVEL=info` to see this line, and `LOG_FORMAT=json` to see it as above.
- With no provider configured, the line is a warning: `No model provider is configured, so reasoning functions cannot run; set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY or MODEL_GATEWAYS`.
- A provider that has some of its settings but not all gets a warning of its own, since that is usually a mistake. A provider with none of its settings gets no warning.
- A provider reached only through a wildcard alias is not configured, and the line says so (see [Model aliases](../reference/model-settings.md#model-aliases)).
- Callers never see which settings are missing. Only this log names them.

A provider that is partly configured is logged like this:

```json
{
  "message": "Model provider azure is not configured; it needs AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID",
  "level": "WARN",
  "annotations": {
    "provider": "azure",
    "configured": false,
    "missing": ["AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID"]
  }
}
```

## Check which models you can call

Ask your agent to call `list_models`. It needs `org:read`, and over HTTP it is `GET /v1/orgs/{org}/models`. Its optional input `provider` lists only what one provider prefix serves. [Model information](../reference/mcp.md#model-information) describes what it returns.

- Bedrock, Azure and Vertex list only the models you [declare](../reference/model-settings.md#declared-models), or `<provider>/*` when you declare none. A wildcard is not a model to run.
- `catalog_status: "partial"` means a provider's list could not be read just now. The log says why.
- `narrowed: true` means `allowed_models` is set, and the list holds only what it allows.

[Listing the models](../reference/model-settings.md#listing-the-models) sets out where each list comes from and what the log says when one cannot be read.

## Name a model

Name one of the listed models in the definition's front matter, written `provider/model`:

```yaml
model: anthropic/claude-sonnet-4-5
```

Everything after the first `/` reaches the provider unchanged. Aliases and `allowed_models` apply before the call; [How a model reference is resolved](../reference/model-settings.md#how-a-model-reference-is-resolved) gives the order. If a run then fails, [When a model call fails](../reference/model-settings.md#when-a-model-call-fails) sorts each failure by who fixes it.
