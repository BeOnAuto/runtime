# Changelog

## [0.56.0](https://github.com/BeOnAuto/runtime/compare/v0.55.1...v0.56.0) (2026-11-03)


### ⚠ BREAKING CHANGES

* **definitions:** a page's lately is now runs
* **generation:** a later-finishing generation is waited for, and expiry removes content
* **api:** split execute and serve the directory listing at /directory
* **definitions:** a definition's page is part of it
* **global:** the recall function type leaves, and pages keep the fold and the views
* **lookup:** a lookup function obtains information through one tool that only reads
* **tool-servers:** every tool carries a mark, reads, acts or unmarked

### Features

* **activity:** a comment is pinned where it was made, on anything of a playbook or the org ([77ef7a2](https://github.com/BeOnAuto/runtime/commit/77ef7a28f15c81748a60adef74cde5beaa71a5c1))
* **activity:** comments on anything, copied to the agent and read by agents ([89509d9](https://github.com/BeOnAuto/runtime/commit/89509d9363145a66256f6e03e9feffacba730634))
* **activity:** the organization's activity, kept by the runtime and seen by each person ([7ba0482](https://github.com/BeOnAuto/runtime/commit/7ba04827b35e2cbe1f8f6b9baf734f8462dbc4b2))
* **api:** split execute and serve the directory listing at /directory ([413d9fb](https://github.com/BeOnAuto/runtime/commit/413d9fb8cc7335baab66aebc7518bb712794d6ba))
* **api:** the instructions name the function families in one sentence ([c463f3e](https://github.com/BeOnAuto/runtime/commit/c463f3e21ccd35b73cfc018bd8d00e71422079a9))
* **api:** the served Studio may send feedback to PostHog ([7c09ee8](https://github.com/BeOnAuto/runtime/commit/7c09ee8880f49e11eca000f2b7945a4adff7376e))
* **api:** tools carry their title as an annotation and name a type for every argument ([353f507](https://github.com/BeOnAuto/runtime/commit/353f507724b2be69fd93f22f3537b39c9e51d8a2))
* **content:** recorded content can be removed, and served by a signed address ([31a25da](https://github.com/BeOnAuto/runtime/commit/31a25da0b2a8bad3efe7acb22983f5daace1bf41))
* **definitions:** a definition is paused and resumed ([04f78be](https://github.com/BeOnAuto/runtime/commit/04f78be8876d3906e620e2a5d40c3c3a6e595309))
* **definitions:** a definition's page is part of it ([e447090](https://github.com/BeOnAuto/runtime/commit/e44709035b0f316f741f971c7db22005ff7c0d38))
* **definitions:** a page for every workflow and function, with a recipe in each format guide ([9e45772](https://github.com/BeOnAuto/runtime/commit/9e457723143fc85ed024fe07972d750e36445498))
* **definitions:** a page presents a workflow's, a function's or a playbook's results ([0a67345](https://github.com/BeOnAuto/runtime/commit/0a6734513fd4a1ee016e4ea14f77a6de7b2fe325))
* **definitions:** a page's lately is now runs ([3e0e08a](https://github.com/BeOnAuto/runtime/commit/3e0e08a6783e6bcaf843e708664244c614ef607f))
* **definitions:** step runs say where they ran, and render_page renders a page as of a run ([2b32ba1](https://github.com/BeOnAuto/runtime/commit/2b32ba14606ba0cbc06eb815090297456a09642f))
* **generation:** a generation function produces an image or audio and keeps it as an asset ([d4544ef](https://github.com/BeOnAuto/runtime/commit/d4544ef897edcc34ee3568e4eef4a5ba080e1ff7))
* **generation:** a later-finishing generation is waited for, and expiry removes content ([8b6f5d8](https://github.com/BeOnAuto/runtime/commit/8b6f5d814a6688e260840409a396cace3e60d792))
* **global:** the recall function type leaves, and pages keep the fold and the views ([64e8fc3](https://github.com/BeOnAuto/runtime/commit/64e8fc3d99730ea6b65e5eb0402ac354588330cb))
* **ledger:** projections over an organization's streams, and a fact scrubbed in place ([9368339](https://github.com/BeOnAuto/runtime/commit/936833938ade16663697423e80f4b7496926e4db))
* **ledger:** the ledger knows every holder of a digest and removes content nothing holds ([e4bd948](https://github.com/BeOnAuto/runtime/commit/e4bd948634eb48380209e76237a9a65d7d3d17c6))
* **lookup:** a lookup function obtains information through one tool that only reads ([cd41540](https://github.com/BeOnAuto/runtime/commit/cd415405f5ae8e406b3977f66c8b7418afa83306))
* **memory:** a memory function remembers and recalls, and an agent has the same tools ([5056f7d](https://github.com/BeOnAuto/runtime/commit/5056f7d12e442d7ab1d7ae16b0c0c670c0e5cb6a))
* **memory:** the organization's memories are kept through a port ([abf3e8c](https://github.com/BeOnAuto/runtime/commit/abf3e8cdc356a8807c3798455569dcbc869496b1))
* **tool-servers:** every tool carries a mark, reads, acts or unmarked ([6206a5d](https://github.com/BeOnAuto/runtime/commit/6206a5d741d886489b5b6313c6bb4556f565559d))


### Bug Fixes

* **definitions:** a page's figures and standing come from one read of its view ([451b0dd](https://github.com/BeOnAuto/runtime/commit/451b0ddf02e1573c6232565ca758dbdc0beb8e4f))
* **global:** clarify product messages and documentation ([ad5f566](https://github.com/BeOnAuto/runtime/commit/ad5f566703b4d306f6e3d6f84d8957998bb19af1))
* **server:** update Node to 26.12.1 for the October security release ([#446](https://github.com/BeOnAuto/runtime/issues/446)) ([8acd6a1](https://github.com/BeOnAuto/runtime/commit/8acd6a10a31df255f8ad6328eb918e720e319516))

## [0.55.1](https://github.com/BeOnAuto/runtime/compare/v0.55.0...v0.55.1) (2026-11-01)


### Bug Fixes

* **server:** the ledger's start check knows the facts an extension declares ([a20ccd9](https://github.com/BeOnAuto/runtime/commit/a20ccd9bef7d3175d4ad36b648e281c1f1d22333))

## [0.55.0](https://github.com/BeOnAuto/runtime/compare/v0.54.0...v0.55.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* **operations:** content, shipped files and phrasing leave operations

### Code Refactoring

* **operations:** content, shipped files and phrasing leave operations ([e923cef](https://github.com/BeOnAuto/runtime/commit/e923cef35df6711c2700d5ecfe0a150910b83d2a))

## [0.54.0](https://github.com/BeOnAuto/runtime/compare/v0.53.0...v0.54.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* **definitions:** a function says whether it has a diagram

### Features

* **api:** a new organization is welcomed on first contact, with prompts and links to Studio ([fefc8c7](https://github.com/BeOnAuto/runtime/commit/fefc8c75d79bebf9650cd80fdbac51ad9942045e))
* **connections:** a connection's link says who asked for it ([6575bd9](https://github.com/BeOnAuto/runtime/commit/6575bd9b7d79fd45a932efa5d295817322a10eed))
* **definitions:** a function says whether it has a diagram ([8205bdb](https://github.com/BeOnAuto/runtime/commit/8205bdb6f7149824c8d5b365382c10e51a9c2012))

## [0.53.0](https://github.com/BeOnAuto/runtime/compare/v0.52.0...v0.53.0) (2026-10-31)


### ⚠ BREAKING CHANGES

* **connections:** a connection runs under an OAuth client, the operator's or the org's own

### Features

* **connections:** a connection runs under an OAuth client, the operator's or the org's own ([28e9d9d](https://github.com/BeOnAuto/runtime/commit/28e9d9d25eecdc03de3c7058a9e500cd006b7433))

## [0.52.0](https://github.com/BeOnAuto/runtime/compare/v0.51.0...v0.52.0) (2026-10-31)


### ⚠ BREAKING CHANGES

* **interaction:** a request goes through a connection the person chose, or is held for an agent

### Features

* **interaction:** a request goes through a connection the person chose, or is held for an agent ([789a82c](https://github.com/BeOnAuto/runtime/commit/789a82c733f751f20892d7955cc27df70467d84a))

## [0.51.0](https://github.com/BeOnAuto/runtime/compare/v0.50.0...v0.51.0) (2026-10-30)


### Features

* **prediction:** a dataset page's data tests are judged as one by the host's filters ([c54976e](https://github.com/BeOnAuto/runtime/commit/c54976e145e2fd04959280ae2bd741a5f532686c))
* **providers:** x connects under the org's own app, posting and reading as the person who signs in ([aaf22dd](https://github.com/BeOnAuto/runtime/commit/aaf22dddb18c520e63fc9c732b00f534dcef8989))
* **server:** an installed extension fills the prediction capability in place of the forecaster ([75ee4da](https://github.com/BeOnAuto/runtime/commit/75ee4da9fb3561f561e4d8ee529ec153e59f5109))

## [0.50.0](https://github.com/BeOnAuto/runtime/compare/v0.49.0...v0.50.0) (2026-10-30)


### Features

* **connections:** a connection may run under the org's own app, given on the connect page ([34961db](https://github.com/BeOnAuto/runtime/commit/34961db2f778b5f7814859b6db587cecd22ba02b))


### Bug Fixes

* **prediction:** the dataset fold binds no more values in a statement than the database allows ([ada2297](https://github.com/BeOnAuto/runtime/commit/ada2297aa1ad6bc873e43c97a244a3ae9a844c22))

## [0.49.0](https://github.com/BeOnAuto/runtime/releases/tag/v0.49.0) (2026-10-30)


### ⚠ BREAKING CHANGES

* **prediction:** the runtime predicts with its built-in forecaster alone

### Features

* **connections:** a connection's grant grows in context, by a consent that asks more ([6093a9b](https://github.com/BeOnAuto/runtime/commit/6093a9b755449c436331a3e8b9f24d974512edf9))
* **prediction:** the runtime predicts with its built-in forecaster alone ([88e6508](https://github.com/BeOnAuto/runtime/commit/88e6508abd62d292f55b8d7ba5e22883f4bf6114))


### Bug Fixes

* **providers:** buffer connects with an API key, as its sign-in takes only the apps it lists ([4d41790](https://github.com/BeOnAuto/runtime/commit/4d417903a1358c4400d158e6855dde282a58a2aa))
* **tool-servers:** a server that refuses to register a client is said so, not asked again ([d2a7e95](https://github.com/BeOnAuto/runtime/commit/d2a7e95df62bcdfc5f9f8621da8f77761e37082c))
