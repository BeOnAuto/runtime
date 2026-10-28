<div v-pre>

# Model runtimes

A model runtime executes the models of [prediction functions](prediction-format.md) in one or more formats. It checks a candidate a trainer uploads against what the function feeds, loads the model, and answers the 10th, 50th and 90th percentiles of each step ahead, in a model process of the server that sees only the file it loads and what it is fed. The function, its dataset, the scoring of the candidates, the shadow and the questions are the runtime's and stay the same whatever the format; the model runtime is what executes the file.

The release carries one model runtime, for the format `onnx`: [ONNX](https://onnx.ai) models, run by onnxruntime-node, from the package `@on.auto/prediction-onnx`. A server can load more, each from a package named in its settings, which is an **extension**.

## What a candidate records

A candidate names its format as it is uploaded, `POST /runs/{run_id}/build/candidates?format=onnx`, and a server takes only a format one of its model runtimes executes for the function. The runtime that executes it is recorded beside what it answered:

| Record                      | What it holds                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `candidate_uploaded`        | The candidate's `format`, the `runtime` that checked it, by `name` and `version`, and the `signature` it found |
| `candidate_scored`          | The `runtime` that walked the candidate                                                                        |
| The card of `version_built` | `file.format` and `file.runtime`, the runtime that scored the winner, and the `signature`                      |
| `version_activated`         | `file_format`, the format of the version's file                                                                |
| `shadow_predicted`          | The `runtime` that answered, null when no runtime of the server executes the version's format                  |
| The record of a question    | The `runtime` that answered                                                                                    |

The brief of a build closes with the formats an upload takes, and the server keeps a model file under a name that carries its format, `models/<sha256>/model.<format>`. A version whose format no runtime of the server executes any more is refused at a question, `unavailable` with the kind `model_process_failed` and `because` `no_model_runtime`; a candidate in that format is disqualified `not_loaded`.

## List the extensions

`extensions` in the [configuration file](../self-host/configuration.md#write-the-configuration-file) lists the packages the server loads as extensions, in order of precedence. `AUTO_RUNTIME_EXTENSIONS`, the same list as JSON, wins over it.

```yaml
extensions:
  - package: '@acme/prediction-models'
    integrity: sha512-<the base64 a refused start names>
```

| Field       | What it holds                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package`   | The name of an installed package, which the server imports by that name                                                                                                                                                                                                                   |
| `integrity` | Optional. `sha512-` and the base64 of the SHA-512 of the package's own files and of the dependencies it bundles, so a package whose files or bundled dependencies differ is refused; a dependency it does not bundle is not covered, as [the integrity](#the-integrity-of-a-package) says |

The server imports a package by its name, as Node resolves a name from the server's own folder, so the package is installed beside `@on.auto/runtime`, as `npm install @on.auto/runtime @acme/prediction-models` installs both. The server never searches a folder for extensions; it loads what the list names and the extensions of the release.

The extensions of the release stand after the ones the list names. They are listed by default exactly as one the list names would be: the release's ONNX runtime is the package `@on.auto/prediction-onnx`, and a list that names it moves it ahead, with an `integrity` when it gives one.

### Precedence

Two runtimes that execute one format are resolved by their order: the first executes it. A package the list names executes a format before the release's runtime of that format does, and the second of two listed packages executes only the formats the first does not. A format whose runtime does not take what a function feeds, its features, its `given` features or its total, is not offered to that function, and an upload in it is refused.

## What the server checks as it starts

The server loads each extension as it starts, in order, and stops at the first it refuses, with one line that names the package and why:

```
Auto Runtime could not start: ExtensionRefused: The extension @acme/prediction-models is refused: it provides prediction/model-runtime built against contract 2, and this runtime accepts contracts 1 to 1
```

It refuses a package:

- whose installed files do not have the `integrity` the list gives, naming the integrity of the files installed;
- that cannot be imported by its name;
- that exports no `manifest`;
- whose manifest is malformed;
- whose manifest names a package other than the one listed;
- that provides a point no capability of the runtime declares; the one point declared is `prediction/model-runtime`;
- that provides a point built against a contract outside the range the runtime accepts;
- whose implementation is not one of its point, such as a model runtime that names no format, or one whose binding throws as it names its module.

The server logs the extensions it loaded, each with its version, whether the list named it or it is the release's, and the points it fills:

```
Extensions loaded, in their order of precedence: @on.auto/prediction-onnx <the release's version>, of the release, filling prediction/model-runtime
```

### The integrity of a package

The integrity is the SHA-512 of the package's files, written `sha512-` and its base64:

1. The files are every file under the folder of the installed package, the folder whose `package.json` names it, except those under a `node_modules` folder within it, and every file under `node_modules/<name>` within it for each `<name>` its `package.json` lists in `bundleDependencies` or `bundledDependencies`, or for each of its `dependencies` when that field is `true`. A dependency the package does not bundle, whether npm installed it beside the package or under the package's own `node_modules`, is not covered.
2. Each is named by its path relative to that folder, with `/` between its parts, and the files are sorted by the UTF-8 bytes of that path.
3. For each file in that order, the hash takes its path in UTF-8, a byte 0, its length in bytes as decimal digits, a byte 0, and its bytes.

A package that holds a symbolic link is refused when an `integrity` is given, since the hash would not cover what the link points at. A start the integrity refuses names the integrity of the files installed, so a package can be pinned once its files have been checked another way.

## The contract

A model runtime is written against the contract of the point `prediction/model-runtime`, which the package `@on.auto/prediction-contract` of the release holds as schemas and types. The contract has a version, an integer, 1 in this release, and the runtime accepts the range `1` to `1`. It changes by addition, and each addition raises it: a field or a capability a runtime may give, or a kind of binding, raises the version by one and the top of the range with it, while the bottom of the range stays where it is. A runtime built against an earlier version still loads, and a server older than a runtime refuses it, naming the contract the runtime was built against and the range the server accepts. A change that would break a runtime built against it names a new point instead, which the runtime serves beside the old one for a release.

### What an extension exports

An extension's main entry exports `manifest`, plain values the server checks as it loads them:

```js
export const manifest = {
  name: '@acme/prediction-models',
  version: '1.0.0',
  provides: [
    {
      point: 'prediction/model-runtime',
      contract: 1,
      implementation: {
        name: 'acme-runtime',
        version: '1.0.0',
        formats: ['acme'],
        capabilities: { features: true, given: true, totals: true },
        binding: { kind: 'process', module: () => new URL('./models.js', import.meta.url) },
      },
    },
  ],
};
```

The contract package ships inside the release rather than on its own, so an extension installed beside it imports nothing from it and writes these values itself. Within the release, its types are `ExtensionManifest` and `ModelRuntime`, and `providedModelRuntime(runtime)` writes the provision with the contract's version, as the release's ONNX runtime is written.

| Field of the manifest | What it holds                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `name`, `version`     | The package and its version, which the server logs                                                      |
| `provides`            | Each point the package fills: its `point`, the `contract` it was built against and its `implementation` |

| Field of a model runtime | What it holds                                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `version`        | The runtime, which every record of a model it answered names                                                                                                            |
| `formats`                | The formats it executes, each a lower-case letter, then at most 31 lower-case letters, digits and hyphens                                                               |
| `capabilities`           | Whether it takes the features of a function, `features`, its `given` features ahead, `given`, and the periods to the end of a total, `totals`                           |
| `binding`                | `{ kind: 'process', module }`: a function that answers the URL of a file, the module a model process imports to load a model. Another kind is room for a later contract |

### The module a model process loads

The module of the binding exports `loadModel(path, threads)`. A model process of the server imports it and calls it with the path of the model file, kept in the server's cache folder under a folder of its own, and the threads the process may use. It answers a loaded model:

| Field of a loaded model | What it holds                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signature`             | A JSON object the runtime finds in the file, which the playbook records as given                                                                                                                                           |
| `length`                | The periods of `y` the model takes, or undefined when it takes any                                                                                                                                                         |
| `issueFor(fed)`         | The issue of the model with what the function feeds, `{ features, given, horizon, totals }`, in words, or null when it takes it                                                                                            |
| `run(feeds)`            | The answer to `y`, `x`, `given` and `h`, as [the signature of a candidate](prediction-format.md#the-signature-of-a-candidate) names them: `{ q, dims }`, `q` the float32 percentiles of each step, or `{ badly }` in words |

A load that fails refuses the candidate as `failed_to_load`, with the first line of what it threw. A load or a run that cannot allocate its memory throws a `RangeError` whose message holds `allocation failed`, so the process ends out of memory. The process runs under the limits of every model process, `PREDICTION_PROCESS_MEMORY` and the deadlines of [the bounds](prediction-format.md#bounds), and the module imports only what its package ships with or depends on.

</div>
