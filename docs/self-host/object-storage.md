---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Keep content on object storage

By default, the content a playbook keeps is stored in the ledger's database. Set `CONTENT_STORE_URL` to an `s3://bucket/prefix` URL, and the server keeps that content in an S3 bucket instead. Every other record stays in the ledger.

Choose before content builds up. The server moves nothing between the database and the bucket, so content kept before a switch is no longer read; see [Switch a deployment that already has content](#switch-a-deployment-that-already-has-content).

Content is what grows large:

- a tool's arguments and results;
- a prediction function's uploaded datasets;
- the rows and the brief of each build;
- the model file of each version.

Moving content out keeps the database small and its backups fast. The server keeps one object for each piece of content, under its playbook and its SHA-256. A build's candidates are staged under `<prefix>/staging/` and deleted when the build ends.

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

Several servers may share a bucket and a prefix, as they share the ledger's database.

### Versioning and lifecycle

- Versioning is not required.
- On a bucket with versioning on, every delete keeps a noncurrent version. Give such a bucket a lifecycle rule that expires them.
- A lifecycle rule is otherwise optional. Every hour, the server deletes what unfinished uploads left under `<prefix>/uploads/`.

## Switch a deployment that already has content

The server keeps and reads content in one place: the bucket when `CONTENT_STORE_URL` is set, and the ledger's database otherwise. It never reads the other place, and it copies nothing between them. Auto Runtime has no command that moves content from one to the other.

So when you set `CONTENT_STORE_URL` on a server whose database already holds content:

- New content goes to the bucket.
- The content already in the database stays there, unchanged, but the server no longer reads it.
- Tool calls made before the switch still appear in the history, with their sizes and digests, but without their arguments and results.
- A prediction function cannot read a dataset or model file kept before the switch, so its builds and questions fail. Files the server still holds in its `PREDICTION_CACHE_DIR` cache can be used until the cache drops them.
- A build still open at the switch cannot read the candidates staged for it.

Removing `CONTENT_STORE_URL` has the same effect the other way. The server goes back to the database, and what it kept in the bucket is no longer read.

To switch:

1. Stop every server that shares the database. They must all keep content in the same place, or one cannot read what another kept.
2. Set `CONTENT_STORE_URL`, with the endpoint, region and credentials the bucket needs, for every server. To switch back, remove it.
3. Start the servers. Each logs where it keeps content: `Content is kept on object storage, in the bucket <bucket> under <prefix>/, on <host>`, or `Content is kept in the ledger's database`.
4. For each prediction function, upload its dataset again and ask for a build, so that it has a model the server can read.

To roll back, switch back the same way. The content kept in the old place becomes readable again, and content kept in the new place since the switch is no longer read. Setting the same bucket and prefix again makes the bucket's content readable once more. So keep both the database's content and the bucket until you no longer need to go back.

## Back up

Back up the bucket alongside the database, and restore them from the same point in time. The ledger's records name their content by its digest, and that content is only in the bucket. A record whose content the restored bucket lacks reads as one kept before a switch.
