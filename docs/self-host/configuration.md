---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Configuration reference

This page lists every setting of the runtime, the configuration file, and the tool servers functions may call. The runtime reads its settings once, when it starts. Change a setting, then restart the server.

## How settings are read

- Every setting is an environment variable. Keys and other secrets go in the environment alone.
- A container takes its variables from its platform, or from a file of them with `docker run --env-file`.
- `npx @on.auto/runtime` also reads `.env` in the folder it starts in. A variable set in the shell wins over `.env`.
- Settings that are lists or maps, `ACCESS_MODE`, the two settings of Studio, `USAGE_PING` and the license can also go in a YAML configuration file: `model_gateways`, `model_aliases`, `declared_models`, `allowed_models`, `tool_servers`, `connections`, `api_keys`, `access_mode`, `allowed_origins`, `studio_origin`, `serve_studio`, `usage_ping` and `license`.
- `CONFIG_FILE` names that file. `npx @on.auto/runtime` reads `auto-runtime.yaml` in the folder it starts in when it is there, unless `.env` or the shell sets `CONFIG_FILE`. A container reads a file only when `CONFIG_FILE` names it, as [Use a configuration file](docker.md#use-a-configuration-file) shows.
- Each key of the file stands for the environment variable of the same name in upper case, and `license` for `AUTO_RUNTIME_LICENSE`, whose `key` and `allocation` `AUTO_RUNTIME_LICENSE_KEY` and `AUTO_RUNTIME_ALLOCATION` win over. A variable that is set wins over the key, whole: `MODEL_GATEWAYS` replaces the file's `model_gateways`, and the two are not merged.
- Precedence, highest first: the shell, `.env` (with `npx`), the configuration file, the default.
- At start, the server logs which settings it read from the file, and which of them the environment set too.
- A value the server cannot read stops it at start. The message names the setting and what it expects, and never the value.

### Write the configuration file

Copy [`auto-runtime.example.yaml`](https://github.com/BeOnAuto/runtime/blob/main/auto-runtime.example.yaml) to start one. [`auto-runtime.schema.json`](https://github.com/BeOnAuto/runtime/blob/main/auto-runtime.schema.json) is the file's JSON Schema, so an editor with the YAML language server completes and checks it.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeOnAuto/runtime/main/auto-runtime.schema.json
model_gateways:
  - name: gateway
    base_url: https://gateway.example.com/v1
    api_key: ${GATEWAY_API_KEY}
model_aliases:
  anthropic/*: gateway/anthropic/*
```

A secret is never written in the file. The file refers to the variable that holds it:

- `${NAME}` takes the value of the variable `NAME`;
- `${NAME:-default}` takes `default` when `NAME` is not set;
- `$$` stands for a literal `$`.

The server stops at start with one line that names the file, the line, the column and the key, never a value, when:

- it cannot use the file;
- the file holds a key the server does not know;
- a value is one its setting refuses;
- a reference names a variable that is not set;
- a credential is written out instead of referenced.

A value counts as a credential written out when:

- its key names a credential, such as `api_key`, `Authorization`, `client_secret`, `password` or `token`, and it holds no reference. `credential_kinds` of the `connections` section, and `token_endpoint_auth_method` of a client under its `registered_clients`, name sorts of credential and not one, so their values are judged by their shape alone; the values under `placeholders` of an entry of `tool_servers`, and of a provider under `connections.providers`, such as a host a choice `sets`, are judged by their shape alone too, whatever their names; and the `title` and `description` of a provider under `connections.providers`, a way's `description` among them, are prose, judged by neither;
- the text written out in it has the shape of one, such as `Bearer ...`, an `sk-...` provider key or an `abk_...` API key;
- it is a URL with a password, whose user or query value has that shape, or whose query names a parameter as a key that names a credential does, such as `?api_key=...`, and holds no reference there;
- it is an argument whose part after its `=` has that shape;
- it is the `default` of a reference, as in `${NAME:-default}`, that is not empty and would count by these rules if it were written alone. The server then says to set the variable instead, and an empty default, as in `${NAME:-}`, passes.

Inside an argument, only the value is judged, never the name the argument gives it. A `client_id` in the shape of a credential is refused in words of its own, since a client id is written out and its secret or key goes beside it, as a reference.

## What to set for what

| To use                                                         | Set                                                                                                                                          | See                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A provider's own API                                           | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`                                                                      | [Direct API keys](models.md#direct-api-keys)                                            |
| An OpenAI-compatible gateway                                   | `model_gateways` in the file, a list whose `name` becomes the prefix, `gateway/<model>`                                                      | [A gateway](models.md#an-internal-openai-compatible-gateway-with-a-custom-header)       |
| Amazon Bedrock                                                 | `AWS_REGION`, with the AWS default credential chain                                                                                          | [Bedrock](models.md#amazon-bedrock-with-an-iam-role)                                    |
| Azure OpenAI                                                   | `AZURE_RESOURCE_NAME` and `AZURE_API_KEY`                                                                                                    | [Azure](models.md#azure-openai-with-an-api-key)                                         |
| Google Vertex AI                                               | `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION`                                                                                         | [Vertex](models.md#google-vertex-ai-with-workload-identity)                             |
| Your own names for models                                      | `model_aliases` in the file                                                                                                                  | [Model aliases](../reference/model-settings.md#model-aliases)                           |
| Another provider's models, through your gateway                | `model_aliases: {anthropic/*: gateway/anthropic/*}` in the file                                                                              | [Model aliases](../reference/model-settings.md#model-aliases)                           |
| The models listed for Bedrock, Azure or Vertex                 | `declared_models` in the file, a list of model ids for each provider prefix                                                                  | [Declared models](../reference/model-settings.md#declared-models)                       |
| Only some models                                               | `allowed_models` in the file, such as `[anthropic/*, gateway/llama-3.3-70b]`                                                                 | [Allowed models](../reference/model-settings.md#allowed-models)                         |
| An outbound proxy or a private certificate authority           | `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`                                                                              | [Proxy and CA](models.md#behind-an-outbound-proxy-with-a-private-certificate-authority) |
| The ledger in Amazon RDS without a database password           | `DATABASE_URL` without a password and `DATABASE_CREDENTIALS=aws-iam`                                                                         | [Without a password](postgresql.md#without-a-password-on-amazon-rds)                    |
| Secrets sealed under a key of your own                         | `SECRETS_KEY` or `SECRETS_KEY_FILE`, and `SECRETS_KEY_PREVIOUS` or `SECRETS_KEY_FILE_PREVIOUS` while it replaces another                     | [Secrets at rest](security.md#secrets-at-rest)                                          |
| Secrets sealed under a key in AWS KMS                          | `SECRETS_KEY_KMS`, the ARN of the key or of its alias, and `SECRETS_KEY_KMS_PREVIOUS` while it replaces another                              | [Hold the secrets key in a KMS](production.md#hold-the-secrets-key-in-a-kms)            |
| Secrets kept in AWS Parameter Store, not in the ledger         | `SECRETS_KEEPER=aws-parameter-store:<prefix>`, and `SECRETS_KEEPER_PREVIOUS` while the secrets move from the ledger or back                  | [Keep secrets in your secret manager](secret-manager.md)                                |
| Content kept in an object store instead of the ledger          | `CONTENT_STORE_URL`, an `s3://bucket/prefix` URL                                                                                             | [Object storage](object-storage.md)                                                     |
| Tools that functions may call                                  | `tool_servers` in the file, each entry's `allowed` to allow only some of its tools                                                           | [Tool servers](#tool-servers)                                                           |
| People who sign in through the Auto identity service           | `PUBLIC_URL`, which turns sign-in on, `IDENTITY_ISSUER` for a development instance, `IDENTITY_JWKS` or `IDENTITY_JWKS_URL` for its key set   | [Let people sign in](security.md#let-people-sign-in)                                    |
| Machines and pipelines that call the API                       | `API_KEYS`, with an entry the key command prints for each                                                                                    | [API keys](security.md#api-keys)                                                        |
| Auto in a container on your own machine, without sign-in       | `ACCESS_MODE=local` and `PUBLIC_URL=http://localhost:5555`, with the port published on `127.0.0.1` alone                                     | [Run with Docker](docker.md#on-your-own-machine)                                        |
| Studio served by the runtime, or fetched from another host     | `SERVE_STUDIO` and `STUDIO_ORIGIN`                                                                                                           | [Studio served by the runtime](security.md#studio-served-by-the-runtime)                |
| Consent at a provider without registering a client             | `AUTO_CLIENTS=true`, on by default in local mode                                                                                             | [Consent through Auto](connections.md#consent-through-auto)                             |
| The requests interaction functions may keep open               | `INTERACTION_OPEN_REQUESTS`                                                                                                                  | [Interaction functions](#interaction-functions)                                         |
| The model processes and the builds of prediction functions     | `PREDICTION_PROCESSES`, `PREDICTION_PROCESS_MEMORY`, `PREDICTION_BUILDS_AT_ONCE`, `PREDICTION_BUILDS_PER_DAY` and `PREDICTION_MAX_FUNCTIONS` | [Prediction functions](#prediction-functions)                                           |
| The folder prediction functions keep model files in            | `PREDICTION_CACHE_DIR`                                                                                                                       | [Prediction functions](#prediction-functions)                                           |
| No usage ping when Auto starts                                 | `DO_NOT_TRACK=1` or `USAGE_PING=false`                                                                                                       | [Usage ping](#usage-ping)                                                               |
| A runtime past the 100 actions it runs before it is registered | `AUTO_RUNTIME_LICENSE_KEY`, or `license.key` in the file, the key Studio gives                                                               | [Register and license a runtime](licenses.md)                                           |
| An installation that does not reach Auto                       | `AUTO_RUNTIME_ALLOCATION`, or `license.allocation` in the file, the allocation an operator of Auto signs, beside the key                     | [Offline installations](licenses.md#offline-installations)                              |

`list_models` (`GET /v1/orgs/{org}/models`, and the MCP tool of the same name) shows the models the server can call, leaving out what `allowed_models` does not allow. [Listing the models](../reference/model-settings.md#listing-the-models) sets out how it builds the list, and [Allowed models](../reference/model-settings.md#allowed-models) what a definition that names a model outside `allowed_models` returns.

## Settings

Every setting is an environment variable. The tables below group them by area.

### Server and logs

| Variable      | Default                                                       | Purpose                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`        | `5555`                                                        | The port the server listens on                                                                                                                                                                                                                                             |
| `HOST`        | `0.0.0.0` in the image, `127.0.0.1` with `npx`                | The interface the server binds to. On a loopback address with neither `PUBLIC_URL` nor `API_KEYS`, the server is in [local mode](security.md#local-mode). On any other address it needs one of them to start, or `ACCESS_MODE=local` beside a `PUBLIC_URL` on the loopback |
| `CONFIG_FILE` | none; `auto-runtime.yaml` with `npx` when it is in the folder | The configuration file, absolute or relative to the working directory                                                                                                                                                                                                      |
| `LOG_FORMAT`  | `json`, `console` with `npx`                                  | `json`: one JSON object per line on stderr. `pretty`: lines of text for a person. `console`: a time, a mark for the level and the message, in color at a terminal                                                                                                          |
| `LOG_LEVEL`   | `info`, `error` with `npx`                                    | The least level logged: `debug`, `info`, `warn` or `error`                                                                                                                                                                                                                 |
| `USAGE_PING`  | `true`                                                        | `true` or `false`: whether Auto sends its anonymous [usage ping](#usage-ping) when it starts. `DO_NOT_TRACK` and `SCARF_NO_ANALYTICS` turn it off too; `usage_ping` in the file                                                                                            |

### Sign-in and access

[Authentication and security](security.md) sets out how these work together.

| Variable                   | Default                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`               | none                                    | The URL at which callers reach the runtime, which its links point at. Without `ACCESS_MODE`, it turns sign-in through the Auto identity service on, and every access token names it as its audience; [Let people sign in](security.md#let-people-sign-in) gives the URLs it accepts. Beside `ACCESS_MODE=local`, it signs no one in, is taken only on `localhost`, `127.0.0.1` or `[::1]`, and is needed where the server listens beyond the loopback, as in a container ([Run with Docker](docker.md#on-your-own-machine))                                                                                       |
| `IDENTITY_ISSUER`          | `https://clerk.on.auto`                 | The identity service that people sign in through, an `https` URL with no path, query or fragment. A development runtime names the development instance of the service                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `IDENTITY_JWKS`            | none                                    | The key set of the identity service, as the JSON of a JWK set, `{"keys":[…]}`, that holds at least one key, each naming its `kty`, for a service that publishes its keys another way, or a server that should read nothing of the service at start. The server then reads neither the metadata nor a key set of the service, and trusts these keys until it restarts. Set it or `IDENTITY_JWKS_URL`, not both. See [What the server checks at start](../reference/authentication.md#what-the-server-checks-at-start)                                                                                              |
| `IDENTITY_JWKS_URL`        | none                                    | The `https` URL of the identity service's key set, read in place of the `jwks_uri` of its metadata, which the server then does not read. The key set is kept and read again as one found through the metadata is ([How the key set is kept](../reference/authentication.md#how-the-key-set-is-kept)). Set it or `IDENTITY_JWKS`, not both                                                                                                                                                                                                                                                                         |
| `API_KEYS`                 | none                                    | The API keys the server accepts, as a compact JSON array of the entries the key command prints; `api_keys` in the file. See [API keys](security.md#api-keys)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ACCESS_MODE`              | none                                    | `local` declares [local mode](security.md#local-mode) on any address, for a server whose port only this computer reaches, such as a container whose port Docker publishes on `127.0.0.1` alone; never with a wider publish, and never beside containers on the same Docker network that you would not let act as you. It stops the start beside `API_KEYS`, beside a `PUBLIC_URL` that is not on `localhost`, `127.0.0.1` or `[::1]`, and without a `PUBLIC_URL` where the server listens beyond the loopback, as in a container; `access_mode` in the file. See [Run with Docker](docker.md#on-your-own-machine) |
| `ALLOWED_ORIGINS`          | none                                    | Comma-separated origins a browser page may call the API from, besides the Studio host's and, where the runtime serves Studio, its own; `allowed_origins` in the file. See [Calling from a browser](security.md#calling-from-a-browser)                                                                                                                                                                                                                                                                                                                                                                            |
| `STUDIO_ORIGIN`            | `https://studio.on.auto`                | The Studio host: an `https` address, or an `http` address on `localhost`, `127.0.0.1` or `[::1]`, with no path. A page there may call the API, and the runtime fetches Studio from it when it serves Studio; `studio_origin` in the file. See [Studio served by the runtime](security.md#studio-served-by-the-runtime)                                                                                                                                                                                                                                                                                            |
| `SERVE_STUDIO`             | `true` in local mode, `false` otherwise | `true` or `false`: whether the runtime serves Studio itself at `/studio/` on its own address, fetched from `STUDIO_ORIGIN` and kept beside a SQLite ledger file. It works in local mode alone for now, and the server warns at start where it is on elsewhere; `serve_studio` in the file. See [Studio served by the runtime](security.md#studio-served-by-the-runtime)                                                                                                                                                                                                                                           |
| `AUTO_CLIENTS`             | `true` in local mode, `false` otherwise | `true` or `false`: whether a provider whose way takes a registered client takes Auto's client too, through Auto's consent service, where `registered_clients` lists none at its issuer that covers the scope its way asks; it wins over `auto_clients` of the `connections` section. The tokens of such a consent pass through Auto at the consent and at every renewal. See [Consent through Auto](connections.md#consent-through-auto)                                                                                                                                                                          |
| `CONSENT_SERVICE_URL`      | `https://consent.on.auto`               | Auto's consent service, an `https` URL with no path, query or fragment, or an `http` URL on `localhost`, `127.0.0.1` or `[::1]` for a test. The runtime reaches it whatever `allowed_hosts` says, as it reaches the Auto identity service                                                                                                                                                                                                                                                                                                                                                                         |
| `AUTO_RUNTIME_LICENSE_KEY` | none                                    | The key Studio gives as an owner of an org registers this runtime's installation, `alk.<org>.<installation>.<secret>`, which licenses the runtime past the 100 actions it runs before it is registered, and is activated at every start; `license.key` in the file, as a reference to the variable that holds it. See [Register and license a runtime](licenses.md)                                                                                                                                                                                                                                               |
| `AUTO_RUNTIME_ALLOCATION`  | none                                    | The allocation an operator of Auto signed for an installation that does not reach Auto, the JSON of its `payload`, `signature` and `kid`, taken at every start; `license.allocation` in the file, as a reference to the variable that holds it. See [Offline installations](licenses.md#offline-installations)                                                                                                                                                                                                                                                                                                    |
| `AUTO_RUNTIME_LICENSE`     | none                                    | The license as the file's `license` holds it, `{"key": …, "allocation": …}` in JSON, which the file sets; `AUTO_RUNTIME_LICENSE_KEY` and `AUTO_RUNTIME_ALLOCATION` win over its fields                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ACCOUNTS_ORIGIN`          | `https://billing.on.auto`               | Auto's account service, which activates a license key and admits each action of a licensed runtime: an `https` origin, or an `http` one on `localhost`, `127.0.0.1` or `[::1]`. Every answer is signed by Auto and checked against the key the runtime ships, which no setting changes                                                                                                                                                                                                                                                                                                                            |

### Storage

| Variable                    | Default                                                                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LEDGER_FILE`               | `data/ledger.db`, which in the image is on the `/data` volume; `~/.auto-runtime/ledger.db` with `npx` | The SQLite file of the ledger, absolute or relative to the working directory. Its folder is created when missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `DATABASE_URL`              | none                                                                                                  | A PostgreSQL URL. When set, the ledger is kept in that database instead, and setting `LEDGER_FILE` too stops the server at start. Environment only, since it holds a password. See [Use PostgreSQL](postgresql.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DATABASE_CREDENTIALS`      | `url`                                                                                                 | How the server signs in to that database: `url`, with the password the URL holds, or `aws-iam`, with a token signed for each connection. See [Without a password, on Amazon RDS](postgresql.md#without-a-password-on-amazon-rds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SECRETS_KEY`               | none                                                                                                  | The key the secrets kept in the ledger's database are sealed under: the base64 of 32 random bytes, as `openssl rand -base64 32` prints it. Set one of it, `SECRETS_KEY_FILE` and `SECRETS_KEY_KMS`; a ledger in PostgreSQL needs one of them while the ledger keeps the secrets. The keys the runtime keeps for itself are among those secrets, such as the one that signs the state an MCP client sends back when it retries a call, so a server whose key cannot read them does not start. Environment only. See [Secrets at rest](security.md#secrets-at-rest)                                                                                                                                                                                                                                                           |
| `SECRETS_KEY_FILE`          | `secrets.key` beside a SQLite ledger file, made at the first start                                    | A file that holds the same key, such as a secret your platform mounts into the container. A file named here is read as the platform mounts it, and the file the server makes is its owner's alone. A file named here is never made; one that is missing or that the server cannot read, one that holds anything but the key, and a default file that others than its owner may read stop the start. Without it, `SECRETS_KEY` or `SECRETS_KEY_KMS`, a SQLite ledger keeps its key in the default file. See [Keep the secrets key](production.md#keep-the-secrets-key)                                                                                                                                                                                                                                                       |
| `SECRETS_KEY_KMS`           | none                                                                                                  | The ARN of a symmetric AWS KMS key, `arn:aws:kms:<region>:<account>:key/<id>`, or of an alias of one, `arn:aws:kms:<region>:<account>:alias/<name>`, which wraps the key of each secret in place of a key in hand; the region is the ARN's, and the credentials the AWS default credential chain's. The identity needs `kms:Encrypt` and `kms:Decrypt` on the key, and `kms:DescribeKey` where the setting names an alias, which the server resolves to its key at start; a key that cannot wrap and unwrap at start stops the start. See [Hold the secrets key in a KMS](production.md#hold-the-secrets-key-in-a-kms)                                                                                                                                                                                                      |
| `SECRETS_KEY_PREVIOUS`      | none                                                                                                  | The key that `SECRETS_KEY`, `SECRETS_KEY_FILE` or `SECRETS_KEY_KMS` replaces, in the same form as `SECRETS_KEY` and only beside one of them. Set one of it, `SECRETS_KEY_FILE_PREVIOUS` and `SECRETS_KEY_KMS_PREVIOUS`. At start the server unwraps with it the key of each secret it wrapped and wraps that again under the current key, after which it can go. See [Rotate the secrets key](production.md#rotate-the-secrets-key)                                                                                                                                                                                                                                                                                                                                                                                         |
| `SECRETS_KEY_FILE_PREVIOUS` | none                                                                                                  | A file that holds the key being replaced, read as a file `SECRETS_KEY_FILE` names is, and otherwise as `SECRETS_KEY_PREVIOUS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SECRETS_KEY_KMS_PREVIOUS`  | none                                                                                                  | The ARN of the key in AWS KMS being replaced, in the form of `SECRETS_KEY_KMS`, and otherwise as `SECRETS_KEY_PREVIOUS`; the identity needs `kms:Decrypt` on it. See [Hold the secrets key in a KMS](production.md#hold-the-secrets-key-in-a-kms)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SECRETS_KEEPER`            | `ledger`                                                                                              | Where the value of each secret rests: `ledger`, sealed in the ledger's database under the secrets key, or `aws-parameter-store:<prefix>`, a `SecureString` parameter of its own under the prefix in AWS Systems Manager Parameter Store, in the region `AWS_REGION` names, or `AWS_DEFAULT_REGION` where that is not set, with the AWS default credential chain. The prefix is an absolute parameter path of at most 14 segments without a slash at its end. With Parameter Store as the only keeper, no `SECRETS_KEY`, `SECRETS_KEY_FILE` or `SECRETS_KEY_KMS` is needed, one that is set stops the start, and no key file is made. At start the server writes, reads and deletes one parameter under the prefix, and a prefix it cannot use stops the start. See [Keep secrets in your secret manager](secret-manager.md) |
| `SECRETS_KEEPER_PREVIOUS`   | none                                                                                                  | The keeper `SECRETS_KEEPER` replaces, the other of `ledger` and `aws-parameter-store:<prefix>`, only beside `SECRETS_KEEPER`. At start the server moves every secret the previous keeper keeps to the current one, after which it can go; while either is `ledger`, a secrets key is needed. See [Move secrets from the ledger and back](secret-manager.md#move-secrets-from-the-ledger-and-back)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `CONTENT_STORE_URL`         | none                                                                                                  | An `s3://bucket/prefix` URL. When set, content is kept in that bucket instead of the ledger's database. Content kept before a change is not moved; see [Keep content on object storage](object-storage.md#switch-a-deployment-that-already-has-content)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Models

Reasoning functions call language models with these settings, all optional. [Set up a model provider](models.md) says which to set for what, and how to check them in the start-up line. A provider whose settings are absent is not configured, and a definition that names it is rejected as `unavailable` when it runs. The [model settings reference](../reference/model-settings.md) holds the rules for the lists and maps below.

| Variable                                                                                         | Purpose                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`                              | Anthropic (`anthropic/...`)                                                                                                                                                                            |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API`                                                | OpenAI (`openai/...`). `OPENAI_API=chat_completions` for endpoints without the Responses API                                                                                                           |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                                   | Gemini API (`google/...`)                                                                                                                                                                              |
| `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, `AWS_ENDPOINT_URL` | Amazon Bedrock (`bedrock/...`, `bedrock-anthropic/...`), with the AWS default credential chain                                                                                                         |
| `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`, `AZURE_API_KEY`, `AZURE_API_VERSION`                  | Azure OpenAI (`azure/...`). Without a key, Microsoft Entra ID, in an image built with `--build-arg AZURE_IDENTITY=true`                                                                                |
| `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`                                                | Vertex AI (`vertex/...`, `vertex-anthropic/...`), with Google application default credentials                                                                                                          |
| `MODEL_GATEWAYS`                                                                                 | A list of OpenAI-compatible gateways, each its own provider prefix; `model_gateways` in the file                                                                                                       |
| `MODEL_ALIASES`                                                                                  | A map from one model reference to another. A trailing `*` on both sides covers every model of a provider; `model_aliases` in the file                                                                  |
| `DECLARED_MODELS`                                                                                | The models `list_models` shows for a provider that does not list its own, and for a gateway whose list cannot be read, by provider prefix; `declared_models` in the file                               |
| `ALLOWED_MODELS`                                                                                 | The only model references a definition may give, by name or through an alias, and that `list_models` shows; every model when not set; `allowed_models` in the file                                     |
| `NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`                           | Node's own switches for an outbound proxy and a private certificate authority                                                                                                                          |
| `REASONING_MAX_INPUT_TOKENS`                                                                     | The most input tokens the model calls of one run of a reasoning function may add up to, from 10,000 to 9,999,999, 2,000,000 unless set. Past it, the model replies from what it has, without its tools |

### Workflows

[Workflow storage and failover](workflows.md#starting-stopping-and-restarting) sets out how the server uses these.

| Variable                  | Default | Purpose                                                                                               |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `WORKFLOW_MAX_DURATION`   | `P30D`  | The most a run may last, an ISO 8601 duration from `PT2H` to `P365D`                                  |
| `WORKFLOW_NESTED_RUNS`    | `32`    | How many calls the server runs at once, from 1 to 1000, shared by every org                           |
| `WORKFLOW_MAX_OPEN_CALLS` | `1000`  | How many calls may wait under one run at the top of a tree, from 1 to 9999                            |
| `WORKFLOW_SWEEP_INTERVAL` | `PT1S`  | How often the server checks its waiting runs (a sweep), an ISO 8601 duration from `PT0.01S` to `PT1M` |

### Telemetry

`OTEL_EXPORTER_OTLP_ENDPOINT` turns telemetry on, and `TELEMETRY_CONTENT=true` records content. [Send telemetry](telemetry.md#settings) lists these and the other `OTEL_` settings the server reads. Each is read from the environment only.

### Computation and recall functions

Each run of a computation function, and each run and view of a recall function, runs in a worker thread the server keeps between runs.

- The server never keeps more workers alive than `COMPUTATION_WORKERS`.
- It folds the views of recall functions in at most half of the workers at once, and at least one.
- It ends a worker after a run that ran past its time, used too much memory, was cancelled or broke.
- It also ends a worker after its thousandth run, and after a minute without one.
- A worker has a stack of 64 MiB and is stopped when its heap grows past 256 MiB. [Plan memory](production.md#plan-memory) sizes them.

| Variable                   | Default | Purpose                                                                                                                                                      |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COMPUTATION_WORKERS`      | `4`     | The most worker threads the server keeps, and so the most runs it takes at once, from 1 to 64. A run that finds none free within 10 seconds is `unavailable` |
| `RECALL_MAX_FUNCTIONS`     | `32`    | How many active recall functions a playbook may keep, from 1 to 1000. Lowering it below what a playbook already keeps refuses only that playbook's saves     |
| `RECALL_MAX_REBUILDS`      | `4`     | How many views of one playbook are built at once, from 1 to 64. The others wait in the order they were saved                                                 |
| `RECALL_PLAYBOOKS_AT_ONCE` | `4`     | How many playbooks the server folds at once, from 1 to 64                                                                                                    |

### Interaction functions

An interaction function needs nothing configured beyond its [tool server](#tool-servers) in `tool_servers`. It does one of these:

- calls the tool it names under `call`, and returns its result;
- sends its request through the tool it names under `deliver`;
- leaves its request in the playbook's inbox.

It may also read the replies to what it sent through another tool of that server.

- The entry's `allowed` names the tools its functions may use. It is checked again at every call, every attempt and every read.
- The entry's `record_content`, on unless the entry turns it off, keeps what they send and what the tool returns.

| Variable                    | Default | Purpose                                                                                                                               |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `INTERACTION_OPEN_REQUESTS` | `10000` | The most requests a playbook may have open at once, from 1 to 1,000,000. A run past it is `unavailable` with the kind `requests_full` |

### Prediction functions

A prediction function's content is kept by the playbook: its uploaded datasets, the rows and the brief of each build, and the model file each version holds. That content is in the ledger's database or, with `CONTENT_STORE_URL`, in the object store, where a build's candidates are also staged until the build ends.

Its model processes load models and read a build's rows from files the server keeps on its own disk. The server writes a file again from the playbook's content whenever one is missing, so the folder needs no volume and loses nothing when it is emptied.

Each setting is read with its range and logged at start. A value outside its range stops the server at start, naming the setting. [Plan memory](production.md#plan-memory) sets out how much the processes take.

| Variable                    | Default                 | Purpose                                                                                                                                                                                           |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PREDICTION_MAX_FUNCTIONS`  | `32`                    | The most active prediction functions a playbook may keep, from 1 to 1,000. A save past it is refused                                                                                              |
| `PREDICTION_PROCESSES`      | `4`                     | The most model processes that run at once, from 2 to 64                                                                                                                                           |
| `PREDICTION_PROCESS_MEMORY` | `1280`                  | The data each model process may reserve, in MiB, from 768 to 16,384. A process that reaches it is ended, and its job ends out of memory                                                           |
| `PREDICTION_BUILDS_AT_ONCE` | `2`                     | The most builds the server scores at once, from 1 to 63, and below `PREDICTION_PROCESSES` so that a question always finds a process. A build past it is `unavailable` with the kind `builds_full` |
| `PREDICTION_BUILDS_PER_DAY` | `4`                     | The most builds a prediction function may ask in the trailing 24 hours, from 1 to 100. A build past it is `unavailable` with the kind `builds_full` and the `because` field `builds_of_the_day`   |
| `PREDICTION_CACHE_DIR`      | `/var/tmp/auto-runtime` | The absolute path of the folder the model files are kept in                                                                                                                                       |

The folder of `PREDICTION_CACHE_DIR` follows these rules:

- At start, the server creates the folder when it is missing, readable only by its own user, and does the same for each folder within it.
- It refuses to start, naming the setting, when the folder cannot be made, belongs to another user, or other users may write to it. A folder another user may write to would let that user change a model before it is loaded.
- The files found in the folder are read again when a prediction first uses them, and kept only when their bytes match the digest in their name.
- Each server keeps at most 1 GiB of model files and 1 GiB of rows, by its own count. Give two servers on one machine a folder each.

## Usage ping {#usage-ping}

Each time Auto starts, it sends one short message, the usage ping, so that the people who make Auto can count how many copies run and on what. The message is anonymous. It goes to `https://get.on.auto/runtime/start`, a service that [Scarf](https://scarf.sh) runs for Auto, and it holds these facts and nothing else:

| Field          | What it holds                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `version`      | The release of Auto, such as `0.13.0`                                                                      |
| `platform`     | The operating system, such as `linux` or `darwin` (macOS)                                                  |
| `arch`         | The kind of processor, such as `x64` or `arm64`                                                            |
| `node`         | The version of Node.js that runs Auto                                                                      |
| `distribution` | How Auto was installed: `npx` for the npm package, `docker` for the image, `source` for a copy of the code |
| `install`      | A random id that Auto makes the first time it starts, so that a copy started many times counts once        |

What it never sends:

- your playbooks, definitions, runs or anything they hold;
- prompts, model answers, or anything about the models you use;
- API keys, passwords or other secrets;
- your settings, names, email addresses or file paths.

Like any request on the internet, the message comes from an address. Scarf uses that address to look up the company it belongs to, and does not store the address.

Auto keeps the install id in a file named `install-id`, beside the ledger file, as it keeps `secrets.key`: `~/.auto-runtime/install-id` with `npx`, and on the `/data` volume in the image. Where the ledger is in PostgreSQL, the file is in `~/.auto-runtime` in the home folder of the user that runs Auto. Delete the file and Auto makes a new id at its next start. Where Auto cannot write the file, it sends the message without an id.

The first time Auto makes the id, it says so in one line when it is ready, with how to turn the ping off. While the ping is on, the links to Studio in that ready message and on the page at the runtime's root carry the id, and say which of the two they came from, so that visits to Studio from one copy count as one.

The ping never holds up a start or a stop: Auto gives up on it after 3 seconds, or as soon as it stops, and a ping that fails changes nothing and is not logged. Pulls of the image through `docker.on.auto`, as in [Run with Docker](docker.md#the-image), are counted by Scarf too.

### Turn the usage ping off {#turn-the-usage-ping-off}

Any one of these turns it off. Auto then sends nothing, makes no install id, and puts none in its links to Studio:

- `DO_NOT_TRACK=1`, the setting many tools read to stop sending usage data. Any value other than empty, `0` or `false` counts;
- `SCARF_NO_ANALYTICS=true`;
- `USAGE_PING=false`, or `usage_ping: false` in the configuration file.

Put the line where Auto reads its settings: in `~/.auto-runtime/.env` for the Auto your agent starts, in the `.env` of the folder you start `npx @on.auto/runtime` in, or in `auto-runtime.env` for a container. Then restart Auto.

`pnpm dev`, which runs Auto from a copy of its code and starts it again at every save, always turns the ping off.

## Tool servers

A tool server gives functions tools to call. It comes from one of two places: an entry under `tool_servers` in the configuration file, which this section describes, or a [connection](#connections) a person added to an org. Add an entry under `tool_servers`; `TOOL_SERVERS`, the same list as JSON, wins over it. [Add a tool server](tool-servers.md) walks through adding one and checking it.

- A reasoning function that lists `tools` calls the tools of these servers.
- An interaction function calls the tool it names in `call`, or sends its request through the tool it names in `deliver`.
- The key of an entry is the name a function writes in `server/tool`. Nothing in a function says which kind of server it names.

Each entry is one of three types. When `type` is left out, it is taken from the field that names the server:

| Type      | Named by   | What it is                                                                                                                                           |
| --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp`     | `url`      | A remote MCP server, spoken to over Streamable HTTP                                                                                                  |
| `stdio`   | `command`  | An MCP server the runtime runs as a process                                                                                                          |
| `openapi` | `document` | An HTTP API described by an OpenAPI document, 3.0 or 3.1, read once, when a request first needs the tool servers. Each of its operations is one tool |

```yaml
tool_servers:
  graph:
    url: https://gateway.example.com/mcp
    headers:
      Authorization: Bearer ${GRAPH_API_KEY}
    org: acme
    playbooks: [sales, support]
    allowed: [search, introspect, validate, dry_run, execute]
  notes:
    command: /usr/local/bin/notes-mcp-server
    args: [--read-only]
    env:
      PATH: /usr/local/bin:/usr/bin
      NOTES_API_KEY: ${NOTES_API_KEY}
    org: acme
  billing:
    document: https://billing.example.com/openapi.json
    base_url: https://billing.example.com/v2
    security:
      apiKeyAuth: ${BILLING_API_KEY} # the scheme the document declares under components.securitySchemes
    headers:
      X-Tenant: acme-eu # outside the document's schemes
    org: [acme, globex]
    allowed: [listInvoices, getInvoice]
```

### Fields of an entry

| Field            | For              | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`           | every type       | `mcp`, `stdio` or `openapi`. Taken from `url`, `command` or `document` when left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `url`            | `mcp`            | The server, spoken to over Streamable HTTP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `headers`        | `mcp`, `openapi` | Headers sent with every request. For an `mcp` server, its credential. For an `openapi` server, only what its document's security schemes do not place, such as a tenant. The value of a reference is a secret; a value written out is not                                                                                                                                                                                                                                                                                                                                                                                            |
| `auth`           | `mcp`, `openapi` | OAuth client credentials instead of a header: `issuer`, `client_id`, `client_secret` or `private_key` with `algorithm`, and `scope`. For an `openapi` server, what satisfies the document's `oauth2` and `openIdConnect` schemes; refused when it declares neither. See [Sign in to a server with OAuth](#sign-in-to-a-server-with-oauth)                                                                                                                                                                                                                                                                                            |
| `command`        | `stdio`          | An installed, pinned command, started when a run or a listing first needs it and stopped with the server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `args`           | `stdio`          | Its arguments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `env`            | `stdio`          | Its whole environment. The value of a reference is a secret; a value written out is not. It inherits nothing else from the server, so give `PATH` or an absolute command                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `document`       | `openapi`        | The OpenAPI document of the API, 3.0 or 3.1, in JSON or YAML: an https URL, an http URL on a loopback address, or a path relative to the directory of this file that stays inside it                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `base_url`       | `openapi`        | The URL the calls go to, in place of the first server the document names. Required when the document names none or names it relative to a file. An https URL, or an http URL on a loopback address                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `query_params`   | `openapi`        | Query parameters sent with every call that the document's security schemes do not place, such as a tenant. The value of a reference is a secret; a value written out is not                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `security`       | `openapi`        | The credential for each of the document's security schemes that the entry gives, by the scheme's name, placed where the scheme says. Always a reference, such as `${BILLING_API_KEY}` or `ada:${BILLING_PASSWORD}`. See [The credentials of an HTTP API](#the-credentials-of-an-http-api)                                                                                                                                                                                                                                                                                                                                            |
| `org`            | every type       | Required. The org whose functions may use the server, a list of orgs, or `*` for every org of the runtime. One entry serves each org under one name, with one credential and one connection, and each org sees the same tools                                                                                                                                                                                                                                                                                                                                                                                                        |
| `playbooks`      | every type       | The playbooks that may use it within each org it names, by id, the same list in each. Every playbook of each org when left out. Refused beside `*`, since a playbook id belongs to one org                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `allowed`        | every type       | The tools of the server that a function may name and that a call made by hand with `execute` may call, each named as the server lists it, without the server's name and without `*`. Every tool of the server when left out                                                                                                                                                                                                                                                                                                                                                                                                          |
| `record_content` | every type       | Whether the arguments and results of calls are kept whole, scrubbed of secrets, in the playbook's ledger, where anyone who may read the playbook reads them. `true` when left out; `false` keeps their sizes alone                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `request_id`     | every type       | The response header, or for an MCP server the key of a result's metadata, in which the server returns its own id of a request, recorded with each call                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `provider`       | `mcp`, `openapi` | A provider Auto knows, by its name, in place of every field of the server: it gives the type, the address, the headers, `request_id` and where the credential goes, and the entry gives `org`, `playbooks`, `allowed` and `record_content`. See [Name a provider](tool-servers.md#name-a-provider)                                                                                                                                                                                                                                                                                                                                   |
| `placeholders`   | `mcp`, `openapi` | With `provider`, the value of each placeholder it asks for, by name, written out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `credential`     | `mcp`, `openapi` | With `provider`, its credential: a reference alone, such as `${GITHUB_TOKEN}`, for a `secret`; for `client_credentials`, `client_id` written out with `client_secret`, or with `private_key` and its `algorithm`, each key a reference; nothing for `none`. The entry takes the provider's first way but `authorization`, a consent a person gives on Studio's page, which this file cannot give, and `kind` names another. An entry that names `kind: authorization` stops Auto at start, at `kind`, and one that names a provider whose only way it is stops it at `credential`: let people connect that provider on Studio's page |

Every request the server makes to an `mcp` or `openapi` server carries `User-Agent: auto-runtime/<version>`, the name of the runtime's command with the version of the release that runs. That covers the read of a document, every call, and the requests for a token and for an authorization server's metadata, for an entry of this file and for a connection alike. A `User-Agent` in an entry's `headers` is sent on that server's calls instead; the read of its document and the requests for its tokens still carry the runtime's.

### Keep secrets out of the file

Only `headers`, `query_params`, `security`, `env` and `auth` may hold a reference, and, beside `provider`, `credential`. A reference in `url`, `command`, `args`, `document` or `base_url` stops the server at start: an argument shows in the machine's list of processes, and the URL of a server or of a document is no place for a credential. A reference in `placeholders` stops it too, at the value.

A secret is one of these, and nothing else:

- a value a `${NAME}` reference takes from the environment;
- a credential of an `auth` block;
- a token minted from one.

A value of `security`, which always holds a reference, is a secret as a whole, and so is the value of its reference. A header whose reference takes a scheme and a credential, such as `Authorization: ${GRAPH_HEADER}` with `GRAPH_HEADER` set to `Bearer <key>`, is a secret whole, and so is the credential after its scheme, `<key>`, so it is scrubbed where a server echoes the key alone. Each secret counts once, however many places hold it. A header written out, such as `X-Region: production-eu`, is not a secret, so it is never scrubbed.

The server scrubs every secret from every message, event and result:

- as written;
- inside JSON, where a quote, a backslash or a line break in it is escaped;
- as an address carries it, form-encoded in a query and percent-encoded in a path;
- in base64, as a Basic credential carries it.

There is one exception: a value shorter than 8 characters is not scrubbed, since scrubbing it would erase ordinary words. Give a server a key at least that long.

One set of secrets serves all the tool servers, for runs and for calls made by hand with `execute` alike, so a token minted for a run is scrubbed from a call made by hand too. A minted token is scrubbed until the token after the one that replaces it is minted, since a call in flight as a token is renewed may still carry the one before it in a result recorded a moment later.

### Run a server as a process

- Write `command` as an installed program. Never use a package downloaded at start, such as `npx -y`, which would run whatever that package is the day the process starts. The MCP entry of the [quick start](../get-started/local.md#connect-your-agent) is the one exception: it is Auto Runtime itself, pinned to one release, and you choose when to move it to another.
- The process runs under the server's user.
- `env` is the process's whole environment, so give it `PATH` or write `command` as an absolute path.

### Sign in to a server with OAuth

An `auth` block gives an `mcp` or `openapi` server OAuth client credentials instead of a header.

- The server mints one token from the client credentials for each server, shared by every run and listing that uses the server at the same time.
- It renews the token before it expires, and mints once more when the server responds with `401`.
- It sends the credentials only to an authorization server whose metadata names the `issuer`.
- An `mcp` server's authorization server is found through the server's own protected-resource metadata.
- An `openapi` server's authorization server is the `issuer` itself. Its metadata is read by OAuth authorization server metadata or OpenID Connect discovery, since an HTTP API publishes none of its own.

### The credentials of an HTTP API

Give an HTTP API's credential under `security`, by the name of the security scheme its document declares. The server places it as the scheme says.

An OpenAPI document declares its security schemes under `components.securitySchemes`, each saying where its credential goes. Each operation names the schemes it requires under `security`, or takes the document's own `security` when it names none.

| Scheme                          | What `security` gives             | What a call sends                       |
| ------------------------------- | --------------------------------- | --------------------------------------- |
| `apiKey` in a header            | the key                           | the scheme's header                     |
| `apiKey` in the query           | the key                           | the scheme's query parameter            |
| `http` with the scheme `bearer` | the token                         | `Authorization: Bearer <token>`         |
| `http` with the scheme `basic`  | `user:password`                   | `Authorization: Basic` and their base64 |
| `oauth2` or `openIdConnect`     | nothing: the entry's `auth` block | the token the block mints, as a bearer  |

Use `security` for what the document's schemes describe, and `headers` and `query_params` for what they do not, such as a tenant.

Which credentials a call sends:

- A requirement is a list of alternatives. Each alternative is a set of schemes that must all be given.
- An operation is offered as a tool when the entry gives one of its alternatives.
- A call sends the credentials of the first alternative the entry gives, in the document's order, and no other. Where the operation needs a header that the entry's `headers` do not name, it sends the first alternative the entry gives whose `apiKey` schemes place that header instead.
- An operation whose requirement is empty, or of a document that declares none, sends none.
- An operation for which the entry gives none of the alternatives is not offered as a tool. When it reads the document, the server logs a warning that names the schemes it needs.
- The scopes an `oauth2` requirement names are the operation's. The `auth` block asks for its own `scope`, so set it to cover what the operations require.

The server refuses the documents as it reads them, naming the entry, when:

- a name under `security` is not a scheme the document declares;
- a name under `security` is an `apiKey` the document places in a cookie;
- a name under `security` is an `http` scheme other than `bearer` and `basic`;
- a name under `security` is a `mutualTLS` scheme;
- a name under `security` is an `oauth2` or `openIdConnect` scheme with a value, since the credential for those schemes comes from the `auth` block;
- a `basic` value is not `user:password`;
- `headers` or `query_params` holds a header or query parameter that a scheme given under `security` also places;
- an entry has an `auth` block, and its document declares no `oauth2` or `openIdConnect` scheme.

### How an HTTP API becomes tools

The server reads each `openapi` entry's document the first time a request needs the tool servers, such as a `search`, a call made with `execute`, a run of a function that calls tools, or a request of an interaction function that comes due: at most 4 MiB and 500 operations, within 10 seconds. It refuses the documents, naming the entry, when:

- it cannot read the document;
- the document's URL responds with a redirect, which the server does not follow;
- the document is Swagger 2.0, or of another version than 3.0 or 3.1;
- a part it reads is not of the shape the specification gives it (the message names the place in the document);
- two operations would share a tool name;
- a path does not begin with `/`, which would join the host or the port of `base_url`;
- a path holds a `.` or `..` segment, a `?` or a `#`;
- its tools take more than 16 MiB when listed;
- a reference does not resolve inside the document. This includes a reference to an http, https or file address, which the server never fetches;
- its calls would have nowhere to go: no `base_url` and no server, or a server that is neither https nor on a loopback address.

A refusal fails the request that needed the tool servers, with the incident of an unexpected error, and the server logs the incident with the refusal, naming the entry and the place. The next request reads the documents again, so a document put right while the server runs is read without a restart.

Trailing slashes on `base_url` or on the server's URL are dropped.

Each operation becomes one tool:

- Its name is the `operationId`, with any character a tool name cannot hold as `_`. Without one, it is the method and the path in lower case, such as `get_invoices_id` for `GET /invoices/{id}`.
- Its description is the operation's `summary` and `description`.
- Its input is one object: each path and query parameter by its name, and `body` for a JSON request body, each required when the document says so. The schemas of `components` they refer to are held inside it, so a function's model reads one schema whole.
- `GET` and `HEAD` are read-only, `DELETE` destructive, and `GET`, `HEAD`, `PUT` and `DELETE` idempotent. So `allowed`, `search` and a run's read-only calls read an API's tools as they read an MCP server's.

Some operations are not offered as tools. When it reads the document, the server logs a warning for each operation it leaves out, naming the entry and the reason. It leaves out an operation that:

- needs a cookie;
- needs a header that the entry's `headers` do not name and its security scheme does not place. The warning says that `headers` can give it, or, for a header the server sets itself such as `Host`, that it does. A header parameter named `Accept`, `Content-Type` or `Authorization` is ignored, as the OpenAPI specification says;
- takes an object in its query;
- takes a body that is not JSON;
- is a `TRACE`, or a `GET` or `HEAD` that takes a body;
- has a path parameter of a `style` other than `simple`;
- has a query parameter of a `style` other than `form`, such as `spaceDelimited`, `pipeDelimited` or `deepObject`;
- has an input schema of more than 64 KiB.

An operation that needs a header the entry's `headers` name, in any case, is offered, such as one that needs an account id on every call. The header is not an input of the tool: every call sends the entry's value. So is an operation that needs the header of an `apiKey` scheme its call sends, which the call fills with the credential the entry gives under `security`.

A call:

- fills the path and the query, with an array sent as repeated keys, or as one key of comma-joined items when the document writes the parameter with `explode: false`;
- sends a path argument encoded as one segment, a `/` it holds as `%2F`, and refuses one that is empty or is `.` or `..`;
- sends nothing to an address that would leave the origin or the path of `base_url`;
- sends the body as JSON, with the entry's headers and query parameters.

The response is read as the result of an MCP server's call is read, within the same bounds:

| The API responds with               | The call's result                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| JSON                                | The tool's structured content, and its text                                                                        |
| Text                                | Text                                                                                                               |
| Any other media type                | Noted, and not shown                                                                                               |
| `401`                               | A key the server refused                                                                                           |
| `429`                               | Waits out a `Retry-After` that fits                                                                                |
| `5xx`                               | A failing server                                                                                                   |
| A redirect                          | An error result with its status. It is not followed, so the entry's headers and token go to no address but its own |
| Any other response, including `404` | An error result carrying the API's response                                                                        |

Listing an HTTP API's tools asks the API nothing: the document is the list.

### Limit the tools a function may use

`allowed` narrows what a function may name, as `allowed_models` narrows the models. A server's own policy remains the hard boundary.

- A function's `server/*` offers exactly the tools its server's entry allows.
- `allowed` is the one list of a server's tools. The five operations over the playbook's tool servers, `search`, `introspect`, `validate`, `dry_run` and `execute`, show and call the tools it allows and no other.

### Try the tools by hand

An agent or a person can look at a server's tools, and call one, before a function names it.

- `search` shows anyone who may read a playbook the entries that serve it, with the tools that each entry lets functions name. At the org level, a caller who may read every playbook of the org (with `org:read` or `playbook:read`) sees every entry that serves the org, whether the entry names the org in `org` or uses `*`. Each comes with its `playbooks` (`["*"]` when they are left out).
- `search` and `dry_run` say whether the server marks a tool read-only (`readOnlyHint`).
- `search` and `introspect` add no header, environment value, URL, command or credential of their own. What a server writes is passed on with the secrets above scrubbed out, except values shorter than 8 characters.
- `execute` calls one tool as a run would, under the entry's credential, which is the playbook's. So it needs `playbook:write` whatever the tool does, and it is live.
- While a tool server is configured, `execute` is marked destructive, so a client that honours the MCP hints asks the person before a call.
- Every call made with `execute` is recorded in the playbook's history under the caller, with its content where the entry keeps it.

[Tool servers](../reference/http.md#tool-servers) in the HTTP reference sets out the routes, fields and permissions of the five tools.

### What the server checks at start

The server checks every entry at start. It stops at any of these, naming the setting and the place but never a value:

- an entry with none of `url`, `command` and `document`, or with more than one;
- the fields of another type;
- a name that is not 1 to 32 lowercase letters, digits and hyphens starting with a letter;
- a name with two hyphens together or one at the end, which would blur where the server's name ends in the `server__tool` a model sees;
- the name of a model provider or gateway;
- a missing `org`;
- a credential written out instead of referenced. This includes a password in a `url`, and a user, a query value or the part of an argument after its `=` that looks like a credential, such as `--key=sk-live-...`. The value is judged, never the name it is given;
- a reference outside `headers`, `query_params`, `security`, `env` and `auth`;
- a value of `security` written out instead of referenced;
- an `Authorization` header beside an `auth` block;
- a header the runtime sets itself;
- an `issuer`, a `base_url` or a `document` URL that is neither https nor on a loopback address;
- a `base_url`, or a first server of a document, with a query or a fragment;
- a `document` path that leaves the directory of this file;
- in `allowed`, an empty list, a name listed twice, a `*`, or a name that is not a tool name of 1 to 128 letters, digits, underscores, hyphens and dots (such as `graph/search`);
- beside `provider`, a field of the server, a provider Auto does not know, a placeholder it does not ask for, one it asks for that is left out or a value its pattern does not take, a way it does not offer or its way `authorization`, which a person gives on Studio's page alone, the fields of a credential that way does not take, and a `credential` that holds anything but a reference where a key goes; and `placeholders` or `credential` without `provider`.

An unknown key in an entry is refused, like any other unknown key.

The server does not connect to an MCP server or start a process until a run needs one, or until `search`, `introspect`, `validate`, `dry_run` or `execute` asks it for its tools. The servers' messages, a process's output on stderr and every failed call go to the server's log, scrubbed of the entry's secrets.

## Connections

A connection is a tool server that a person adds to an org through their agent, which every playbook of the org may use, or the playbooks it names; a function names it by `name/tool` as it names an entry of `tool_servers`, and calls it in the same way. [Let people add connections](connections.md) sets out how a person adds and approves one, and what a connection that is not ready answers. The `connections` section of the configuration file says what people may add; `CONNECTIONS`, the same object as JSON, wins over it. Every rule has a default, so leaving the section out lets people add any connection but one of the credential `reference`, which names no variable until `variables` lists it, and one that reaches an address inside your network.

```yaml
connections:
  people_may_add: true
  allowed_hosts: ['*.example.com', 'crm.example.com']
  credential_kinds: [none, reference, secret, client_credentials, authorization]
  variables: [CRM_API_KEY]
```

| Key                  | Default                                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `people_may_add`     | `true`                                   | `false` refuses every new connection, and the runtime uses none already added, though `list_connections` still lists them as they are                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `allowed_hosts`      | every host but those inside your network | The hosts a connection may reach, each a host or `*.` and a host for every host under it; the host of an `mcp` connection's `url`, of an `openapi` connection's `document` and `base_url`, of the `issuer` of client credentials, and of the issuer and the endpoints of a provider's way of consent. Left out, a connection may reach every host that is not inside your network: an address that is loopback, private, link-local or of a cloud metadata service, such as `localhost`, `10.0.0.5` or `169.254.169.254`, or a name that resolves to one, is refused. Only an address this key names by itself, such as `10.0.0.5` or `localhost`, may be reached, and loopback needs no naming in local mode, as [Addresses inside your network](connections.md#addresses-inside-your-network) sets out |
| `registered_clients` | none                                     | The clients you registered at authorization servers, each with its `issuers`, its `client_id`, and its `client_secret`, or its `private_key` with its `algorithm`, as a reference, or neither for a public client, and its `scopes`, the scopes it may ask, which each client names where several serve one issuer, as [Register your clients](connections.md#register-your-clients) sets out                                                                                                                                                                                                                                                                                                                                                                                                            |
| `auto_clients`       | `true` in local mode, `false` otherwise  | Whether a provider whose way takes a registered client takes Auto's client too, through Auto's consent service, where `registered_clients` lists none at its issuer that covers the scope its way asks; `AUTO_CLIENTS` wins over it. See [Consent through Auto](connections.md#consent-through-auto)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `credential_kinds`   | every kind                               | The kinds of credential a connection may take: `none`, `reference`, `secret`, `client_credentials` and `authorization`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `variables`          | none                                     | The environment variables a `reference` credential may name, such as `CRM_API_KEY`. None of them may be a variable the runtime reads for itself: any variable this page lists, such as `SECRETS_KEY`, `API_KEYS`, `PUBLIC_URL` or a provider's key; a credential the cloud libraries read, such as `AWS_SECRET_ACCESS_KEY`, `AZURE_CLIENT_SECRET`, `AZURE_CLIENT_CERTIFICATE_PASSWORD` or `AZURE_PASSWORD`; a gateway's `api_key_env`; or a variable that a reference of this file, of `TOOL_SERVERS` or of `CONNECTIONS` names                                                                                                                                                                                                                                                                          |
| `providers`          | none                                     | Providers of your own beside those the runtime ships, each an entry of a provider, which a person connects by its name and an entry of `tool_servers` may name; one named as a shipped provider takes its place. See [Add providers of your own](connections.md#add-providers-of-your-own)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

`add_connection` refuses with `403` a connection one of these rules does not take, with the sentence of the rule, and with `409` a connection named as an entry of `tool_servers`. A key the section does not know, a pattern that is not a host, a kind there is not, a variable the runtime reads for itself and an entry of `providers` the runtime cannot take stop the server at start, naming the line.

A registered client's `client_secret` and `private_key` are the only keys of a client that hold a reference, and the only ones the server substitutes from the environment, at start, whether the section comes from this file or from `CONNECTIONS`; a provider under `providers` holds one in a header or a query value alone, for a value of your own registration at the vendor, which the server substitutes when it sends that provider's server a request. A reference anywhere else in the section, in a host, a variable, an issuer, a `client_id`, an `algorithm` or a scope, stops the server at start; in a key that takes only some values, such as `credential_kinds` or `people_may_add`, it is refused as a value the key does not take. The section keeps the references of `registered_clients` and of `providers` as `tool_servers` keeps its own, so no secret of a client and no value of a provider is written into `CONNECTIONS`. The variables those references name are among the variables the runtime reads for itself, so `variables` may not list them.

A registered client may name `scopes`, the scopes it may ask at its issuers, each written as a provider's way writes it. A way takes the first client at its issuer whose `scopes` cover the scope the way asks: every scope of the way's `scope`, split on spaces, is one the client names, compared exactly as written. A client that names no `scopes` covers every way, so a client alone at its issuers needs none. Where several clients serve one issuer, each names its `scopes`, and a way none of them covers is one you set up first, as a way whose issuer no client names is.

The server stops at start, naming the line or the place and never a value, at a registered client:

- with a client secret or a private key written out instead of referenced;
- whose reference names a variable that is not set, or whose value comes to nothing, as `${NAME:-}` does while `NAME` is not set;
- with an empty `client_id` or `algorithm`;
- without an issuer;
- with an issuer that is neither an https URL nor an http URL on a loopback address;
- without `scopes`, at an issuer another client names too, the same but for a trailing slash, since a client that names none would serve every way there that no client before it covers, and a client after it never;
- with `scopes` that lists no scope, or lists an empty one;
- with both a `client_secret` and a `private_key`, since a client authenticates with one;
- with a `private_key` and no `algorithm`, or an `algorithm` and no `private_key`;
- with a `token_endpoint_auth_method` its kind does not authenticate with: `client_secret_basic` or `client_secret_post` for a client with a secret, `private_key_jwt` for one with a key, and `none` for a public client.

The rules are read at start, and checked again when a connection is first used after it, so a rule you change reaches a running server when it starts again: a connection a rule no longer takes is refused with the rule's sentence, which `search` shows, and with `people_may_add: false` the runtime uses no connection already added, in the sentence `This runtime uses no connection: its operator sets up its tool servers itself`. `allowed_hosts` holds every request a connection makes, not only those to the addresses it names: the server an `openapi` connection's document names, where `base_url` is left out, is checked once the document is read, and every request is checked before it is sent, those to an authorization server and those a redirect leads to among them. A call of an HTTP API follows no redirect, and the MCP client follows one only within the origin it asked. The value of each variable `variables` lists is read at start too, so a variable you set reaches a running server when it starts again.
