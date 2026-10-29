<div v-pre>

# Model runtimes

A model runtime executes the models of [prediction functions](prediction-format.md) in one or more formats. It checks a candidate a trainer uploads against what the function feeds, loads the model, and answers the 10th, 50th and 90th percentiles of each step ahead, in a model process of the server that sees only the file it loads and what it is fed, or in the server's own process. The function, its dataset, the scoring of the candidates, the shadow and the questions are the runtime's and stay the same whatever the format; the model runtime is what executes the file.

The release carries one model runtime, the only one of its format:

| Runtime  | Format   | Package                      | What it executes                                                                                                                                                                                                                                                        |
| -------- | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `series` | `series` | `@on.auto/prediction-series` | [The runtime's own models](prediction-format.md#the-runtime-s-own-models): JSON recipes it executes in TypeScript, in the server's own process. It also fits them from a build's training rows, and answers a function with no active version from its default forecast |

A server can load more, each from a package named in its settings, which is an **extension**. ONNX models are executed by the ONNX model runtime, `@on.auto/prediction-onnx`, which is licensed separately and is not part of this repository; it names the feature `prediction-onnx`, so it does its work only while the runtime's license includes that feature, as [A runtime that needs a feature](#a-runtime-that-needs-a-feature) says.

## What a candidate records

A candidate names its format as it is uploaded, `POST /runs/{run_id}/build/candidates?format=series`, and a server takes only a format one of its model runtimes executes for the function. The runtime that executes it is recorded beside what it answered:

| Record                      | What it holds                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate_uploaded`        | The candidate's `format`, the `runtime` that checked it, by `name` and `version`, and the `signature` it found                                                                                              |
| `candidate_scored`          | The `runtime` that walked the candidate                                                                                                                                                                     |
| `candidate_disqualified`    | `because: feature_unlicensed` and the `feature`, for a candidate whose runtime needs a feature the license lacks                                                                                            |
| The card of `version_built` | `file.format` and `file.runtime`, the runtime that scored the winner, and the `signature`                                                                                                                   |
| `version_activated`         | `file_format`, the format of the version's file                                                                                                                                                             |
| `candidates_fitted`         | The `runtime` that fitted a build's candidates itself, and the candidates it fitted                                                                                                                         |
| `shadow_predicted`          | The `runtime` that answered, null when no runtime of the server executes the version's format, or with `because: feature_unlicensed` and the `feature` when its runtime needs a feature the license lacks   |
| The record of a question    | The `runtime` that answered, and `default_forecast` when no version was active, or with `because: feature_unlicensed` and the `feature` when the active version's runtime needs a feature the license lacks |

The brief of a build closes with the formats an upload takes, which leave out the formats of a runtime that needs a feature the license lacks, and the server keeps a model file under a name that carries its format, `models/<sha256>/model.<format>`. A version whose format no runtime of the server executes any more is refused at a question, `unavailable` with the kind `model_process_failed` and `because` `no_model_runtime`; a candidate in that format is disqualified `not_loaded`.

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

The server imports a package by its name, as Node resolves a name from the server's own folder, so the package is installed beside `@on.auto/runtime`, as `npm install @on.auto/runtime @acme/prediction-models` installs both. The server never searches a folder for extensions; it loads what the list names and the extension of the release.

The extension of the release stands after the ones the list names. It is listed by default exactly as one the list names would be: the runtime of the release's own models is the package `@on.auto/prediction-series`, and a list that names it moves it ahead, with an `integrity` when it gives one.

### Precedence

Two runtimes that execute one format are resolved by their order: the first executes it. A package the list names executes a format before the release's runtime of that format does, and the second of two listed packages executes only the formats the first does not. A format whose runtime does not take what a function feeds, its features, its `given` features or its total, is not offered to that function, and an upload in it is refused. The runtime that fits a build's candidates and answers a function with no active version is the first that states `fits` and takes what the function feeds.

## What the server checks as it starts

The server loads each extension as it starts, in order, and stops at the first it refuses, with one line that names the package and why:

```text
Auto Runtime could not start: ExtensionRefused: The extension @acme/prediction-models is refused: it provides prediction/model-runtime built against contract 4, and this runtime accepts contracts 1 to 3
```

It refuses a package:

- whose installed files do not have the `integrity` the list gives, naming the integrity of the files installed;
- that cannot be imported by its name;
- that exports no `manifest`;
- whose manifest is malformed;
- whose manifest names a package other than the one listed;
- that provides a point no capability of the runtime declares; the one point declared is `prediction/model-runtime`;
- that provides a point built against a contract outside the range the runtime accepts;
- whose implementation is not one of its point, such as a model runtime that names no format, or one whose binding throws as it names its module;
- that is not one of the release's own and provides a model runtime bound `inline`, since an extension's runtime runs in a model process.

The server logs the extensions it loaded, each with its version, whether the list named it or it is the release's, and the points it fills:

```text
Extensions loaded, in their order of precedence: @on.auto/prediction-series <the release's version>, of the release, filling prediction/model-runtime
```

### The integrity of a package

The integrity is the SHA-512 of the package's files, written `sha512-` and its base64:

1. The files are every file under the folder of the installed package, the folder whose `package.json` names it, except those under a `node_modules` folder within it, and every file under `node_modules/<name>` within it for each `<name>` its `package.json` lists in `bundleDependencies` or `bundledDependencies`, or for each of its `dependencies` when that field is `true`. A dependency the package does not bundle, whether npm installed it beside the package or under the package's own `node_modules`, is not covered.
2. Each is named by its path relative to that folder, with `/` between its parts, and the files are sorted by the UTF-8 bytes of that path.
3. For each file in that order, the hash takes its path in UTF-8, a byte 0, its length in bytes as decimal digits, a byte 0, and its bytes.

A package that holds a symbolic link is refused when an `integrity` is given, since the hash would not cover what the link points at. A start the integrity refuses names the integrity of the files installed, so a package can be pinned once its files have been checked another way.

## The contract

A model runtime is written against the contract of the point `prediction/model-runtime`, which the package `@on.auto/prediction-contract` holds as schemas and types. The package is on npm with a version line of its own, and the release carries its own copy of it. The contract has a version, an integer, 3 in this release, and the runtime accepts the range `1` to `3`. It changes by addition, and each addition raises it: a field or a capability a runtime may give, or a kind of binding, raises the version by one and the top of the range with it, while the bottom of the range stays where it is. A runtime built against an earlier version still loads, and a server older than a runtime refuses it, naming the contract the runtime was built against and the range the server accepts. A change that would break a runtime built against it names a new point instead, which the runtime serves beside the old one for a release.

Version 2 added, to version 1:

- the binding `inline`, whose module the server imports into its own process, for the release's own extensions alone;
- the capabilities `calendar`, a runtime fed the period of each origin as `at`, and `fits`, a runtime that fits its own models and answers a function with no active version;
- the exports `fitModels` and `defaultModel` of the module of a runtime that `fits`.

A runtime built against version 1 gives none of them and loads as it did.

Version 3 added, to version 2, the optional `feature` of a runtime, the feature of the license its work needs. A runtime built against version 1 or 2 names none, and a runtime that names none is never gated.

### What an extension exports

An extension's main entry exports `manifest`, plain values the server checks as it loads them:

```js
export const manifest = {
  name: '@acme/prediction-models',
  version: '1.0.0',
  provides: [
    {
      point: 'prediction/model-runtime',
      contract: 3,
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

An extension adds the package as a peer dependency, `"@on.auto/prediction-contract": "^1"`, and imports its schemas and types: `ExtensionManifest` and `ModelRuntime` are the types of these values, and `ExtensionManifestSchema` and `ModelRuntimeSchema` the schemas the server checks them with. The contract's declarations use `effect`'s, which need TypeScript's `esnext.disposable` library, which a `target` of `esnext` includes, as do the types of Node, `@types/node`, which reference it. The package's version is the package's own, which rises with each release that changes the package; the contract's version is the integer above, which rises by addition. The extension writes the contract's version it was built against into its manifest itself, as `contract: 3` above, since `providedModelRuntime(runtime)` writes the version of the copy of the package installed beside it, which `^1` may resolve to a later one; the release's own runtimes, built and shipped with the release's copy, use it.

| Field of the manifest | What it holds                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `name`, `version`     | The package and its version, which the server logs                                                      |
| `provides`            | Each point the package fills: its `point`, the `contract` it was built against and its `implementation` |

| Field of a model runtime | What it holds                                                                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `version`        | The runtime, which every record of a model it answered names                                                                                                                                                                                                                                              |
| `formats`                | The formats it executes, each a lower-case letter, then at most 31 lower-case letters, digits and hyphens                                                                                                                                                                                                 |
| `capabilities`           | Whether it takes the features of a function, `features`, its `given` features ahead, `given`, and the periods to the end of a total, `totals`; optionally whether it reads the period of each origin, `calendar`, and whether it fits its own models, `fits`                                              |
| `feature`                | Optional. The feature of the license the runtime's work needs, a lower-case letter, then at most 31 lower-case letters, digits and hyphens, as [A runtime that needs a feature](#a-runtime-that-needs-a-feature) says; the release's `series` names none                                                  |
| `binding`                | `{ kind: 'process', module }` or `{ kind: 'inline', module }`: a function that answers the URL of a file, the module that loads a model. A model process imports a process binding's module; the server imports an inline binding's module into its own process, and only for an extension of the release |

### The module of a binding

The module of the binding exports `loadModel(path, threads)`. For a `process` binding, a model process of the server imports it; for an `inline` binding, the server imports it into its own process, through the same jobs a model process serves. Either way it is called with the path of the model file, kept in the server's cache folder under a folder of its own, and the threads it may use. It answers a loaded model:

| Field of a loaded model | What it holds                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `signature`             | A JSON object the runtime finds in the file, which the playbook records as given                                                |
| `length`                | The periods of `y` the model takes, or undefined when it takes any                                                              |
| `issueFor(fed)`         | The issue of the model with what the function feeds, `{ features, given, horizon, totals }`, in words, or null when it takes it |
| `run(feeds)`            | The answer to the feeds below: `{ q, dims }`, `q` the float32 percentiles of each step, or `{ badly }` in words                 |

Each feed is `{ data, dims }`, what [the signature of a candidate](prediction-format.md#the-signature-of-a-candidate) says a candidate is fed at an origin:

| Feed    | `dims`      | `data`  | What it holds                                                                                                       |
| ------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `y`     | `[1, L]`    | float32 | The target over the `L` periods up to the origin, the model's `length` when it gives one; `NaN` where none observed |
| `x`     | `[1, L, F]` | float32 | The `F` features over the same periods, in the document's order, fed when the function names features               |
| `given` | `[1, H, G]` | float32 | The `G` `given` features for the `H` periods ahead, in the document's order, fed when the function names `given`    |
| `h`     | `[1]`       | int64   | With `accumulates`, how many periods the total sums                                                                 |
| `at`    | `[1]`       | int64   | The index of the origin's period, below                                                                             |

`q` is `[1, H, 3]`, the 10th, 50th and 90th percentile of each of the `H` steps ahead, `H` the longest horizon, or `[1, 1, 3]` for a total.

`at` is fed to a runtime that states `calendar` and to no other: for a day, the days since 1970-01-01; for a week, the number of the week whose Thursday falls 7 times that many days after 1970-01-01, weeks running from Monday as ISO 8601 numbers them; for a month, the year times 12 plus the month from 0; for a quarter, the year times 4 plus the quarter from 0; and for a year, the year.

A load that fails refuses the candidate as `failed_to_load`, with the first line of what it threw. A load or a run that cannot allocate its memory throws a `RangeError` whose message holds `allocation failed`, so its job ends out of memory, and the module imports only what its package ships with or depends on.

A model process runs under the limits of every model process, `PREDICTION_PROCESS_MEMORY` and the deadlines of [the bounds](prediction-format.md#bounds). An inline binding runs inside the server's own process, which is why only the release's own extensions may give one: no process limit bounds its memory, and nothing can stop a job but the job itself. The server admits its jobs as it admits a model process's, as many at once as it has model processes and as many long jobs as `PREDICTION_BUILDS_AT_ONCE`, and answers `timed_out` at a job's deadline and signals the job to stop; a walk stops at the next series, while a check, a run, a fit and a default forecast run to their end, and a job that never yields holds the server's event loop until it does. So the runtime itself is the bound: the release's `series` runtime takes a recipe of at most 16 KiB, reads no more than the rows a job hands it, and its walk over the widest rows the bounds admit took about 190 MiB more resident memory at its peak.

### A runtime that fits its own models

A runtime that states `fits` exports two more functions from the module of its binding, which the server calls through the same binding:

| Export                       | What it answers                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultModel(shape)`        | `{ format, bytes }`, the model a function with no active version answers from, in one of the runtime's formats                                                         |
| `fitModels(shape, training)` | A list of `{ format, bytes }`, the models it fits from a build's training rows, which a build with no trainer, or whose trainer names no candidate, uploads and scores |

`shape` is what the function is: `fed`, as `issueFor` takes it; `grain`, the period of its target; `season`, or null; `accumulates`, the enclosing period of a total, or null; and `holdout`, the periods a build holds back. `training` is `{ first, series }`: `first`, the index of the training rows' first period, as `at` counts it, and `series`, the target of each series over the training periods, NaN where a period was not observed. Each model is uploaded to the build as a trainer's candidate is, checked by the runtime of its format, and scored; [What a build does without a trainer](prediction-format.md#what-a-build-does-without-a-trainer) says how.

### A runtime that needs a feature

A runtime that names a `feature` does its work only while the runtime's license includes that [feature](../self-host/licenses.md#features) for the org whose function it serves. The server checks the feature at every piece of the runtime's work as it starts, the check of a candidate, a question's run, a walk, a fit and a default forecast, so no path executes it without the feature. While the license does not include it:

- a build leaves the runtime's formats out of the formats its brief offers, and an upload in one of them is refused before its body is read, `conflict` with the kind `feature_unlicensed`, in words that name the feature, the format and where to add the feature, `This runtime's license does not include prediction-onnx, which executes onnx models. The account holder or an organization admin can add it at <page>.`, with the page in `resolve_at`; one that lapses while the candidate is checked is refused the same way, recording nothing;
- a candidate in one of its formats that a build has not scored yet is disqualified `feature_unlicensed`, with those words and the `feature`, and never walked; a model a build fits itself in one of its formats is refused, `candidate_refused` with `because: feature_unlicensed` and those words;
- a version in one of its formats is not walked in a shadow: its `shadow_predicted` names no `runtime`, counts nothing, and says `because: feature_unlicensed` with the `feature`; the close decides nothing and uses up none of the shadow's closes, which go on, within the most of 52, once the feature is back, so a lapse never decides which version is active;
- a question whose active version is in one of its formats is answered by the [default forecast](prediction-format.md#the-default-forecast), whose record says `because: feature_unlicensed` and the `feature`, or refused `conflict`, `feature_unlicensed`, where no runtime of the server answers a default forecast for the function; a default forecast whose model is in one of its formats is refused the same way;
- the runtime does not fit a build's candidates or the default forecast; the next runtime that fits and takes what the function feeds does.

So a license that lapses stops nothing: each function answers from the runtime's own models until a license that includes the feature is in force again, and then from its active version. The formats of a runtime that names no feature, as the release's `series`, are never gated, and every record of a model a runtime answered keeps naming that runtime's `name` and `version`. A server that cannot read its license to check a feature answers `unavailable` with the kind `meter_unavailable`, and a build waits a minute and tries again.

## The runtime's own models

The release's `series` runtime executes the recipes of [the format `series`](prediction-format.md#the-runtime-s-own-models) in TypeScript, bound inline, in the server's own process: `@on.auto/prediction-series`, whose binding names `src/recipes/series-models.ts`. Each recipe forecasts from the window it is fed, up to the origin, and answers a finite number for every series. The history of a series is its periods from the first it observed to the origin, and where it does not allow a recipe, the recipe answers as the one its row falls back to:

| Recipe                          | It forecasts                                                                                                                                                                                                                   | It falls back to                                          | Its interval's constant                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `persistence`                   | The last value observed, at every step                                                                                                                                                                                         | 0, with nothing observed                                  | √h                                                                                      |
| `mean`                          | The mean of the values observed, at every step                                                                                                                                                                                 | 0, with nothing observed                                  | √(1 + 1/T), T the values observed                                                       |
| `drift`                         | The line from the first value observed through the last, h periods on                                                                                                                                                          | Persistence, with one value observed                      | √(h(1 + h/(T − 1))), T the periods the line spans                                       |
| `seasonal-naive`                | The value as many whole seasons earlier as the step needs                                                                                                                                                                      | Persistence, under a season and the steps asked           | √(k + 1), k the whole seasons before the step                                           |
| `level-adjusted-seasonal-naive` | ŷ(T+h) = ŷ(T+h−m) × r, ŷ the value observed up to the origin: the value k + 1 whole seasons back times r to the power k + 1, r the mean of the last k periods over the mean of the same k periods a season earlier, k a season | The seasonal naive, under two seasons and the steps asked | The seasonal naive's                                                                    |
| `run-rate`                      | For a total, the mean of the enclosing period so far times the periods left, or of as many last periods as are left when the enclosing period has just begun                                                                   | 0, with nothing observed                                  | The drift's, of the running total: h the periods left, T − 1 the periods the rate reads |
| `linear`                        | A ridge regression of the next period on the last three, the one a season back and the calendar mark of the period ahead, each step fed the steps before it                                                                    | Persistence, where the last periods have no level         | Conformal                                                                               |

- A residual interval takes σ, the root mean square of the recipe's own one-step errors over the window it is fed, and puts the low and the high 1.2816 × σ × its constant either side of the likely value, the 10th and 90th percentiles of a normal error.
- The seasonal naive and its level-adjusted form also answer a total: the sum of the same periods a season earlier, or for the level-adjusted form the sum of its own forecast of each period, each scaled by the level once for each season it reaches back, the constants of its periods added in quadrature. Without a season, a total falls to the run-rate.
- The level stays 1 where the k periods a season earlier average 0, or where the two means would turn its sign.
- The linear model weighs each lag as a ratio to its level, the mean size of its last periods, so one model fits series of any size. Its calendar marks are the day of the week of a day, the month of a month and the quarter of a quarter; a week and a year have none, so the runtime reads the calendar, `at`. Its ridge penalty is 1% of the samples it is fitted on, on every weight but the intercept. It is fitted on the training periods before the last `holdout`, or on all of them when those hold fewer than four samples for each weight.
- Its conformal interval is the 10th and the 90th percentiles of its errors, as ratios to the level, at the last `holdout` origins of the training rows, the rolling origins the scoring walks over the scoring rows; a bound that every error falls beyond is moved to the forecast, so the low never rises above the likely value.
- `defaultModel` answers the level-adjusted seasonal naive with a season, persistence without one and the run-rate for a total without one. `fitModels` answers the mean, the drift, the level-adjusted seasonal naive with a season and the linear model, and for a total the level-adjusted seasonal naive with a season; it fits no persistence, seasonal naive or run-rate, the forecasts of the baselines every candidate is scored against.

</div>
