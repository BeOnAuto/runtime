# @on.auto/prediction-contract

The contract between the prediction capability, [`@on.auto/prediction`](../../capabilities/prediction/README.md), and the model runtimes that execute the models of prediction functions, with the manifest an extension exports to provide one. It holds schemas and types, over `effect` alone, so a model runtime depends on nothing else of the runtime and the capability never learns a format's name. User documentation is [Model runtimes](../../docs/reference/model-runtimes.md); update it alongside the contract.

## The package

This package is the contract an implementation is built against, on npm with a version line of its own. Release-please releases it as the component `prediction-contract`, tagged `prediction-contract-v<version>`, with its own `CHANGELOG.md`, from 1.0.0, and only a commit that touches this folder raises it; the `contract-package` job of `.github/workflows/release.yml` publishes each version through npm trusted publishing and skips one already on npm. Its version is the package's and the contract's version is the integer below: a release that changes the package raises the first, and an addition to the contract raises the second. The runtime's own package carries its own copy of it, as it carries every package of the server, and its license is the repository's, Elastic-2.0.

An implementation names it as a peer dependency, `"@on.auto/prediction-contract": "^1"`, imports its schemas and types, and writes into its manifest the contract's version it was built against, the integer, itself: `providedModelRuntime` writes `modelRuntimeContract` of the copy installed beside the implementation, which `^1` may resolve to a later one, so only the release's own runtimes, shipped with the release's copy, use it. Its schemas need `effect` as they run, so `effect` is a dependency of the package, and an implementation that imports only its types loads none of it. The contract's declarations use `effect`'s, which need TypeScript's `esnext.disposable` library, which a `target` of `esnext` includes, as do the types of Node, `@types/node`, which reference it.

The repository imports the package's `src/index.ts`, as `exports` names it. What is published is JavaScript with declaration files, since Node does not strip types from a file under `node_modules`: `build` runs `tsc` with `tsconfig.build.json`, which writes `dist` from `src` without its tests, its imports ending in `.js` and no source maps, and `publishConfig.exports`, which pnpm writes into the published manifest, names `dist/index.d.ts` for types and `dist/index.js` for the rest. `prepublishOnly` runs `build`, so every publish, the release workflow's and one by hand, ships the `dist` it has just written.

## The point and its version

`modelRuntimePoint` is the name of the point a model runtime fills, `prediction/model-runtime`. `modelRuntimeContract` is the version of the contract, an integer, 2, which `providedModelRuntime` writes into what a manifest provides, and `acceptedModelRuntimeContracts`, a `ContractRange` `{ least, most }`, the versions a runtime of this release accepts, 1 to 2, which the capability declares as its point's.

The contract evolves by addition, and each addition raises its version. A field a model runtime may give, a capability it may state or a kind of binding is added optional, so the schemas below still take what a runtime built against an earlier version gives; `modelRuntimeContract` rises by one with it, and the `most` of `acceptedModelRuntimeContracts` rises with it while its `least` stays where it is. A server then takes a runtime built against its own version or an earlier one, and a server older than a runtime refuses it by name, as built against a contract outside its range, rather than as an implementation its schemas do not take. A change that would break a runtime built against it, a field it must give or a field whose meaning changes, names a new point, such as `prediction/model-runtime/v2`, which the runtime serves beside the old one for a release, so the range of a point never drops a version a runtime may still be built against.

Version 2 added, by that rule: the binding `inline`, for the release's own extensions alone; the capabilities `calendar` and `fits`, both optional; the feed `at`; and the exports `fitModels` and `defaultModel` of the module of a runtime that `fits`. A runtime built against version 1 gives none of them, decodes as it did and is fed as it was.

## The manifest

`ExtensionManifestSchema` is the manifest an extension's main entry exports as `manifest`, an `ExtensionManifest`: its `name`, 1 to 214 characters, the package's own, its `version`, 1 to 64, and `provides`, each a `Provision` of a `point`, the `contract` the provision was built against, a whole number, and its `implementation`, which the point's own schema checks. `providedModelRuntime(runtime)` is the `ModelRuntimeProvision` of a model runtime, its point `prediction/model-runtime` and its contract the `modelRuntimeContract` of the copy of this package it is imported from, not the version a runtime was built against: it is for the release's own runtimes, `@on.auto/prediction-onnx` and `@on.auto/prediction-series`, which ship with the release's copy, and an implementation outside the repository writes its contract itself.

## A model runtime

`ModelRuntimeSchema` is what a model runtime gives, a `ModelRuntime`:

- `name`, 1 to 128 characters, and `version`, 1 to 64, which every record of a model it answered names;
- `formats`, at least one `FormatSchema`, a lower-case letter, then at most 31 lower-case letters, digits and hyphens, the formats it executes;
- `capabilities`, a `ModelRuntimeCapabilities`, whether it takes a function's `features`, its `given` features ahead and the periods to the end of a total, `totals`, which a function that feeds them asks of it before the format is offered; and, optionally, whether it reads the period of each origin, `calendar`, and whether it fits its own models, `fits`;
- `binding`, a `ModelRuntimeBinding`, `{ kind: 'process', module }` or `{ kind: 'inline', module }`, `module` a function that answers the URL of the module that loads a model: a model process imports the module of a process binding, and the server imports the module of an inline binding into its own process. An inline binding is the release's alone: the server refuses an extension that is not one of the release's own and gives one, since an extension's runtime runs in a model process, under its limits. In the server's own process no limit bounds a job's memory and nothing stops a job but the job itself: the server answers `timed_out` at its deadline and signals it to stop, and a job that does not yield holds the server until it ends. A remote binding is a further kind of the union, added later without a break.

## The module of a binding

The module of a binding is a `ModelRuntimeModule`: it exports `loadModel`, a `LoadModel`, `(path, threads)`, which a model process, or the server for an inline binding, calls with the path of a model file and the intra-op threads it may use, and which answers a `LoadedModel`:

- `signature`, a `CandidateSignature`, a JSON object the runtime finds in the file, which the capability records as given (`CandidateSignatureSchema`);
- `length`, the periods of `y` the model takes, or undefined when it takes any;
- `issueFor(fed)`, given a `FedShape`, `{ features, given, horizon, totals }`, the counts of features and given features the function feeds, its longest horizon and whether it asks for a total: the model's issue with it in words, or null when the model takes it;
- `run(feeds)`, given `ModelFeeds`, each a `FedTensor` of `data` and `dims` named `y`, `x`, `given`, `h` and `at`, `h` and `at` of int64 and the others float32: a `ModelAnswer`, `{ q, dims }`, `q` the float32 10th, 50th and 90th percentiles of each step, or `{ badly }`, in words, an answer of another shape. `at`, `[1]`, is the index of the origin's period, fed only to a runtime that states `calendar`: the days since 1970-01-01 of a day, the week whose Thursday falls 7 times that many days after it, the year times 12 plus the month from 0, the year times 4 plus the quarter from 0, and the year.

The module of a runtime that states `fits` also exports `fitModels`, a `FitModels`, `(shape, training)`, and `defaultModel`, a `DefaultModel`, `(shape)`. `shape` is a `FunctionShape`, `{ fed, grain, season, accumulates, holdout }`, what the function is; `training` is `TrainingRows`, `{ first, series }`, the index of the training rows' first period and the target of each series over them, NaN where a period was not observed. `fitModels` answers the `FittedModel`s it fits, each `{ format, bytes }` in one of its formats, which a build uploads as candidates; `defaultModel` answers the one a function with no active version answers from.

A load that throws refuses the candidate with the first line of what it threw, which `firstLineOf` reads, as the capability and the release's runtime read it. A load or a run that cannot allocate its memory throws a `RangeError` whose message holds `allocation failed`, so the model process stops as out of memory, or a job of an inline binding ends as out of memory, and a runtime imports only what its own package ships with or depends on, since the process loads nothing else.

## What an implementation must do to be loaded

The server loads an extension when its main entry exports a `manifest` the manifest's schema takes, whose `name` is the package the server lists, each provision names a point a capability of the server declares, with a contract that point's range accepts, and each implementation is one its point takes: for `prediction/model-runtime`, a value `ModelRuntimeSchema` takes, whose binding names, without throwing, a module that is a file, and is a process binding unless the extension is one of the release's own. [Model runtimes](../../docs/reference/model-runtimes.md#what-the-server-checks-as-it-starts) lists how it refuses one that does not.

## Testing

`src/runtime/model-runtime.test.ts`, `src/runtime/loaded-model.test.ts`, `src/extension/extension-manifest.test.ts` and `src/words/first-lines.test.ts` hold each schema to what it takes and refuses.

## Source

`src/index.ts` is the entry point. `src/contract` holds the point's name, the contract's version and the range accepted; `src/extension` the manifest and the provision of a model runtime; `src/runtime` a model runtime, its binding, its module, a loaded model and what it is fed and answers; and `src/words` the first line of a failure.
