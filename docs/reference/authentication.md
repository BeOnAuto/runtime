---
description: 'The rules Auto Runtime applies to credentials: how it reads one, the tokens it issues, what a signed-in person may do and what a refused client is told.'
---

# Sign-in and token reference

This page sets out the rules the runtime applies to credentials: how it reads one, the tokens it issues, what a signed-in person may do and what a refused client is told. It also sets out how the runtime checks calls from a browser and requests in local mode. [Authentication and security](../self-host/security.md) covers the tasks: turning sign-in on, making API keys, local mode and calls from a browser.

A person signed in at the runtime acts in its one [org](../concepts/terminology.md#orgs-and-callers), `default`.

## How a credential is read

- A caller sends its credential as `Authorization: Bearer <credential>`.
- A header that is not exactly one `Bearer <key or token>` is refused `400`, in local mode too.
- A credential that has the form of an API key, which starts with `abk_`, is checked as a key. Any other is checked as an access token. Keys and sign-in work side by side.
- An access token is one the runtime issued itself, as the OAuth 2.1 authorization server at `PUBLIC_URL` ([Access tokens](#access-tokens)).

## What the server checks at start

- With `OIDC_ISSUER`, the server reads the identity provider's metadata as it starts, and stops at start on a provider it cannot use.
- With Auto accounts, the server makes no contact with Auto's identity service as it starts. It reads Auto's metadata and registers itself there when the first sign-in begins. When it cannot read Auto's metadata or register there, the person is told the sign-in failed, and the next sign-in tries again.

## Access tokens

The runtime issues an access token at its token endpoint to the client a person signed in through, Studio or an agent:

- It is opaque. The runtime keeps a hash of it, and a client can read nothing in it.
- It lasts 15 minutes. The client then uses its refresh token, which is replaced at each use: a refresh token used twice ends the whole grant. A refresh token lasts 30 days from its latest use, within a grant of 90 days.
- It holds the scopes the person allowed ([How scopes grant permissions](#how-scopes-grant-permissions)).

A token the runtime did not issue, one that has ended or was revoked, and one issued for another resource are refused `401` with `invalid_token`.

## The audience of a token

The runtime accepts an access token only when it was issued for the runtime itself: its audience is `PUBLIC_URL`. A client gets one by asking for `PUBLIC_URL`, or an address under it such as the `resource` the protected resource metadata names, as its `resource` (RFC 8707), or by asking for one of the runtime's scopes with no `resource`. A token asked for with neither serves the UserInfo endpoint alone, and the API refuses it.

The audience is the check that a public server needs. Requests reach it through proxies and under any `Host`, and the audience ties the token to the runtime rather than to the host name a request used. So a public server, whose callers present credentials, does not check `Host`. Local mode is different, since it trusts every request without a credential. There, the `Host` check stops a page in a browser from reaching the server through a name that resolves to the loopback address.

## Calls from a browser

The runtime checks the `Origin` header a browser sends with every request:

- A page may call the API from the Studio host, `STUDIO_ORIGIN`, which is `https://studio.on.auto` unless it is set, from the runtime's own origin where the runtime serves Studio ([Studio served by the runtime](../self-host/security.md#studio-served-by-the-runtime)), or from an origin listed in `ALLOWED_ORIGINS`. The runtime's own origin is `PUBLIC_URL` where it is set, and otherwise the origin the request came in on, which in local mode is a localhost name by the `Host` check.
- A request whose `Origin` names any other origin is refused `403`.
- A request with no `Origin` header, such as one from a script or an agent, passes this check.
- The paths that need no caller skip the `Origin` and `Host` checks: `/health`, the OpenAPI document, the guides, the API catalog, the page at `/` and, where sign-in is on, the protected resource metadata. Under `/studio/`, where the runtime serves Studio, no caller is needed either, and the `Origin` and `Host` checks still apply.
- Being allowed lets a page reach the API. Where credentials are enforced, the page still sends a key or an access token in the `Authorization` header. There is no wildcard origin and no credentials mode.
- In local mode no key is needed, so a script served from the Studio host, or by the runtime itself under `/studio/`, can act as the local developer. Any credential it sends is ignored.

For an allowed origin, the server responds to CORS like this:

| Request                                                     | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A preflight: `OPTIONS` with `Access-Control-Request-Method` | `204`, before any key is checked. It allows `GET`, `HEAD`, `POST`, `PUT` and `DELETE`, and the headers `authorization`, `content-type`, `traceparent`, `tracestate` and `baggage`. The browser may cache it for 600 seconds. A preflight with `Access-Control-Request-Private-Network: true`, which a browser sends before a page on a public origin reaches a server on a private or loopback address, also gets `Access-Control-Allow-Private-Network: true`, so the hosted Studio reaches a runtime on your computer; one without it gets no such header |
| Any other request                                           | `Access-Control-Allow-Origin` with that origin, and `Vary: Origin`. The page may read `x-request-id`, `x-trace-id`, `www-authenticate` and `Date`, so a page that is refused can read the challenge and sign in or ask for the scope it lacks, and a page can count the time left on a link by the server's clock rather than the browser's                                                                                                                                                                                                                 |

## Requests in local mode

A server is in [local mode](../self-host/security.md#local-mode) when it listens only on a loopback address and neither `PUBLIC_URL` nor `API_KEYS` is set, or when its operator declares it with `ACCESS_MODE=local`, for a server whose port only this computer reaches, such as a container whose port is published on `127.0.0.1` alone. The declaration takes no `API_KEYS`, and a `PUBLIC_URL` only on `localhost`, `127.0.0.1` or `[::1]`, which names the server's address, signs no one in, and is needed on a server that listens beyond the loopback. The runtime then signs no one in and serves no protected resource metadata. It trusts every request as the local developer, with every permission in whichever org the request names. It still checks how a request arrives:

- The credential a request presents is ignored: a request with an access token or a key acts as the local developer.
- An `Authorization` header that is not one `Bearer <key or token>` is still refused `400`.
- A request whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]`, with or without a port, is refused `403`. This stops a web page from driving the server through a name that resolves to the loopback address.
- As always, a request whose `Origin` is neither the Studio host's, nor the runtime's own while it serves Studio, as it does by default in local mode, nor in `ALLOWED_ORIGINS` is refused `403`.
- The paths that need no caller skip the `Host` and `Origin` checks.
- On `/mcp`, which names no org, the local developer acts in the org `local`.

## How scopes grant permissions

A client asks for the scopes the protected resource metadata names:

- `org:read`, `org:write`, `playbook:read` and `playbook:write`, the four permissions;
- `user:org:read`, which grants no permission.

The runtime asks the person, on a page of its own, whether to allow an agent. What a token then allows:

- An access token admits the person to the org `default`, over every playbook, with the permissions among the scopes it holds. Only `org:read`, `org:write`, `playbook:read` and `playbook:write` are permissions. Any other scope grants none, `user:org:read` included.
- An access token that grants none of the four still admits the person, with no permission. Every operation then refuses them `403` with `insufficient_scope`. The challenge's `scope` names the permissions the operation needs, so a client asks for a token with more.
- Every other org refuses the person `403` with `insufficient_scope`, over HTTP and on the MCP endpoints. `/mcp` serves them the org `default`.

API keys cover what sign-in does not: a machine, a pipeline or an agent that does not sign in, and a grant over only some of an org's playbooks, such as reading one playbook.

## The name recorded for a signed-in person

A signed-in person acts under the id `person:<id>`, where the id is a SHA-256 of their identity provider's issuer and their subject there, the same at every sign-in. The facts record that id as the person's name too. The id lets a reader of the facts tell a person from a key.

- The id is the `by` of every fact the person records.
- The id and the name, as `{ id, name }`, are the `created_by` of a playbook and a definition they create, the `added_by` and the `connected_by` of a connection they add and connect, the `started_by` of a run they start and the `answered_by` of a request they answer.
- A run event the person sends without a `source` gets the source `/callers/` followed by that name, percent-encoded as one path segment.

## The client a person calls through

An access token issued to an agent names that client beside the person: its client ID, and its name where it gave one. A client ID that is an `https` address is the address of its client ID metadata document, and its host is the client's domain. A token issued to Studio names no client.

`add_connection` and `reconnect_connection` record the client with the link they give, as `asked_by`, `{ id, name, domain }`, with `name` and `domain` `null` where the token gives none, and `read_link` answers the client of the link it reads. A link asked for with an API key or through Studio records none.

## What happens when access is revoked

The runtime checks an access token on every request, against the grants and tokens it keeps.

- A person who no longer holds a role is refused every call from then on, and at their next refresh, authorization or sign-in.
- A member an admin removes is signed out: every sign-in and grant of theirs ends at once, so a token they hold is refused from their next call, through Studio and their agents alike.
- A token a client revokes at the runtime's revocation endpoint is refused from then on.
- `admin reset-setup` signs everyone out: every sign-in, grant and token ends at once, and people and their agents sign in again.
- A workflow run keeps acting as the identity that started it, with that identity's permissions and playbooks, for as long as it runs. A run is one unit of work that identity asked for. Revoking the person's access refuses them as the bullets above say, but does not stop the runs they already started. A caller who may write to the playbook can cancel those runs.

## Discovery and challenges

With sign-in on, a client finds out from the server itself how to sign in. This is the authorization flow of the MCP specification:

1. The client connects to an MCP endpoint without a token, and is challenged.
2. It reads the protected resource metadata the challenge points to.
3. It asks the authorization server the metadata names, the runtime itself, for a token for that resource.
4. It connects again with that token.

An agent gateway that obtains tokens on a person's behalf does the same as any other client.

Signing in through a browser, registering clients and refreshing tokens are the authorization server's work, which the runtime does at `PUBLIC_URL`. A client names itself by its client ID metadata document or registers itself (RFC 7591). The runtime never passes a token it receives on to a tool server; it calls each tool server under that server's own credential.

### Protected resource metadata

With sign-in on, `GET /.well-known/oauth-protected-resource` returns the protected resource metadata of [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) without a key. So does the same path followed by each MCP endpoint's path: `/mcp`, `/orgs/{org}/mcp` and `/orgs/{org}/playbooks/{playbook}/mcp`.

| Field                      | Value                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `resource`                 | `PUBLIC_URL` followed by the path the metadata describes                                                       |
| `authorization_servers`    | The runtime itself, `PUBLIC_URL`                                                                               |
| `bearer_methods_supported` | `["header"]`                                                                                                   |
| `scopes_supported`         | `["user:org:read", "org:read", "org:write", "playbook:read", "playbook:write"]`, the scopes a sign-in asks for |
| `resource_documentation`   | The [MCP reference](mcp.md)                                                                                    |

Without sign-in, the server is not an OAuth resource server, and serves no metadata. Where keys are enforced, the metadata's path needs a key, as every path does.

### Client metadata document

Where the runtime signs people in at an `https` `PUBLIC_URL`, `GET /oauth/client.json` returns without a key the client ID metadata document by which Auto names its own client at a provider's authorization server, when a person [connects the provider by consent](../self-host/connections.md#let-people-connect-by-consent) and that server takes such a client. The authorization server reads it when a consent starts, so the answer may be kept for five minutes.

| Field                        | Value                                                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client_id`                  | The document's own address, `PUBLIC_URL` followed by `/oauth/client.json`                                                                                                                                                                                                      |
| `client_name`                | `Auto Runtime`                                                                                                                                                                                                                                                                 |
| `redirect_uris`              | The one return address a consent sends the person back to: the Studio host's `/connect-return`, `STUDIO_ORIGIN` followed by it, `https://studio.on.auto/connect-return` unless it is set, or `PUBLIC_URL` followed by `/studio/connect-return` where the runtime serves Studio |
| `grant_types`                | `["authorization_code", "refresh_token"]`                                                                                                                                                                                                                                      |
| `response_types`             | `["code"]`                                                                                                                                                                                                                                                                     |
| `application_type`           | `web`                                                                                                                                                                                                                                                                          |
| `token_endpoint_auth_method` | `none`                                                                                                                                                                                                                                                                         |

Where the runtime signs nobody in, as in local mode even at an `https` loopback address, or its `PUBLIC_URL` is `http`, it serves no document. Where keys are enforced, its path then needs a key, as every path does.

### Status codes and challenges

Where credentials are enforced, the runtime responds to a refused request as [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750) sets out. Where sign-in is on, the challenge says more:

| Status | When                                                                                     | `WWW-Authenticate` without sign-in  | `WWW-Authenticate` with sign-in                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | The `Authorization` header is not exactly one `Bearer <key or token>`, in local mode too | `Bearer error="invalid_request"`    | `Bearer error="invalid_request"`                                                                                                                      |
| `401`  | No `Authorization` header                                                                | `Bearer`                            | `Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource", scope="user:org:read org:read org:write playbook:read playbook:write"` |
| `401`  | A key or token was presented and refused                                                 | `Bearer error="invalid_token"`      | The same as above, with `error="invalid_token"` first                                                                                                 |
| `403`  | The caller lacks the permission, playbook or org the call needs                          | `Bearer error="insufficient_scope"` | `error="insufficient_scope"`, the root metadata as `resource_metadata`, and, as `scope`, the permissions the operation needs                          |

The `scope` of a `403` from an operation is the same whether the caller lacks the permission or belongs to another org:

- `scope="playbook:write"` for an operation that writes in a playbook;
- `scope="org:read playbook:read"` for listing the playbooks, which either permits.

The MCP endpoints' own refusals, of an org or a playbook the caller may not reach, name the four permissions, with the metadata of that endpoint. The problem's `detail` names a missing permission as well.

A key's permissions are its own. A key that lacks what the `scope` names is not re-authorized: its holder needs a key that has it.
