# @on.auto/prediction-contract

The contract between the prediction capability, [`@on.auto/prediction`](../../capabilities/prediction/README.md), and the model runtimes that execute the models of prediction functions, with the manifest an extension exports to provide one. It holds schemas and types, over `effect` alone, so a model runtime depends on nothing else of the runtime and the capability never learns a format's name. User documentation is [Model runtimes](../../docs/reference/model-runtimes.md); update it alongside the contract.

## The point and its version

`modelRuntimePoint` is the name of the point a model runtime fills, `prediction/model-runtime`. `modelRuntimeContract` is the version of the contract, an integer, 1, which `providedModelRuntime` writes into what a manifest provides, and `acceptedModelRuntimeContracts`, a `ContractRange` `{ least, most }`, the versions a runtime of this release accepts, 1 to 1, which the capability declares as its point's.

The contract evolves by addition, and each addition raises its version. A field a model runtime may give, a capability it may state or a kind of binding is added optional, so the schemas below still take what a runtime built against an earlier version gives; `modelRuntimeContract` rises by one with it, and the `most` of `acceptedModelRuntimeContracts` rises with it while its `least` stays where it is. A server then takes a runtime built against its own version or an earlier one, and a server older than a runtime refuses it by name, as built against a contract outside its range, rather than as an implementation its schemas do not take. A change that would break a runtime built against it, a field it must give or a field whose meaning changes, names a new point, such as `prediction/model-runtime/v2`, which the runtime serves beside the old one for a release, so the range of a point never drops a version a runtime may still be built against.

## The manifest

`ExtensionManifestSchema` is the manifest an extension's main entry exports as `manifest`, an `ExtensionManifest`: its `name`, 1 to 214 characters, the package's own, its `version`, 1 to 64, and `provides`, each a `Provision` of a `point`, the `contract` the provision was built against, a whole number, and its `implementation`, which the point's own schema checks. `providedModelRuntime(runtime)` is the `ModelRuntimeProvision` of a model runtime, its point `prediction/model-runtime` and its contract this one's.

## A model runtime

`ModelRuntimeSchema` is what a model runtime gives, a `ModelRuntime`:

- `name`, 1 to 128 characters, and `version`, 1 to 64, which every record of a model it answered names;
- `formats`, at least one `FormatSchema`, a lower-case letter, then at most 31 lower-case letters, digits and hyphens, the formats it executes;
- `capabilities`, a `ModelRuntimeCapabilities`, whether it takes a function's `features`, its `given` features ahead and the periods to the end of a total, `totals`, which a function that feeds them asks of it before the format is offered;
- `binding`, a `ModelRuntimeBinding`, `{ kind: 'process', module }`, `module` a function that answers the URL of the module a model process imports to load a model. The union holds that one kind; a remote binding is a further kind of it, added later without a break.

## The module of a binding

The module of a process binding is a `ModelRuntimeModule`: it exports `loadModel`, a `LoadModel`, `(path, threads)`, which a model process calls with the path of a model file and the intra-op threads it may use, and which answers a `LoadedModel`:

- `signature`, a `CandidateSignature`, a JSON object the runtime finds in the file, which the capability records as given (`CandidateSignatureSchema`);
- `length`, the periods of `y` the model takes, or undefined when it takes any;
- `issueFor(fed)`, given a `FedShape`, `{ features, given, horizon, totals }`, the counts of features and given features the function feeds, its longest horizon and whether it asks for a total: the model's issue with it in words, or null when the model takes it;
- `run(feeds)`, given `ModelFeeds`, each a `FedTensor` of `data` and `dims` named `y`, `x`, `given` and `h`, `h` of int64 and the others float32: a `ModelAnswer`, `{ q, dims }`, `q` the float32 10th, 50th and 90th percentiles of each step, or `{ badly }`, in words, an answer of another shape.

A load that throws refuses the candidate with the first line of what it threw, which `firstLineOf` reads, as the capability and the release's runtime read it. A load or a run that cannot allocate its memory throws a `RangeError` whose message holds `allocation failed`, so the model process stops as out of memory, and a runtime imports only what its own package ships with or depends on, since the process loads nothing else.

## What an implementation must do to be loaded

The server loads an extension when its main entry exports a `manifest` the manifest's schema takes, whose `name` is the package the server lists, each provision names a point a capability of the server declares, with a contract that point's range accepts, and each implementation is one its point takes: for `prediction/model-runtime`, a value `ModelRuntimeSchema` takes, whose binding names, without throwing, a module that is a file. [Model runtimes](../../docs/reference/model-runtimes.md#what-the-server-checks-as-it-starts) lists how it refuses one that does not.

## Testing

`src/runtime/model-runtime.test.ts`, `src/runtime/loaded-model.test.ts`, `src/extension/extension-manifest.test.ts` and `src/words/first-lines.test.ts` hold each schema to what it takes and refuses.

## Source

`src/index.ts` is the entry point. `src/contract` holds the point's name, the contract's version and the range accepted; `src/extension` the manifest and the provision of a model runtime; `src/runtime` a model runtime, its binding, its module, a loaded model and what it is fed and answers; and `src/words` the first line of a failure.
