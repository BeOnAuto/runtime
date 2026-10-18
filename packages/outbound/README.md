# @on.auto/outbound

How the server calls systems on the internet. It walks the causes of a failed call, and tells a certificate the server does not trust from any other failure of a call: the reasoning function adapter and the tool-servers package take the classification from here, so a model provider and a tool server whose certificate the server does not trust are named alike; every caller keeps its own client and bounds. It sets a `User-Agent` on each request a `fetch` it wraps sends where the request sets none. And it makes the settings of a client of the AWS SDK, which the Bedrock provider of the reasoning capability and the object store of [`@on.auto/object-storage`](../object-storage/README.md) share, and signs the tokens the server signs in to the ledger's database with when `DATABASE_CREDENTIALS=aws-iam`.

## The causes of a failure

`causesOf(error)` is the one walk of a failure's causes (`src/causes/error-causes.ts`): the failure and each `cause` it wraps, eight at most, ending at the first that is no object. `codesOf(error)` names the code of each, and the tool-servers package reads the walk for the refusal of a host that a client wraps.

## Certificates

`isUntrustedCertificate(error)` says whether any of the codes `codesOf` names is the code of a certificate the server does not trust.

## The User-Agent of a request

`withUserAgent(fetch, userAgent)` (`src/user-agent/user-agent-fetch.ts`) sends each request through the `fetch` it wraps with `User-Agent` set to `userAgent` where the request sets none, in whatever case the request writes the name, so a `User-Agent` the caller writes is the one sent. It reads the request's headers as a `Headers`, a list of pairs of strings or an object of strings, and hands headers of any other shape to the `fetch` beneath as they are, which sends its own (`node` for Node's, measured with Node 26.10.0).

## AWS clients

`proxySettingsOf(environment)`, in the main entry, reads `ProxySettings`, `{ enabled, environment }`: the switch, `NODE_USE_ENV_PROXY=1`, and the proxy's variables that are set, `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` in either case. The server reads them once and hands them to every client it makes, the model providers' and the object store's.

`@on.auto/outbound/aws` (`src/aws/aws-clients.ts`) is a subpath of its own, so that the packages that take the classification of certificates alone, the tool-servers package among them, load no part of the AWS SDK. `awsCredentialChain(proxy)` is the default credential chain of the AWS SDK, `fromNodeProviderChain` of `@aws-sdk/credential-providers`, which resolves credentials from the environment, the shared files, single sign-on, a process, a web identity, the container or the instance, looking nothing up until a call needs them. `awsClientSettingsOf(proxy)` is the part of a client's settings that sends its requests through the environment proxy, `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, when Node is told to with `NODE_USE_ENV_PROXY=1`, by the `proxyEnv` of the agents of its request handler, since a client of the AWS SDK makes agents of its own that the switch alone does not reach; without the switch it is empty. The chain's own clients take the same settings, by HTTP as well as by HTTPS: the agent of each carries the proxy's variables, so a credential endpoint reached by HTTP, such as a container's, goes through the proxy too unless `NO_PROXY` names it, where the reasoning capability's chain once set the HTTPS agent alone.

`awsDatabaseTokenSigner(proxy, { hostname, port, username, region })` signs the password of a connection to a database of Amazon RDS that authenticates its users with IAM: each call signs a token of its own with the `Signer` of `@aws-sdk/rds-signer`, pinned to the version of `@aws-sdk/credential-providers`, a request to connect as that user to that host and port, presigned for the region and valid for 15 minutes, from the credentials of `awsCredentialChain(proxy)`, which it looks up when it is first asked for a token and not when it is made. The signer itself sends no request; the credential chain does, through the proxy. The server's pools of the ledger's PostgreSQL database ask it for a token at each connection they open, so each connection signs in with a token of its own.

## Source

`src/causes` holds the walk of a failure's causes, `src/certificates` the classification, `src/user-agent` the `User-Agent` of a request, `src/proxy` the settings of the environment proxy, and `src/aws` the settings of AWS clients.
