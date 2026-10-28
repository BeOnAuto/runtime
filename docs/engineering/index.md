# Runtime engineering guides

These repository-only guides describe the development checkout for contributors. They are excluded from the public documentation build and search. Start with the [local quick start](../get-started/local.md) to try Auto. To run and operate the runtime, follow the public [self-hosting guides](../self-host.md).

Workflows run in the server itself, on the workflow engine of `@on.auto/workflow-engine` hosted in Node by `@on.auto/workflow-host`, and are kept in the ledger's database. Auto's hosted runtime is maintained in the Studio repository. These guides describe the setup and the limitations of the current code.

## Run the checkout

- [Local quickstart](get-started/self-hosted.md)
- [Install from source](self-host/installation.md)

The public self-hosting guides cover [running the image](../self-host/docker.md), [PostgreSQL](../self-host/postgresql.md), [object storage](../self-host/object-storage.md), [deploying for a team](../self-host/production.md), [configuration](../self-host/configuration.md), [models and gateways](../self-host/models.md), [authentication and security](../self-host/security.md), [workflow storage and failover](../self-host/workflows.md) and [troubleshooting](../self-host/troubleshooting.md).

## Implementation reference

- [HTTP API](../reference/http.md), the public reference, and the [OpenAPI document](../reference/http.md#the-openapi-document-the-guides-and-the-api-catalog) a running server answers at `/v1/openapi.json`, and the API catalog at `/.well-known/api-catalog` that leads to it; [HTTP walkthrough](reference/http-tutorial.md)
- [MCP transport and tool behavior](reference/mcp.md)
- [Complete reasoning function format](reference/reasoning-format.md)
- [Model access internals](reference/models.md): the library functions, reports and catalog behind [Set up a model provider](../self-host/models.md) and the [model settings reference](../reference/model-settings.md)
- [Workflow format and runs](reference/workflow-format.md)

Keep these notes accurate when changing the runtime. Publish the relevant user-facing behavior separately in the public guides. Package READMEs retain code entry points and test instructions.
