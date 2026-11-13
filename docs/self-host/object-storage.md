---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Keep content on object storage

By default, the content a playbook keeps is stored in the ledger's database. Set `CONTENT_STORE_URL` to an `s3://bucket/prefix` URL, and the server keeps that content in an S3 bucket instead. Every other record stays in the ledger.

Choose before the first start. The server moves nothing between the database and the bucket, and a server whose ledger names content that is not where it keeps content does not start; see [A deployment that already has content](#a-deployment-that-already-has-content).

Content is what grows large: a tool's arguments and results, and, with [payload offloading](configuration.md#payload-offloading) on, as it is by default, every payload larger than its threshold, such as the input, output or answer of a run.

Moving content out keeps the database small and its backups fast. The server keeps one object for each piece of content, under its playbook and its SHA-256.

The server speaks the S3 API, so the bucket may be on Amazon S3 or on any S3-compatible server.

## Settings

| Variable              | Purpose                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTENT_STORE_URL`   | The bucket and the prefix, `s3://bucket/prefix`. The bucket is 3 to 63 lowercase letters, digits, dots and hyphens. The prefix may be empty                                                                                  |
| `AWS_ENDPOINT_URL_S3` | The endpoint of an S3-compatible server, such as `http://storage.internal:9000`, addressed by path. Read before `AWS_ENDPOINT_URL`                                                                                           |
| `AWS_ENDPOINT_URL`    | The same, read when `AWS_ENDPOINT_URL_S3` is not set. It is also the Bedrock provider's endpoint unless `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` is set. With Bedrock configured, name the storage server in `AWS_ENDPOINT_URL_S3` |
| `AWS_REGION`          | The region requests are signed for. The AWS SDK otherwise reads it from a profile; without either, the server stops at start. S3-compatible servers commonly take `us-east-1`                                                |

The credentials come from the AWS default credential chain, as the Bedrock provider's do. It takes them from:

- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the container's environment;
- a profile;
- a web identity;
- the role of the container or the instance.

## Amazon S3

Give the role the container runs as access to the bucket, then set the URL and the region:

```bash
echo 'CONTENT_STORE_URL=s3://acme-auto-runtime/content' >> auto-runtime.env
echo 'AWS_REGION=eu-west-1' >> auto-runtime.env
```

## An S3-compatible server

Name its endpoint and give it an access key:

```bash
echo 'CONTENT_STORE_URL=s3://auto-runtime/content' >> auto-runtime.env
echo 'AWS_ENDPOINT_URL_S3=http://storage.internal:9000' >> auto-runtime.env
echo 'AWS_REGION=us-east-1' >> auto-runtime.env
echo 'AWS_ACCESS_KEY_ID=<access key>' >> auto-runtime.env
echo 'AWS_SECRET_ACCESS_KEY=<secret key>' >> auto-runtime.env
```

## The bucket

The bucket must exist. The server creates none, and checks the bucket at start.

- A bucket it cannot reach stops it at start. The cause may be a refusal, a missing bucket, a missing region or an endpoint that does not respond. The message names `CONTENT_STORE_URL`, the bucket, the endpoint's host and the store's response, never a credential.
- Once it reaches the bucket, it logs that content is kept on object storage, naming the bucket, the prefix and the endpoint's host.

### Permissions

The credentials need these permissions:

| Permission                      | On                           | Why                                              |
| ------------------------------- | ---------------------------- | ------------------------------------------------ |
| `s3:GetObject`                  | The objects under the prefix | Read content                                     |
| `s3:PutObject`                  | The objects under the prefix | Write and copy content                           |
| `s3:DeleteObject`               | The objects under the prefix | Delete content                                   |
| `s3:AbortMultipartUpload`       | The objects under the prefix | Abort an unfinished upload                       |
| `s3:ListBucket`                 | The bucket                   | List the bucket; the check at start needs it too |
| `s3:ListBucketMultipartUploads` | The bucket                   | List unfinished uploads                          |

Several servers may share a bucket and a prefix, as they share the ledger's database. Keep their clocks within seconds of each other, as NTP or your platform's time service does: a server takes another server's removal of content that has run for ten minutes by its own clock for one that stopped, and finishes it.

### Versioning and lifecycle

- Versioning is not required.
- On a bucket with versioning on, every delete keeps a noncurrent version. Give such a bucket a lifecycle rule that expires them.
- A lifecycle rule is otherwise optional. Every hour, the server deletes what unfinished uploads left under `<prefix>/uploads/`.

## A deployment that already has content

The server keeps and reads content in one place: the bucket when `CONTENT_STORE_URL` is set, and the ledger's database otherwise. It never reads the other place, and it copies nothing between them. Auto Runtime has no command that moves content from one to the other.

So a server whose ledger names content that is not where it keeps content does not start. That happens when you:

- set `CONTENT_STORE_URL` on a server whose database already holds content;
- remove `CONTENT_STORE_URL` from a server whose bucket holds content;
- point `CONTENT_STORE_URL` at another bucket or prefix, or at a bucket that was emptied;
- restore the database and the bucket from different points in time.

The server says where it keeps content, how many of the contents it looked for are kept in the other place or are not there, and what to do; [When the server does not start](configuration.md#when-the-server-does-not-start) shows the message. It never names a digest, a value or a credential.

To start again, set `CONTENT_STORE_URL`, with the endpoint, region and credentials of its bucket, as it was when that content was kept, or remove it, on every server that shares the database. Each server logs where it keeps content: `Content is kept on object storage, in the bucket <bucket> under <prefix>/, on <host>`, or `Content is kept in the ledger's database`.

## Back up

Back up the bucket alongside the database, and restore them from the same point in time. The ledger's records name their content by its digest, and that content is only in the bucket. A server whose restored bucket lacks content its records name does not start where it finds that content missing as it starts, and a record whose content is missing reads as missing.
