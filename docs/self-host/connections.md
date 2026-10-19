# Let people add connections

A connection is a tool server that a person adds to an org through their agent, rather than one you set up in Auto's settings file. The org owns it, and every playbook of the org may use it, or only the playbooks it names. The person approves it, and gives its credential where it takes one, on a page of Studio. The agent never sees the credential.

This page is for whoever runs Auto. It says how a connection is added, the providers a person may connect by name, what a connection holds, how a function uses it, the rules you set for it in `auto-runtime.yaml`, and the clients you register there. A tool server you set up yourself is still added as [Add a tool server](tool-servers.md) shows.

## How a person adds a connection

1. The person asks their agent to connect a service, such as their code host. Where Auto knows the service as a [provider](#the-providers-auto-ships), the agent calls `add_connection` with the provider's name and the values its placeholders take, such as a site's subdomain. Otherwise it gives the server by hand: its address, its options and how it is credentialled. Either way, never the credential itself.
2. Auto keeps the connection, `pending`, and answers with a link to Studio's page, `https://studio.on.auto/connect`, which lasts ten minutes. An agent whose client opens links asks the person to open it; any other agent gives the person the link from its answer.
3. On the page, signed in, the person approves the connection. Where it takes a secret or client credentials, the person types the credential there, with the client id where the agent left it out, and giving it approves the connection. The connection is then `connected`.

On a runtime that signs people in, only the person who added a connection may approve it, signed in as themselves. In [local mode](security.md#local-mode), the link alone binds: whoever holds it within its ten minutes approves the connection. A link is gone after its ten minutes, and nothing gives a pending connection another, so the way on is to remove the connection and add it again.

`list_connections` shows the connections of the org and whether each is `pending`, `connected`, `broken` or `removed`, which is how an agent sees whether the person approved one; `get_connection`, served over HTTP alone, reads one by its id. `remove_connection` removes one for good: no playbook may use it any more, and Auto forgets its credential. An org holds at most 50 connections that are not removed; `add_connection` refuses another with `409`, `conflict` of the kind `connections_full`, until one is removed. The [MCP reference](../reference/mcp.md#connections) describes the three tools, and the [HTTP reference](../reference/http.md#connections) the routes, those of Studio's page among them.

## The providers Auto ships

A provider is a service Auto knows by its name: its server, an MCP server or an HTTP API described by an OpenAPI document, how a credential reaches it and the values that differ from one connection to the next, its placeholders. A person connects one by its name, and Auto resolves it into the connection a server given by hand would be, so every rule below applies to it alike. `list_providers` lists the providers your rules could allow, with the ways a person may connect each, for Studio's page to show. This version ships:

| Provider    | What a function may do                                                                                      | The server                                                 | How the person connects it                              |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| `github`    | Read repositories, files and commits, and read, open and update issues and pull requests                    | GitHub's MCP server, `api.githubcopilot.com`               | A fine-grained personal access token                    |
| `profound`  | Read how a brand appears in AI answers, and the traffic AI agents send to a site                            | Profound's MCP server, `mcp.tryprofound.com`               | A Profound API key                                      |
| `slack-api` | Read channels, history, threads and people, post and update messages and add reactions as a Slack app's bot | The Slack Web API, `slack.com`, from a document Auto ships | The bot token of a Slack app installed in the workspace |

Auto reads the providers when it starts, and nothing is fetched from anywhere to list them. A provider's hosts pass your `allowed_hosts` as any connection's do, and one your rules could not allow is not listed. A connection a person makes from a provider keeps its provider's name and the values given in its record, beside the entry it resolved to, so a later version that changes the provider changes no connection there is.

None of the providers this version ships needs a value of yours. A provider whose entry sends a value of your own registration at the vendor, such as a developer token, names it as an environment variable: set it in Auto's environment and start Auto again, and Auto sends it to that provider's server alone, in the header or the query parameter the provider names, and scrubs it from what it records. Until it is set, `list_providers` shows the provider's ways as ones you set up first, `search` leaves the provider out of the providers it lists to an agent, and `add_connection` refuses it. The variable is one Auto reads for itself, so `variables` may not name it.

## How a function uses a connection

A connected connection is a tool server of its org, for every playbook of the org or the playbooks its entry names. A function names its tools as it names those of any tool server, by the connection's name and the tool, as in `crm/search` or `crm/*`, and calls them in the same way, with the same bounds and the same scrubbing of its credential from everything Auto records. `search` lists it beside the tool servers of the settings file, with `connection`, its id, and `introspect`, `dry_run` and `execute` reach it. Each call it records, a run's, one made by hand with `execute` and one an interaction function makes in a conversation, names the connection's id beside the server's name as `connection_id`, so the history stays plain once another connection takes the name.

A connection that is not ready is refused, and `search` lists it unavailable with the same words:

| The connection                                                                                                       | A function that names it is refused with | Its words say                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Nobody has approved it yet                                                                                           | `connection_pending`                     | The person who added it opens its link, or removes it and adds it again for a new link                               |
| Its credential cannot be read                                                                                        | `connection_broken`                      | Why, and that the person who added it removes it and adds it again                                                   |
| A rule of `auto-runtime.yaml` no longer takes it                                                                     | `connection_not_allowed`                 | The rule, in the sentence `add_connection` would give                                                                |
| `people_may_add` is now `false`                                                                                      | `connection_not_allowed`                 | That this runtime uses no connection, since you set up its tool servers yourself                                     |
| Its entry is no longer one Auto takes, as when a model provider you set up since has its name                        | `connection_not_allowed`                 | What `add_connection` would refuse in it                                                                             |
| Its `reference` names a variable that is not set                                                                     | `connection_not_allowed`                 | The variable, and that you set it and start Auto again                                                               |
| Its name is that of a tool server of the settings file, for any org, which a later edit added                        | `connection_not_allowed`                 | That the settings file sets up a tool server of that name, and that it is removed and added again under another name |
| Its document names a server, or a call meets a redirect or an authorization server, on a host the rules do not allow | `connection_not_allowed`                 | The rule                                                                                                             |

Each comes as `unavailable` of the kind `tool_not_offered`, before the function calls anything. A name that is neither a tool server of the settings file nor a connection of the org stays `tool_server_not_configured`.

Auto checks the rules, and checks the entry as `add_connection` checks it, when a connection is first used after Auto starts, once for each connection, and reads its credential then. A rule you change reaches a running Auto when it starts again. A connection Auto cannot read the credential of is broken for good: Auto records why, and the person removes it and adds it again, since nothing mends a broken connection. Where Auto cannot record it broken, it logs why, refuses it all the same, and reads the credential again at its next use, recording the break again.

Auto places the credential in the entry as the settings file places a reference to an environment variable, and reads the entry as it reads one of the file, with the same checks and the same secrets to scrub; the entry itself is sent as it is written, a `$` in it too. The document of an HTTP API is read when a function first uses the connection. A document that cannot be read just now, because its address does not answer in time, answers an error or answers a page that is no document, such as a proxy's error page, is read again at the next use; one refused for what it says stays refused until Auto starts again, and the person removes the connection and adds it again once the document is put right.

## Which runtimes take connections

A person approves every connection, so a connection is added by a person, and a runtime takes connections only where a person reaches it as themselves:

| Runtime                                         | Who adds a connection                                                                                                                                                                                                      | The runtime the link names     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| One that signs people in, with `PUBLIC_URL` set | A person, through an agent signed in as them. `add_connection` refuses a key with `403`, since no person would approve what it adds                                                                                        | `PUBLIC_URL`                   |
| One in [local mode](security.md#local-mode)     | The local developer                                                                                                                                                                                                        | The runtime's loopback address |
| One of `API_KEYS` alone, which signs nobody in  | Nobody: `add_connection` refuses every connection with `403`, since no person could approve it. Set `PUBLIC_URL` to sign people in, or add the server to `auto-runtime.yaml` as [Add a tool server](tool-servers.md) shows |                                |

## What a connection holds

A connection has a name, which a function will give it as a tool server's name, a type, an entry and a credential, and the provider it was made from, with the values given for its placeholders.

| Part         | What it holds                                                                                                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | 1 to 32 lowercase letters, digits and hyphens, starting with a letter. It may not be the name of a tool server of the settings file, nor of another connection of the org that is not removed                                                                        |
| `type`       | `mcp` for a remote MCP server, `openapi` for an HTTP API described by an OpenAPI document, as the `type` of an entry of the settings file says                                                                                                                       |
| `entry`      | The server without its credential: `url` for `mcp`, or `document` and `base_url` for `openapi`, with `headers`, `query_params`, `allowed`, `playbooks`, `record_content` and `request_id` as an [entry of the settings file](configuration.md#tool-servers) has them |
| `credential` | How the server is credentialled, below, never its value: one object, its `kind` and the fields that kind takes                                                                                                                                                       |
| `provider`   | The provider it was made from, or `null` for a server given by hand, and `placeholders`, the values given for that provider's placeholders                                                                                                                           |

Auto checks an entry as it checks an entry of the settings file, and refuses one that holds a value that looks like a credential, or a reference to an environment variable such as `${CRM_API_KEY}`. A connection's `url` and document are each an `https` URL, or an `http` URL on a loopback address; a document is never a file on Auto's disk.

## The kinds of credential

| Kind                 | What the person gives                                                                                                                                                                                                                                                                                       | Where the value is kept                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `none`               | Nothing; the server takes no credential                                                                                                                                                                                                                                                                     | Nowhere                                 |
| `reference`          | Nothing; `variable` names an environment variable of Auto, such as `CRM_API_KEY`, that you set and list in the rule `variables`, and `name` and `in` say where its value goes, as for a `secret`                                                                                                            | In Auto's environment, where you put it |
| `secret`             | A key or token, on Studio's page. `name` and `in` say where it goes: `in: header` and the header's name, never one Auto sets itself such as `Content-Type`, `Host` or `Mcp-Session-Id`, or for an HTTP API `in: query` and a query parameter's name, or `in: security` and a scheme of its OpenAPI document | Sealed in Auto's secret store           |
| `client_credentials` | The client secret, or a private key with its algorithm, on Studio's page, with the client id where `client_id` is left out. `issuer`, `client_id` and `scope` name the authorization server and the client                                                                                                  | Sealed in Auto's secret store           |

A `secret` or a `reference` sent in a header may name its `scheme`, such as `Bearer`: Auto writes the scheme and a space before the value, so the person pastes the token alone, the variable you set for a reference holds the token alone, and the server receives `Authorization: Bearer <token>`. Auto refuses a token pasted with the scheme before it, saying to paste the token alone.

Auto seals a secret under its secret key, `SECRETS_KEY` or the key file beside a SQLite ledger, as [the configuration reference](configuration.md#storage) sets out. No record of the org, no answer and no history holds the value, and the link's token is kept only as its SHA-256. Of a secret or a client secret of twelve characters or more, Auto also keeps its last four characters beside the sealed value in the secret store, never in the org's record, and `list_connections` and `get_connection` answer them as `credential_ends_with`, so the person can tell which key a connection holds; a private key, or a shorter value, has none. Removing a connection forgets its secret, and the ending with it.

Every value of a credential is a secret Auto scrubs from what it records and answers, in each form it may take, as it scrubs the value of a reference of the settings file. A value in a header that is a scheme and a credential, such as `Bearer <token>`, is scrubbed whole and its credential alone; where the credential names its `scheme`, the value is the token, scrubbed whole.

A secret is only as recoverable as the key it was sealed under. When the key is lost, Auto can no longer read the credentials sealed under it, so their connections are broken. Auto marks such a connection `broken` when it first needs the credential, with a sentence that says why; the person removes it and adds it again.

## Set the rules in `auto-runtime.yaml`

A `connections` section of `auto-runtime.yaml` says what people may add. Every rule has a default, so a file without the section lets people add any connection but one of the credential `reference`.

```yaml
connections:
  people_may_add: true
  allowed_hosts: ['*.example.com', 'crm.example.com']
  credential_kinds: [none, reference, secret, client_credentials]
  variables: [CRM_API_KEY]
```

| Rule               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | When left out                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `people_may_add`   | `false` refuses every new connection, and Auto uses none of those already added: `list_connections` still lists them as they are, `connected` among them, and a function that names one is refused. You set up every tool server yourself                                                                                                                                                                                                                                                                                         | `true`                                                                                                                                       |
| `allowed_hosts`    | The hosts a connection may reach. A pattern is a host, or `*.` and a host for every host under it, so `*.example.com` takes `crm.example.com` and not `example.com`. Auto checks the host of an `mcp` connection's `url`, of an `openapi` connection's `document` and `base_url`, or of the server named by a document Auto ships with a provider that gives no `base_url`, and of the `issuer` of client credentials, where the client secret or the key's assertion goes, and then every request a call makes before it is sent | Every host, addresses inside your network such as `localhost` or `10.0.0.5` among them, so set it wherever a connection must not reach those |
| `credential_kinds` | The kinds of credential a connection may take, of the four above                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Every kind                                                                                                                                   |
| `variables`        | The environment variables a `reference` may name. A reference sends the value of a variable of Auto to the server the person names, so you list each one a connection may send; Auto refuses to start on a list that names a variable it reads for itself, such as `SECRETS_KEY`, `API_KEYS` or a provider's key                                                                                                                                                                                                                  | None, so every `reference` is refused                                                                                                        |

`add_connection` refuses a connection a rule does not take with `403`, saying which rule, such as `A connection may not reach the host api.billing.example.org on this runtime, which allows *.example.com and crm.example.com`. A connection added before a rule changed is refused the same way when it is first used after Auto starts again, `connection_not_allowed` with the same sentence. A rule the file gives that Auto cannot read stops it at start, naming the line. `CONNECTIONS`, the same rules as JSON, wins over the file. The [configuration reference](configuration.md#connections) lists the section.

`allowed_hosts` holds more than the addresses a connection names: the server an HTTP API's document names, where `base_url` is left out, is checked once Auto reads the document, and every request a call makes is checked before it is sent, those to an authorization server and those a redirect leads to among them. A call of an HTTP API follows no redirect, and the MCP client follows one only within the origin it asked.

## Register your clients

A registered client is the client identity you registered with a service's authorization server: a client id with a secret, a private key, or nothing for a public client. `registered_clients`, in the `connections` section of `auto-runtime.yaml`, lists the clients you registered, one entry for each client, with the issuers it is registered at:

```yaml
connections:
  registered_clients:
    - issuers: [https://accounts.example.com]
      client_id: 1234.apps.example.com
      client_secret: ${EXAMPLE_CLIENT_SECRET}
    - issuers: ['https://login.example.net/{tenant}/v2.0', https://login.example.net/common/v2.0]
      client_id: 9f1c0d2e-example
      private_key: ${EXAMPLE_PRIVATE_KEY}
      algorithm: RS256
    - issuers: [https://public.example.org]
      client_id: auto-runtime
```

| Field                        | What it holds                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuers`                    | The issuers the client is registered at, one at least, each an `https` URL or an `http` URL on a loopback address. One written with a placeholder, such as `{tenant}`, is kept as it is written |
| `client_id`                  | The client id the service issued                                                                                                                                                                |
| `client_secret`              | The client secret, as a reference to the variable that holds it, such as `${EXAMPLE_CLIENT_SECRET}`                                                                                             |
| `private_key`                | A private key in PEM that signs the client's assertion, as a reference, with `algorithm`, such as `RS256` or `ES256`, in place of a secret                                                      |
| `token_endpoint_auth_method` | Where the service's metadata leaves the choice, how the client authenticates: `client_secret_basic` or `client_secret_post` with a secret, `private_key_jwt` with a key, `none` without either  |

A client that gives neither a secret nor a key is a public client. Each issuer belongs to one client: two clients whose issuers are the same but for a trailing slash stop Auto at start, as a secret written out instead of referenced and a variable that is not set do, and the [configuration reference](configuration.md#connections) lists every check. `client_secret` and `private_key` are the only fields that hold a reference: one anywhere else in the section, such as in an issuer or a `client_id`, stops Auto at start too. Auto keeps the references as they are written, so no secret of a client reaches `CONNECTIONS`, reads the values when it starts, and scrubs each secret and key from everything it records and answers, as it scrubs the secrets of its tool servers. The variables they name are ones Auto reads for itself, so `variables` may not name them.
