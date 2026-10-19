# Sign-in and token reference

This page sets out the rules the runtime applies to credentials: how it reads one, what a token must hold, what a signed-in person may do and what a refused client is told. It also sets out how the runtime checks calls from a browser and requests in local mode. [Authentication and security](../self-host/security.md) covers the tasks: turning sign-in on, making API keys, local mode and calls from a browser.

A signed-in person acts in an [org](../concepts/terminology.md#orgs-and-callers), the runtime's name for an organization in the Auto identity service.

## How a credential is read

- A caller sends its credential as `Authorization: Bearer <credential>`.
- A header that is not exactly one `Bearer <key or token>` is refused `400`, in local mode too.
- A credential that has the form of an API key, which starts with `abk_`, is checked as a key. Any other is checked as a token. Keys and sign-in work side by side.
- A token is a JWT that the Auto identity service signed, in one of [two forms](#the-two-token-forms).

## What the server checks at start

With sign-in on, the server reads the identity service before it accepts a request:

1. It reads the service's metadata from `/.well-known/oauth-authorization-server`. When that cannot be used, it reads `/.well-known/openid-configuration` instead. This is the order of the MCP authorization specification.
2. The metadata must name the issuer exactly as `IDENTITY_ISSUER` writes it, and an `https` `jwks_uri`.
3. It reads the key set at that `jwks_uri`, which must hold a key.

Each read waits at most 10 seconds for a response and reads at most 64 KiB. It follows no redirect: an address that responds with one is refused, like an address that does not respond.

A service whose metadata or key set cannot be used stops the start with an `UnusableIdentityServiceError`. The error names the service and each address the server read.

## The two token forms

| Form         | Holds `aud` | Who holds it                                                                                                                                                                                                                  | Where it is accepted                                                                                                                                                                             | Permissions                                     |
| ------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Access token | Yes         | A third party acting for a person: an agent that obtains it through the authorization flow, or an agent gateway that obtains it on the person's behalf. The person grants its scopes on the identity service's consent screen | Wherever its `aud` names the runtime; see [The audience of a token](#the-audience-of-a-token)                                                                                                    | The permissions among the scopes it was granted |
| Session      | No          | A page the person signs in to: Studio, Auto's own app (signed in to once, with no consent screen), or a page at an origin in `ALLOWED_ORIGINS`                                                                                | Only when its `azp` names the Studio host's origin, `PUBLIC_URL` where the runtime serves Studio, or one of `ALLOWED_ORIGINS`, and only on a request whose `Origin` header is exactly that `azp` | Every permission in the person's org            |

A token that holds `aud` is an access token, even when it also holds an `azp`.

## What a token must hold

The runtime accepts a token only when it meets every rule:

| Claim or property | Rule                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size              | At most 8 KiB                                                                                                                                                                                                                                                     |
| `alg` (header)    | `RS256`, `PS256`, `ES256`, or `EdDSA` on `Ed25519`. `none` and every other algorithm are refused                                                                                                                                                                  |
| `typ` (header)    | `at+jwt`, `application/at+jwt`, `JWT` or `application/jwt`, in any letter case, or none                                                                                                                                                                           |
| Signature         | By a key of the service's key set that verifies its algorithm, chosen by the token's `kid`. A token without a `kid` uses the only key of its type in the set; one that several keys fit is refused                                                                |
| Signing key       | Never an RSA key under 2048 bits, a key meant for encryption, or a key named for another algorithm                                                                                                                                                                |
| `iss`             | The issuer, `IDENTITY_ISSUER`                                                                                                                                                                                                                                     |
| `aud`             | For an access token, an audience the runtime accepts: see [The audience of a token](#the-audience-of-a-token)                                                                                                                                                     |
| `azp`             | For a session, an origin the runtime allows, equal to the request's `Origin` header                                                                                                                                                                               |
| `exp`             | Present and not past, with 60 seconds of leeway                                                                                                                                                                                                                   |
| `nbf` and `iat`   | Not ahead, with 60 seconds of leeway                                                                                                                                                                                                                              |
| `sub`             | A non-empty string of at most 256 bytes, without control characters, unpaired surrogates or noncharacters. These are the bounds of a name in the facts, since `sub` becomes part of the name recorded for the person                                              |
| `org_id`          | For an access token: present, and an org id of 1 to 64 letters, digits, `_` and `-`, other than `local`. It is the id of the organization the person signed in to. The identity service puts it in the token when the person grants `user:org:read`               |
| `o`               | For a session: an object whose `id` is an org id under the same rule. Version 2 of the service's session token names the organization in `o`, beside its slug, the person's role, their permissions and a feature-permission map. The runtime reads only the `id` |
| `scope`           | For an access token that holds it, a string of scopes separated by spaces, as the identity service issues it. The `scope` of a session is not read                                                                                                                |

The org comes from the org claim of the token's form alone: `org_id` for an access token, the `id` of `o` for a session. A token without it is refused; a session issued while the person has no active organization is one example. No org is taken from the subject or from anything else the token holds. That includes the `org_id` of a session and the `o` of an access token.

## How the key set is kept

- The server reads the key set again for a `kid` it does not hold, once 60 seconds have passed since the last read that succeeded.
- It reads the set again at the first token after the set is ten minutes old. So a key the service removes is trusted for ten minutes at most.
- When it cannot read the set again for an unknown `kid`, the keys it held stay in use.
- When it cannot read the set once ten minutes have passed, every token is refused. An identity service that is unreachable for longer than that keeps sign-ins out until it responds again.

## When a token is refused

A token that fails any rule is refused `401` with `invalid_token`, and so is an opaque token. The problem's `detail` names the rule or the claim the token failed, and never a value it holds:

| Token                                                                                   | Detail                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| An expired token                                                                        | `The token was refused: ERR_JWT_EXPIRED on its exp claim`                           |
| An access token without `org_id`                                                        | `The token was refused: ERR_JWT_CLAIM_VALIDATION_FAILED on its org_id claim`        |
| An access token whose `org_id` is not an org id other than `local`                      | `The token was refused: its org_id claim is not an org id other than local`         |
| A session without `o`, such as one issued while the person has no active organization   | `The token was refused: ERR_JWT_CLAIM_VALIDATION_FAILED on its o claim`             |
| A session whose `o` is no object, or holds no `id` that is an org id other than `local` | `The token was refused: its o.id claim is not an org id other than local`           |
| An access token for another resource                                                    | Ends `on its aud claim`                                                             |
| A session given to a page at an origin the runtime does not allow, or naming no origin  | Ends `on its azp claim`                                                             |
| A session sent without an `Origin` header, or from another origin than its `azp`        | `The token was refused: the session was not presented by the page it was issued to` |

## The audience of a token

The runtime accepts an access token only when its `aud` names the runtime as one of these:

- `PUBLIC_URL`, alone or with a final `/`;
- on an MCP endpoint, `PUBLIC_URL` followed by the path of the endpoint the request reached, such as `https://runtime.example.com/orgs/acme/mcp`. A standards client asks for a token for this resource when the metadata of that endpoint names it.

So the runtime refuses these, though the same service signed them:

- a token the identity service issued for another service;
- an identity token sent by mistake;
- a token that another resource server received and passes on.

A session names no audience. The runtime checks its `azp` instead, which is the origin of the page that the identity service issued it to:

- A session issued to a page that the runtime does not allow is refused.
- A session issued to a page that it allows is accepted only on a request whose `Origin` is that page's origin. This holds on the MCP endpoints as on every other path.
- A page's calls to a runtime are always cross-origin, so its browser always sends `Origin`.
- A session serves a page and never an agent.

The audience is the check that a public server needs. Requests reach it through proxies and under any `Host`, and the audience ties the token to the runtime rather than to the host name a request used. So a public server, whose callers present credentials, does not check `Host`. Local mode is different, since it trusts every request without a credential. There, the `Host` check stops a page in a browser from reaching the server through a name that resolves to the loopback address.

## Calls from a browser

The runtime checks the `Origin` header a browser sends with every request:

- A page may call the API from the Studio host, `STUDIO_ORIGIN`, which is `https://studio.on.auto` unless it is set, from the runtime's own origin where the runtime serves Studio ([Studio served by the runtime](../self-host/security.md#studio-served-by-the-runtime)), or from an origin listed in `ALLOWED_ORIGINS`. The runtime's own origin is `PUBLIC_URL` where it is set, and otherwise the origin the request came in on, which in local mode is a localhost name by the `Host` check.
- A request whose `Origin` names any other origin is refused `403`.
- A request with no `Origin` header, such as one from a script or an agent, passes this check.
- The paths that need no caller skip the `Origin` and `Host` checks: `/health`, the OpenAPI document, the guides, the API catalog, the page at `/` and, where sign-in is on, the protected resource metadata. Under `/studio/`, where the runtime serves Studio, no caller is needed either, and the `Origin` and `Host` checks still apply.
- Being allowed lets a page reach the API. Where credentials are enforced, the page still sends a key or a session in the `Authorization` header. There is no wildcard origin and no credentials mode.

A page that a person signed in to sends the session that the identity service issued to it, as `Authorization: Bearer <session>`. It then acts as that person, with every permission in their org.

- A session is accepted only from its own page: the request's `Origin` header must be the origin the session names as `azp`.
- A session sent without `Origin` (by a script outside a browser, or by an agent) or from another page is refused `401`. [When a token is refused](#when-a-token-is-refused) gives the detail it carries.
- In local mode no key is needed, so a script served from the Studio host, or by the runtime itself under `/studio/`, can act as the local developer. The session it sends is ignored.

For an allowed origin, the server responds to CORS like this:

| Request                                                     | Response                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A preflight: `OPTIONS` with `Access-Control-Request-Method` | `204`, before any key is checked. It allows `GET`, `HEAD`, `POST`, `PUT` and `DELETE`, and the headers `authorization`, `content-type`, `traceparent`, `tracestate` and `baggage`. The browser may cache it for 600 seconds           |
| Any other request                                           | `Access-Control-Allow-Origin` with that origin, and `Vary: Origin`. The page may read `x-request-id`, `x-trace-id` and `www-authenticate`, so a page that is refused can read the challenge and sign in or ask for the scope it lacks |

## Requests in local mode

A server is in [local mode](../self-host/security.md#local-mode) when it listens only on a loopback address and neither `PUBLIC_URL` nor `API_KEYS` is set, or when its operator declares it with `ACCESS_MODE=local`, for a server whose port only this computer reaches, such as a container whose port is published on `127.0.0.1` alone. The declaration takes no `API_KEYS`, and a `PUBLIC_URL` only on `localhost`, `127.0.0.1` or `[::1]`, which names the server's address, signs no one in, and is needed on a server that listens beyond the loopback. The runtime then signs no one in and serves no protected resource metadata. It trusts every request as the local developer, with every permission in whichever org the request names. It still checks how a request arrives:

- The credential a request presents is ignored, since a page signed in to Auto sends its session to every server it calls. A request with a session, an access token or a key acts as the local developer.
- An `Authorization` header that is not one `Bearer <key or token>` is still refused `400`.
- A request whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]`, with or without a port, is refused `403`. This stops a web page from driving the server through a name that resolves to the loopback address.
- As always, a request whose `Origin` is neither the Studio host's, nor the runtime's own while it serves Studio, as it does by default in local mode, nor in `ALLOWED_ORIGINS` is refused `403`.
- The paths that need no caller skip the `Host` and `Origin` checks.
- On `/mcp`, which names no org, the local developer acts in the org `local`.

## How scopes grant permissions

A sign-in asks the identity service for five scopes:

- `user:org:read`, which binds the token to the organization the person signs in to;
- `org:read`, `org:write`, `playbook:read` and `playbook:write`, the four permissions.

The identity service defines each permission as a scope of its own, with a sentence that it shows on its consent screen, so a person can read what they grant.

What a token then allows:

- A session admits the person to the org the `id` of its `o` names, over every playbook, with all four permissions, as they act in Studio. The role and permissions its `o` names do not change that.
- An access token admits the person to the org its `org_id` names, over every playbook, with the permissions among the scopes in its `scope` claim. Only `org:read`, `org:write`, `playbook:read` and `playbook:write` are permissions. Any other scope grants none, `user:org:read` included.
- An access token that grants none of the four, or holds no `scope`, still admits the person to their org, with no permission. Every operation then refuses them `403` with `insufficient_scope`. The challenge's `scope` names the permissions the operation needs, so a client asks the identity service for a token with more.
- For an access token, `org_id` binds the org, not `user:org:read`. An access token that holds `org_id` and the four permissions, but not `user:org:read`, admits the person to that org with all four permissions.
- Every other org refuses the person `403` with `insufficient_scope`, over HTTP and on the MCP endpoints. `/mcp` serves them the org their token names.

API keys cover what sign-in does not: a machine, a pipeline or a trainer's agent that does not sign in, and a grant over only some of an org's playbooks, such as reading one playbook.

## The name recorded for a signed-in person

A signed-in person acts under the name `person:<subject>`, where the subject is the token's `sub`, unchanged. This name lets a reader of the facts tell a person from a key.

- It is the `by` of every fact the person records, including the activation of a prediction function version they ask for.
- It is the `created_by`, `started_by`, `answered_by` and `approved_by` of what they create, start, answer and approve.
- A run event the person sends without a `source` gets the source `/callers/` followed by that name, percent-encoded as one path segment.

## What happens when access is revoked

The runtime verifies a token on every request and keeps none.

- When the identity service stops issuing tokens to a person, the runtime refuses them once their last token expires.
- A token the service revokes before it expires is still accepted until it expires, since the runtime does not ask the service.
- A workflow run keeps acting as the identity that started it, with that identity's permissions and playbooks, for as long as it runs. A run is one unit of work that identity asked for. Revoking the person stops their next request, not the runs they already started. A caller who may write to the playbook can cancel those runs.

## Discovery and challenges

With sign-in on, a client finds out from the server itself how to sign in. This is the authorization flow of the MCP specification:

1. The client connects to an MCP endpoint without a token, and is challenged.
2. It reads the protected resource metadata the challenge points to.
3. It asks the authorization server the metadata names for a token for that resource.
4. It connects again with that token.

An agent gateway that obtains tokens on a person's behalf does the same as any other client.

Signing in through a browser, registering clients and refreshing tokens are the authorization server's work. The runtime never issues a token. It never passes a token it receives on to a tool server; it calls each tool server under that server's own credential.

### Protected resource metadata

With sign-in on, `GET /.well-known/oauth-protected-resource` returns the protected resource metadata of [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) without a key. So does the same path followed by each MCP endpoint's path: `/mcp`, `/orgs/{org}/mcp` and `/orgs/{org}/playbooks/{playbook}/mcp`.

| Field                      | Value                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `resource`                 | `PUBLIC_URL` followed by the path the metadata describes                                                       |
| `authorization_servers`    | The one issuer, `IDENTITY_ISSUER`                                                                              |
| `bearer_methods_supported` | `["header"]`                                                                                                   |
| `scopes_supported`         | `["user:org:read", "org:read", "org:write", "playbook:read", "playbook:write"]`, the scopes a sign-in asks for |
| `resource_documentation`   | The [MCP reference](mcp.md)                                                                                    |

Without sign-in, the server is not an OAuth resource server, and serves no metadata. Where keys are enforced, the metadata's path needs a key, as every path does.

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
