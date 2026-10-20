# Use PostgreSQL

Set `DATABASE_URL` to a PostgreSQL database, and the server keeps its ledger there instead of in a SQLite file. Use PostgreSQL when:

- you want your database service to take the backups;
- the container should keep nothing of its own;
- several servers share one ledger.

The runtime is tested on PostgreSQL 18. The image needs nothing more for it, since its PostgreSQL driver is pure JavaScript.

## Get a database

| Option                           | What it is                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beside the runtime, with Compose | [Run with PostgreSQL](docker.md#run-with-postgresql) has a Compose file that starts `postgres:18` with its data on a volume. It suits one machine                                                   |
| A managed service                | Amazon RDS or Aurora PostgreSQL, Google Cloud SQL for PostgreSQL, Azure Database for PostgreSQL, or another provider's PostgreSQL 18. The provider takes backups, applies patches and can fail over |
| A server you run                 | Any PostgreSQL 18 server the containers can reach                                                                                                                                                   |

For a managed service or a server you run, create a database and a user for the runtime as below.

## Create the database and its user

The server creates its tables in the database's `public` schema at every start, and migrates them there after an upgrade. Its user needs `CREATE` on that schema every time, not only the first. A user that owns the database has it:

```sql
CREATE ROLE auto_runtime LOGIN PASSWORD '<a long random password>';
CREATE DATABASE auto_runtime OWNER auto_runtime;
```

Run these as an administrator, such as the master user of a managed database. With a user that may only read and write the tables, the server fails to start with `permission denied for schema public`.

## Connect

The URL holds the database's password, so it is a secret:

- Put it with the other secrets in the container's environment, such as `auto-runtime.env`.
- Never put it in the configuration file, which refuses a `database_url` key.

Each `docker run` on this page starts a container named `auto-runtime` and is an alternative to the others. Run them in the folder from [Run with Docker](docker.md#start-the-server). Its `.env` names the release to run, such as `IMAGE=docker.on.auto/onauto/runtime:0.9.1`, and its `auto-runtime.env` holds `PUBLIC_URL`, without which the container stops at start, and `SECRETS_KEY`, which a ledger in PostgreSQL needs. If a container named `auto-runtime` exists, stop and remove it first with `docker stop auto-runtime && docker rm auto-runtime`. Then:

```bash
echo 'DATABASE_URL=postgresql://auto_runtime:<password>@db.example.com:5432/auto_runtime?sslmode=verify-full' >> auto-runtime.env
. ./.env
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env "$IMAGE"
```

`--publish 127.0.0.1:5555:5555` keeps the port on this machine, as in [Run with Docker](docker.md#start-the-server). To reach the runtime from other machines, follow [Put HTTPS in front](production.md#put-https-in-front).

With `DATABASE_URL` the container needs no volume. At start:

- The server logs that the ledger is kept in PostgreSQL, naming the database and its host, never the URL.
- A database it cannot reach stops it, naming the host and port.
- Setting `LEDGER_FILE` as well stops it, since the ledger can be in only one place.
- Without `SECRETS_KEY`, `SECRETS_KEY_FILE` or `SECRETS_KEY_KMS` it stops, naming the setting.

`SECRETS_KEY` is the key the secrets kept in the database are sealed under. Every server that shares the database takes the same key, as [Keep the secrets key](production.md#keep-the-secrets-key) describes.

### TLS

For a database across a network, end the URL with `?sslmode=verify-full`. The connection is then encrypted, and the database's certificate and host name are checked against the certificate authorities Node trusts.

When your provider signs with its own certificate authority, mount its certificate bundle in the container and name it with `NODE_EXTRA_CA_CERTS`. Start the container with this command in place of the one above:

```bash
. ./.env
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env \
  --volume "$PWD/provider-ca.pem:/etc/auto-runtime/provider-ca.pem:ro" \
  --env NODE_EXTRA_CA_CERTS=/etc/auto-runtime/provider-ca.pem \
  "$IMAGE"
```

| `sslmode`                        | What happens                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `verify-full`                    | Encrypted, with the certificate and host name checked. Write this one                                               |
| `require`, `prefer`, `verify-ca` | Treated as `verify-full` by the driver, which also prints a multi-line security warning the first time it connects  |
| `no-verify`                      | Encrypted without checking the certificate, so a machine in between can read the connection. Use it only for a test |

## Without a password, on Amazon RDS {#without-a-password-on-amazon-rds}

A database of Amazon RDS or Aurora PostgreSQL can authenticate its user with IAM instead of a password. No database password then exists anywhere: the server signs a token for each connection it opens, from the identity the container runs as.

1. Turn IAM database authentication on for the instance or the cluster.
2. Grant the database user the `rds_iam` role, in addition to owning its database: `GRANT rds_iam TO auto_runtime;`. A user with that role signs in with a token.
3. Give the identity the container runs as `rds-db:connect` on that user. That identity is, for example, the role of its task or of its instance. The resource is `arn:aws:rds-db:<region>:<account>:dbuser:<the instance's or cluster's resource id>/auto_runtime`.
4. Set `DATABASE_URL` without a password, and `DATABASE_CREDENTIALS=aws-iam`. Neither is a secret, so both may go in the container's environment.
5. Keep TLS on. The certificate authorities of Amazon RDS are not among those Node trusts. Mount their bundle, `global-bundle.pem`, in the container and name it with `NODE_EXTRA_CA_CERTS`.

```bash
echo 'DATABASE_URL=postgresql://auto_runtime@ledger.c9akciq32.eu-west-1.rds.amazonaws.com:5432/auto_runtime' >> auto-runtime.env
echo 'DATABASE_CREDENTIALS=aws-iam' >> auto-runtime.env
echo 'NODE_EXTRA_CA_CERTS=/etc/auto-runtime/rds-global-bundle.pem' >> auto-runtime.env
. ./.env
docker run --detach --name auto-runtime --restart unless-stopped \
  --publish 127.0.0.1:5555:5555 --env-file auto-runtime.env \
  --volume "$PWD/global-bundle.pem:/etc/auto-runtime/rds-global-bundle.pem:ro" "$IMAGE"
```

### How the server signs a token

- It signs a new token each time it opens a connection, for the host, the port and the user of `DATABASE_URL`.
- A token is valid for 15 minutes.
- It uses the credentials of the AWS default credential chain, as the Bedrock provider and the object store do. With `NODE_USE_ENV_PROXY=1` set, it reaches AWS through the outbound proxy.
- It signs for the region in the host name, such as `eu-west-1` above. For a host name without a region, it signs for `AWS_REGION`.
- The connection always uses TLS and checks the database's certificate and host name, as `sslmode=verify-full` does, with or without `sslmode` in the URL.
- At start the server logs the user and the region it signs for, never a token.

### What stops the start

With `DATABASE_CREDENTIALS=aws-iam`, the server stops at start, naming the setting and never a value, when:

- the URL holds a password;
- the URL names no user;
- the URL gives an `sslmode` other than `verify-full`;
- the URL gives a TLS option such as `sslrootcert` (put the certificate authority in `NODE_EXTRA_CA_CERTS` instead), or any other option;
- neither the host name nor `AWS_REGION` names a region.

Two other failures:

- When the server cannot sign a token because the chain finds no credentials, it stops at start with the chain's error.
- When the database refuses a token, because the user lacks `rds_iam` or the identity lacks `rds-db:connect`, the connection fails with the database's error.

## Several servers on one database

Several servers may share the database, but only one of them runs the workflows at a time; the others stand by. [Choose one server or a standby](production.md#run-several-servers) sets out when that helps and how to route requests. [How several servers share the workflows](workflows.md#how-several-servers-share-the-workflows) describes the claim, which the database's clock judges. To upgrade them, follow [Upgrade several servers](workflows.md#upgrade-several-servers).

## Back up

The ledger and the workflows are in the same database. Its backups hold everything the runtime keeps, except content kept on [object storage](object-storage.md).

- On a managed service, use your provider's automated backups and point-in-time recovery.
- On a server you run, use `pg_dump`.
- Test a restore before you rely on it.
