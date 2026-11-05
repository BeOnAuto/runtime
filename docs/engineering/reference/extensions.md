# Extension contract

This contributor reference describes how to implement an extension. Operators should use the [extension configuration reference](../../self-host/configuration.md#extensions) for installation and settings.

## Manifest and version

A package exports `manifest` with its name, version and extension points. Each point declares its contract version and implementation:

```js
export const manifest = {
  name: '@acme/forecasts',
  version: '1.0.0',
  provides: [{ point: 'capability/prediction', contract: 3, implementation: makePredictionCapability }],
};
```

This release supports `capability/prediction` with contract versions `2` and `3`. The contract is the runtime's capability contract. Its version increases with every change to its members, and the runtime keeps serving the versions before whose implementations still work.

The contract passes the playbook where a definition is saved to the capability's `check` as `place`. Contract 2 changed the members of a folder a capability returns: its `name`, the `definitionTypes` it reads, `keptAfter` and `together`. Contract 3 gives the context of a run `actsFor`, the id of the person whose sign-ins it uses, where it names one. An implementation built against 2 reads nothing of it, so the runtime serves it as before.

## Initialization and ports

The implementation is a function. The server calls it once during startup, before opening the database, with these ports:

| Port               | Provides                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database`         | The server database's `read`, `write`, `transaction` and `readConsistently` methods. Extension tables are stored in this database.                                                                   |
| `pool`             | Workers that run programs and check document expressions. The server manages and closes the pool.                                                                                                    |
| `filters`          | `verdictsOf(filters, events)` evaluates a batch of events' `data` tests using the worker pool. It returns verdicts in event order, stopping after the first event whose test was stopped.            |
| `features`         | `includes` checks whether an organization's license covers a [feature](../../self-host/licensing.md#features). `refusal` produces a `409` refusal with kind `feature_unlicensed` for unlicensed use. |
| `settings`         | The extension's own settings, described below.                                                                                                                                                       |
| `mostFunctions`    | The value of `PREDICTION_MAX_FUNCTIONS`.                                                                                                                                                             |
| `triesBeforeStall` | The number of attempts an extension folder can make to process an event before stalling. This uses the same limit as the views of pages.                                                             |

The database and feature ports become available after startup. Use them during the capability's work, not while constructing it.

## Return value

The implementation returns `{ capability, folders, operations, dueWork }`:

| Member       | Meaning                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `capability` | Required. The capability with type `prediction`.                                                    |
| `folders`    | Optional. Folders that derive extension tables from playbook events as the server's projector runs. |
| `operations` | Optional. Playbook operations beyond running definitions.                                           |
| `dueWork`    | Optional. Work dispatched by the server's wake-ups.                                                 |

### Tables and datasets

The server creates each missing folder table when it opens the database. It does not migrate extension-owned tables. Give a changed table shape a new name.

Prediction dataset tables belong to the runtime and follow its database migrations, whichever capability handles predictions. Only the capability that supplies their folder updates them. An extension using those tables includes `datasetsProvidedOn(ports)` from `@on.auto/prediction` among its folders.

### Recorded facts

Declare run facts in `facts.onRuns` with `declaredFact` from `@on.auto/definitions`. Each schema must read only the fact type it declares.

The startup database check recognizes these facts while the extension is installed. If the database holds them after the extension is removed, startup refuses the database and names their types. Its first recovery instruction is to restore the extension in `extensions`.

## Settings

An extension receives only the environment variables in its own namespace, with their prefix removed. The [configuration reference](../../self-host/configuration.md#extension-settings) describes the prefix and checks for overlapping namespaces.

## Dependencies and loading

Import contract packages by their package names:

- `@on.auto/definitions`
- `@on.auto/operations`
- `@on.auto/phrasing`
- `@on.auto/workflow-host`
- `@on.auto/workflow-engine`
- `@on.auto/meter`
- `@on.auto/prediction`
- `effect`

Declare `@on.auto/runtime` and `effect` as peer dependencies. The extension uses the release's own copies, including its instance of `effect`.

When installed beside the npm package, the launcher copies the extension into the release it runs with. It identifies a copy by npm's recorded integrity, or by its files when npm provides none. Copies have separate folders that are never removed, so a running server retains its copy.

A package that does not declare `@on.auto/runtime` is linked like any other adjacent package. It cannot import the runtime's packages. The [configuration reference](../../self-host/configuration.md#extensions) also shows installation in a container image.

## Startup validation

Startup stops and names the package if any of these conditions holds:

- The package provides a point this release does not support, or provides one point twice.
- Its contract version is one the runtime does not serve. The error names both, for example: `The extension @acme/forecasts is refused: it provides capability/prediction built against contract 1, and this runtime accepts contracts 2 to 3`.
- Its implementation is not a function, or fails while constructing the capability.
- A returned capability, folder or operation is missing a member or has a member of the wrong kind. The error names the member, for example `The extension @acme/forecasts is refused: its capability has no facts` or `its folders[0] has no fold`.
- A run-fact schema accepts types other than its declared type, or declares a fact type owned by the runtime.
- A folder cannot be opened.
- An operation is served over HTTP alone.
- The capability is not a plain object of its members, as produced by `defineCapability` from `@on.auto/definitions`.
- The capability has a type other than `prediction`.
- Two extensions fill `capability/prediction`.

A listed package that provides no point is loaded but supplies no capability.

## Package integrity

The `integrity` value is `sha512-` followed by a base64-encoded SHA-512 digest. Compute it over the package's files as follows:

1. Exclude `node_modules`, except packages named in `bundleDependencies`.
2. Sort files by the bytes of their paths relative to the package folder.
3. For each file, hash its UTF-8 path, a NUL, its byte length in decimal, a NUL, then its bytes.

A package containing a symbolic link is refused because the digest does not cover the link. When the files do not match the configured integrity, startup stops and reports their actual integrity.
