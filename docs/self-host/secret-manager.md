---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Keep secrets in your secret manager

By default the runtime keeps each secret it holds, such as a key a person pasted for a connection, a client secret you registered or the tokens a person's consent gives, sealed in the ledger's database under the secrets key, as [Secrets at rest](security.md#secrets-at-rest) describes. Set `SECRETS_KEEPER`, and it keeps each value in AWS Systems Manager Parameter Store instead, as it is, under the manager's own encryption. The ledger then keeps only the bookkeeping of each secret: its version, its claim while its tokens are renewed, its ending and the name and version of its value in Parameter Store. No secret rests in the runtime's database or in a backup of it, and no secrets key is needed.

Nothing changes for the people who add connections, for agents or for playbooks.

## The setting

Name the manager and the prefix the runtime keeps its parameters under, and the region:

```bash
SECRETS_KEEPER=aws-parameter-store:/auto-runtime/secrets
AWS_REGION=eu-west-1
```

- The prefix is an absolute parameter path: it starts with `/`, has no `/` at its end, and has at most 14 segments of letters, digits, `.`, `-` and `_`, the first of which begins with neither `aws` nor `ssm`, which Parameter Store keeps for itself. Any other value stops the server at start, naming `SECRETS_KEEPER`.
- The region is the one `AWS_REGION` names, or `AWS_DEFAULT_REGION` where `AWS_REGION` is not set. Without either, the server stops at start, naming `SECRETS_KEEPER` and `AWS_REGION`. A row names its parameter by name and version alone, so in another region or another account none is found: after such a change the probe at start passes, since the prefix can be written there, and the start then stops at the key the runtime keeps for itself, `The key the runtime keeps for retry_state is no longer in AWS Parameter Store under /auto-runtime/secrets in eu-north-1, the region AWS_REGION names, so the server does not start`. Nothing is served and nothing breaks, and setting the region or the account back mends it.
- The credentials come from the AWS default credential chain, the role of the task, the pod or the instance the runtime runs as, as they do for [object storage](object-storage.md), and requests go through your proxy where `NODE_USE_ENV_PROXY=1` is set.

With Parameter Store as the only keeper, the runtime needs no `SECRETS_KEY`, `SECRETS_KEY_FILE` or `SECRETS_KEY_KMS` and makes no `secrets.key` beside a SQLite ledger, and a ledger in PostgreSQL needs no key either. Setting one of them beside `SECRETS_KEEPER` alone stops the start, naming it, since no keeper would use it.

## The parameters

Each secret is one parameter of the type `SecureString`, named `<prefix>/<id>`, where the id is the secret's own, a UUIDv7, such as `/auto-runtime/secrets/0199c4a2-5f1e-7c3d-9a8b-6e2f4d1c0b7a`.

- The value is the secret as the runtime holds it: a pasted key as it was pasted, a client secret, or the tokens of a consent as JSON. The runtime seals nothing first, so you read, audit and control it in Parameter Store.
- A value of 4 KB or less, 4,096 bytes of UTF-8, names no tier, so a new parameter takes your account's default tier, the standard tier unless you changed it. A larger value, up to the 8 KB a secret may hold, names the advanced tier, which Parameter Store charges for. A parameter in the advanced tier stays there, since Parameter Store lets no parameter go back to the standard tier.
- Replacing a secret, as a renewal of its tokens does, writes a new version of the same parameter, and the ledger's row names that version. Earlier versions stay until Parameter Store drops the oldest, past a hundred.
- Removing a connection deletes the parameter of its secret, with every version of it.
- The runtime names no KMS key, so Parameter Store encrypts each value it writes under the key it uses by default, `aws/ssm`. A key of your own for the parameters is not offered.

## The identity's permissions

The identity the container runs as needs three actions on the parameters under the prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ssm:PutParameter", "ssm:GetParameter", "ssm:DeleteParameter"],
      "Resource": "arn:aws:ssm:eu-west-1:111122223333:parameter/auto-runtime/secrets/*"
    }
  ]
}
```

## At start

Before it reads any secret, the server writes one parameter of its own under the prefix, named `<prefix>/probe-<id>` so that it is never taken for a secret, reads it back and deletes it. A prefix the identity may not write, read or delete stops the start, naming the setting, the prefix and the answer of Parameter Store, and never a credential, such as `The secrets settings are invalid. SECRETS_KEEPER: AWS Parameter Store under /auto-runtime/secrets could not write, read and delete a parameter at start: AWS Parameter Store could not write the parameter /auto-runtime/secrets/probe-<id>: AccessDeniedException: User: user/runtime is not authorized to perform: ssm:PutParameter on resource: parameter/auto-runtime/secrets/probe-<id> because no identity-based policy allows the ssm:PutParameter action`. A Parameter Store that does not answer within 10 seconds stops it too. Once started, the server logs `Secrets are kept in AWS Parameter Store under /auto-runtime/secrets in eu-west-1, and 0 kept by the previous keeper were moved there`.

The key the runtime keeps for itself, which signs the state an MCP client sends back when it retries a call, is a secret like any other, so it is a parameter under the prefix too, made at the first start and read at every later one. At each start the server logs `The runtime read the key it keeps for retry_state in AWS Parameter Store under /auto-runtime/secrets in eu-west-1`, and the line's `own_key_id` annotation is that key's id, so its parameter is `<prefix>/<own_key_id>`. A start that cannot find it stops, since every server that shares the ledger must sign under the same key.

## Move secrets from the ledger and back

To move the secrets a runtime already keeps in the ledger's database into Parameter Store, name Parameter Store in `SECRETS_KEEPER`, the ledger in `SECRETS_KEEPER_PREVIOUS`, keep the setting of the secrets key the ledger's secrets are sealed under, and restart once:

```bash
SECRETS_KEEPER=aws-parameter-store:/auto-runtime/secrets
SECRETS_KEEPER_PREVIOUS=ledger
SECRETS_KEY_FILE=/run/secrets/secrets-key
AWS_REGION=eu-west-1
```

At start the server reads each secret the ledger seals, a hundred at a time, writes it to Parameter Store, records the parameter in the secret's row and only then lets the ledger's copy go, and logs how many it moved, `Secrets are kept in AWS Parameter Store under /auto-runtime/secrets in eu-west-1, and 12 kept by the previous keeper were moved there`. Each secret keeps its version, its claim and its ending. Once that count covers the secrets the ledger kept and the start logged no warning that secrets are left with the previous keeper, remove `SECRETS_KEEPER_PREVIOUS` and the setting of the key, and restart again: nothing is kept in the ledger any more, so the server needs no key. Where it logged one, keep both settings, under which the secrets it names are still read from the ledger: give the key a warning names by its id as `SECRETS_KEY_PREVIOUS`, `SECRETS_KEY_FILE_PREVIOUS` or `SECRETS_KEY_KMS_PREVIOUS` and restart, which moves the secrets sealed under it, and keep the settings while a secret whose value Parameter Store refused is still there, until its connection is given a value Parameter Store keeps or is removed.

Moving back is the same the other way round, with the key the ledger will seal the secrets under:

```bash
SECRETS_KEEPER=ledger
SECRETS_KEEPER_PREVIOUS=aws-parameter-store:/auto-runtime/secrets
SECRETS_KEY_FILE=/run/secrets/secrets-key
AWS_REGION=eu-west-1
```

The server reads each parameter, seals its value in the ledger, and deletes the parameter once the secret's row holds the sealed value, for which the identity needs `ssm:GetParameter` and `ssm:DeleteParameter` alone, and logs `Secrets are kept in the ledger's database, sealed under the key <id> that the file /run/secrets/secrets-key holds, and 0 sealed under the previous key were sealed again under it, and 12 kept by the previous keeper were moved there`.

`SECRETS_KEEPER_PREVIOUS` is read only beside `SECRETS_KEEPER`, and names the other of the two keepers. A secret replaced while the move runs, as another server renewing its tokens would, is left as that replacement left it, and nothing of it is deleted. A secret the previous keeper cannot be read from now, a write Parameter Store still throttles after the SDK's retries, or one past the parameters the account keeps, stops the start, naming `SECRETS_KEEPER_PREVIOUS` before the answer of the keeper; the secrets moved before it stay moved, and the next start moves the rest. A secret sealed under a key that neither the secrets key nor its previous setting holds is left in the ledger, logged once with that key's id, until that key is given as the previous one; a value Parameter Store refuses to keep is left where it is too, logged with its secret's id. A secret whose parameter is gone from Parameter Store is left where it is: its connection breaks at its next use while `SECRETS_KEEPER_PREVIOUS` still names Parameter Store, and cannot be read, in words that name the keeper, once it no longer does. With several servers, stop them all and start them with both settings, as for a [rotation of the secrets key](production.md#rotate-the-secrets-key), since a server still running with the old setting alone keeps writing where the move takes the secrets from.

## What you see in Parameter Store

Each parameter under the prefix is a secret the runtime keeps, named by its id, with its versions. Your account's trail records each `PutParameter`, `GetParameter` and `DeleteParameter` the runtime asks for.

- Read a value there when you need to; the runtime is not told.
- Do not write a value there. The runtime reads the version the secret's row names, so a version you write is never read, and its next write of the secret goes past it. To change a connection's credential, add the connection again.
- Deleting a parameter there loses the secret for good. The connection whose secret it held breaks at its next use, `connection_broken`, and asks to be reconnected, as it would if its row were gone from the ledger. Deleting the parameter of the key the runtime keeps for itself, `<prefix>/<own_key_id>`, stops every later start.
- Delete a parameter there only when the server's warning names it, `A value no secret names any more is left where it was kept, until it is deleted there: AWS Parameter Store could not delete the parameter <name>: …`, as a removed connection whose delete failed leaves one, or when it is a probe left behind, `<prefix>/probe-<id>`, which a start interrupted between its write and its delete leaves.

## Limits

By default Parameter Store takes about three writes and forty reads a second for an account in a region. The runtime writes a secret when one is kept, when a consent finishes and when tokens are renewed, and reads one when a connection is first used in a server's process and when its tokens are renewed, which stays well under both.

- A move meets the limit: moving secrets into Parameter Store writes each one, and moving them back deletes each one, so a move of a thousand secrets takes about six minutes at three a second.
- The AWS SDK retries a throttled request itself, in its adaptive mode, which slows what it sends once Parameter Store throttles it. It reads `AWS_RETRY_MODE` and `AWS_MAX_ATTEMPTS` itself, three attempts unless `AWS_MAX_ATTEMPTS` says otherwise. A write still throttled after them fails the request that needed it, such as adding a credential or renewing tokens, as unavailable, in the words of Parameter Store, and leaves the connection as it was; during a move it stops the start, and the next start resumes the move. A read Parameter Store does not answer within 10 seconds fails the call as `connection_unavailable` and leaves the connection connected. Higher throughput is a setting of your account in Parameter Store.
- An account keeps at most ten thousand standard parameters in a region, and a move past them stops at the first secret it cannot write, naming `SECRETS_KEEPER_PREVIOUS` and the words of Parameter Store, the secrets moved before it staying moved. Past them, and for a value Parameter Store will never keep, such as one that holds a reference to another parameter between double braces, nothing is kept and the value is refused in the words of Parameter Store, `AWS Parameter Store refused to keep the parameter <name>: …`: a pasted credential as one that cannot be taken as it is given, a consent's tokens as a conflict, and the tokens a renewal gave are revoked.
