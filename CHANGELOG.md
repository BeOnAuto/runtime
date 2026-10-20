# Changelog

## [0.14.0](https://github.com/BeOnAuto/runtime/compare/v0.13.0...v0.14.0) (2026-10-20)


### Features

* **connections:** the runtime serves its client metadata document and places a consent's client id ([#259](https://github.com/BeOnAuto/runtime/issues/259)) ([57579bb](https://github.com/BeOnAuto/runtime/commit/57579bb3be8c455084854facdf65129376d98949))
* **server:** the runtime sends an anonymous usage ping at start, which DO_NOT_TRACK turns off ([#265](https://github.com/BeOnAuto/runtime/issues/265)) ([486ed8f](https://github.com/BeOnAuto/runtime/commit/486ed8f5013543efe31228f4657584faf26d9f09))

## [0.13.0](https://github.com/BeOnAuto/runtime/compare/v0.12.0...v0.13.0) (2026-10-19)


### Features

* **connections:** a connection connected by consent serves tools, renewed and revoked ([#255](https://github.com/BeOnAuto/runtime/issues/255)) ([e85ec45](https://github.com/BeOnAuto/runtime/commit/e85ec45e132deeb57f1a6b749f62e5c6e6cbdea9))
* **connections:** a person connects a provider by signing in to it ([#252](https://github.com/BeOnAuto/runtime/issues/252)) ([59b906b](https://github.com/BeOnAuto/runtime/commit/59b906b6399160d233de8e6153a8612b38505bce))
* **connections:** the operator's registered clients, and a secret replaced under a lease ([#246](https://github.com/BeOnAuto/runtime/issues/246)) ([048b363](https://github.com/BeOnAuto/runtime/commit/048b36395fc6c871baeac469395185ae20aee1e8))
* **definitions:** a definition says what it is for, in about ([#251](https://github.com/BeOnAuto/runtime/issues/251)) ([3365c41](https://github.com/BeOnAuto/runtime/commit/3365c41ec787e6554fac16010443bd52d2f53013))
* **definitions:** computation and interaction overviews told as what happens ([#254](https://github.com/BeOnAuto/runtime/issues/254)) ([3fb388f](https://github.com/BeOnAuto/runtime/commit/3fb388f4bf136e3f2147eeded7cc7c2e04b599a1))
* **server:** the runtime serves Studio at its own origin ([#253](https://github.com/BeOnAuto/runtime/issues/253)) ([049704b](https://github.com/BeOnAuto/runtime/commit/049704b8a8c2f535bf5e3560f4ab23c6f232b3b5))
* **tool-servers:** an entry of the file names a provider, and the operator adds providers ([#249](https://github.com/BeOnAuto/runtime/issues/249)) ([5d82798](https://github.com/BeOnAuto/runtime/commit/5d82798d8b57d8ec9737e9a6c41089db5c19de51))


### Bug Fixes

* **definitions:** an overview says whose reply counts, escapes names and reads a typed input ([#256](https://github.com/BeOnAuto/runtime/issues/256)) ([eb82511](https://github.com/BeOnAuto/runtime/commit/eb825111a1c16e8bdd08c6b82659d2a6f2475c40))
* **tool-servers:** the lease of a token row outlasts the refresh, and a failed claim is its own ([#258](https://github.com/BeOnAuto/runtime/issues/258)) ([e885f0d](https://github.com/BeOnAuto/runtime/commit/e885f0d2cfc75ce757f27046ccf0d9604d68af48))

## [0.12.0](https://github.com/BeOnAuto/runtime/compare/v0.11.0...v0.12.0) (2026-10-19)


### ⚠ BREAKING CHANGES

* **connections:** a record says type, a header names its scheme and the page takes the client id ([#240](https://github.com/BeOnAuto/runtime/issues/240))

### Features

* **connections:** a record says type, a header names its scheme and the page takes the client id ([#240](https://github.com/BeOnAuto/runtime/issues/240)) ([1456a96](https://github.com/BeOnAuto/runtime/commit/1456a960d33f6f35c990d21d16f7b0148dc41699))
* **coordination:** a workflow checks its input against its schema before it starts ([#238](https://github.com/BeOnAuto/runtime/issues/238)) ([8792cc7](https://github.com/BeOnAuto/runtime/commit/8792cc729ec1bda7c5f9832be1e08c2b8773acb4))
* **definitions:** the overview is kept as data and written at each read ([#245](https://github.com/BeOnAuto/runtime/issues/245)) ([a7a6d61](https://github.com/BeOnAuto/runtime/commit/a7a6d61550b2341f1e652bc79703672cda57af52))
* **json-schema:** the compiler checks six formats on strings, and refuses any other format ([#237](https://github.com/BeOnAuto/runtime/issues/237)) ([f7a8fa8](https://github.com/BeOnAuto/runtime/commit/f7a8fa87b6fc677657fcff3fe21237d5c50d73be))
* **providers:** the providers a person may connect, shipped as entries, and add_connection by name ([#243](https://github.com/BeOnAuto/runtime/issues/243)) ([19c4785](https://github.com/BeOnAuto/runtime/commit/19c47859b826b4a1a293112ba261aaf4a97876c4))
* **server:** functions call through the connections people add ([#231](https://github.com/BeOnAuto/runtime/issues/231)) ([b3a2bad](https://github.com/BeOnAuto/runtime/commit/b3a2baddd9b0ef86e81f3a11c51d3425ffcc54f7))
* **tool-servers:** search lists the providers a person may connect ([#244](https://github.com/BeOnAuto/runtime/issues/244)) ([69a880f](https://github.com/BeOnAuto/runtime/commit/69a880faadd78d11a188464fb3314f2142287da1))


### Bug Fixes

* **definitions:** a prediction run is a function run ([#236](https://github.com/BeOnAuto/runtime/issues/236)) ([d0032ec](https://github.com/BeOnAuto/runtime/commit/d0032ec94025878b4148b342565c8e41a29f6dc6))
* **tool-servers:** the reader offers what an entry can send, and every request names the runtime ([#241](https://github.com/BeOnAuto/runtime/issues/241)) ([293f5b8](https://github.com/BeOnAuto/runtime/commit/293f5b8266f718a1b4db4cd87ccd21371ce0c41d))

## [0.11.0](https://github.com/BeOnAuto/runtime/compare/v0.10.0...v0.11.0) (2026-10-16)


### Features

* **api:** what a person wants kept goes in a recall function, not the agent's own notes ([#219](https://github.com/BeOnAuto/runtime/issues/219)) ([27e84ba](https://github.com/BeOnAuto/runtime/commit/27e84bad3c807bc15f46683f6f04223071d31667))
* **connections:** an org keeps the connections its people add, through an agent ([#218](https://github.com/BeOnAuto/runtime/issues/218)) ([47a6ae3](https://github.com/BeOnAuto/runtime/commit/47a6ae37bbfa56c630133947d02a95cafa906a4b))
* **definitions:** a refusal of input speaks in the field's own words, from the schema alone ([#226](https://github.com/BeOnAuto/runtime/issues/226)) ([2b221fa](https://github.com/BeOnAuto/runtime/commit/2b221fa2cbe233f74ef2184b8f4a8b3beee02d21))
* **global:** a definition declares the shape of its output, and the runtime owns the shapes ([#212](https://github.com/BeOnAuto/runtime/issues/212)) ([53f93fc](https://github.com/BeOnAuto/runtime/commit/53f93fc8c94a5010b8b1ebe0dfda18662c26ba73))
* **ledger:** secrets kept sealed in the ledger's database under a key that rotates ([#210](https://github.com/BeOnAuto/runtime/issues/210)) ([4dfcd43](https://github.com/BeOnAuto/runtime/commit/4dfcd4388aff3f40f45e12b89823e7dcabdbf0d8))
* **prediction:** a prediction function answers the path, as a series ([#222](https://github.com/BeOnAuto/runtime/issues/222)) ([2251d75](https://github.com/BeOnAuto/runtime/commit/2251d75c98559f51304632edc97aae3b9bc82af9))
* **reasoning:** the model listing marks every alias, including one that resolves to a Bedrock ARN ([#224](https://github.com/BeOnAuto/runtime/issues/224)) ([a5a24f5](https://github.com/BeOnAuto/runtime/commit/a5a24f585c3820f8917ca6a2c7b858eb30f2bfa4))
* **reasoning:** the model listing says whether the operator's allow list narrows it ([#221](https://github.com/BeOnAuto/runtime/issues/221)) ([3b9d71b](https://github.com/BeOnAuto/runtime/commit/3b9d71b88fcb18b2c4fc2aaa8cd0106fb9050c1a))
* **reasoning:** the overview of a function that names tools draws its model and its tools ([#213](https://github.com/BeOnAuto/runtime/issues/213)) ([650cd27](https://github.com/BeOnAuto/runtime/commit/650cd2799abd429a72fe8f3c83ed276e342a73df))
* **server:** an agent adds Auto with one MCP entry, which starts and controls the local runtime ([#208](https://github.com/BeOnAuto/runtime/issues/208)) ([14d0806](https://github.com/BeOnAuto/runtime/commit/14d08060ca7c2a1aec23713159c9a3e67c467a9d))


### Bug Fixes

* **interaction:** the playbook's own message is no reply, so a quiet thread reads as nothing found ([#217](https://github.com/BeOnAuto/runtime/issues/217)) ([23f21b9](https://github.com/BeOnAuto/runtime/commit/23f21b90096b5058df44a54f06e911e7e7f04e52))
* **prediction:** a build nobody could win is refused before it asks a trainer ([#223](https://github.com/BeOnAuto/runtime/issues/223)) ([87fabd0](https://github.com/BeOnAuto/runtime/commit/87fabd0309965e90dc12c9b9ce6c849dca0a124d))
* **prediction:** the modules the tests generate find their files beside themselves ([#229](https://github.com/BeOnAuto/runtime/issues/229)) ([af5780f](https://github.com/BeOnAuto/runtime/commit/af5780fb50ef3da46c8a95ed44eaf642df4d806d))
* **prediction:** the suites run at a moment they own, and a rest holds only while its cause does ([#216](https://github.com/BeOnAuto/runtime/issues/216)) ([e47d45f](https://github.com/BeOnAuto/runtime/commit/e47d45f92fd8e921e1ce7869e783c48bc7fbd590))
* **tool-servers:** one set of secrets per tool access, where a minted token replaces the last ([#207](https://github.com/BeOnAuto/runtime/issues/207)) ([16d6ff7](https://github.com/BeOnAuto/runtime/commit/16d6ff74b5fb1af5c79190f1369c04ca2ee61693))

## [0.10.0](https://github.com/BeOnAuto/runtime/compare/v0.9.1...v0.10.0) (2026-10-15)


### ⚠ BREAKING CHANGES

* **server:** `LOCAL_MODE` is gone. A runtime on a laptop, listening on a loopback address with neither `PUBLIC_URL` nor `API_KEYS` set, runs in local mode; `PUBLIC_URL` turns sign-in on and has no default; a server reachable beyond its computer needs `PUBLIC_URL` or `API_KEYS` to start.

### Features

* **definitions:** every definition carries an overview, the definition in plain words ([#191](https://github.com/BeOnAuto/runtime/issues/191)) ([e0727e1](https://github.com/BeOnAuto/runtime/commit/e0727e18b65af55237e05a3500b6ebcd30732e86))
* **global:** a runtime on a laptop runs in local mode until PUBLIC_URL signs people in ([#202](https://github.com/BeOnAuto/runtime/issues/202)) ([b7d384f](https://github.com/BeOnAuto/runtime/commit/b7d384fd67ba77e0228a39381ce4f7dc8888861a))
* **global:** the overview ends with the definitions that use the definition ([#198](https://github.com/BeOnAuto/runtime/issues/198)) ([fd6dd4e](https://github.com/BeOnAuto/runtime/commit/fd6dd4e27ab9c9ffbd950e4580f9f1decb043873))
* **global:** the overview of interaction and recall functions ([#196](https://github.com/BeOnAuto/runtime/issues/196)) ([7649f8a](https://github.com/BeOnAuto/runtime/commit/7649f8a501c309b6ec9fb0107e4228d1cc8a8658))
* **global:** the overview of prediction functions and workflows ([#197](https://github.com/BeOnAuto/runtime/issues/197)) ([ede7c12](https://github.com/BeOnAuto/runtime/commit/ede7c12d3eebf3243b033a14f05663298d0b8ee6))
* **identity:** a page at an allowed origin sends the session the identity service gave it ([#194](https://github.com/BeOnAuto/runtime/issues/194)) ([0fcddb0](https://github.com/BeOnAuto/runtime/commit/0fcddb03504bca078be9f54bcaf2b228e48e7c5f))
* **identity:** a person signs in through the Auto identity service and is named on the facts ([#176](https://github.com/BeOnAuto/runtime/issues/176)) ([ca5365c](https://github.com/BeOnAuto/runtime/commit/ca5365cbb4a5ddab49fe8474478604bb1806f351))
* **identity:** a signed-in person's permissions are the scopes their token was granted ([#192](https://github.com/BeOnAuto/runtime/issues/192)) ([eb6f602](https://github.com/BeOnAuto/runtime/commit/eb6f6023e46ba13ea6b1df40603ec60a07d433ad))
* **server:** a person signs in by default, wherever the runtime runs ([#190](https://github.com/BeOnAuto/runtime/issues/190)) ([ce8a0a3](https://github.com/BeOnAuto/runtime/commit/ce8a0a3597363742cb68df8dbc2b489969af639d))
* **server:** the OpenAPI document of each release is kept in the repository ([#187](https://github.com/BeOnAuto/runtime/issues/187)) ([6e6210f](https://github.com/BeOnAuto/runtime/commit/6e6210f136fa256368653324908a72c04539b55b))
* **server:** traces, metrics and logs over OpenTelemetry, beside the ledger ([#183](https://github.com/BeOnAuto/runtime/issues/183)) ([e51fd53](https://github.com/BeOnAuto/runtime/commit/e51fd538761b11950450ec5b38716483b8834d8c))
* **tool-servers:** a tool server is an MCP server or an HTTP API with an OpenAPI document ([#177](https://github.com/BeOnAuto/runtime/issues/177)) ([b03554d](https://github.com/BeOnAuto/runtime/commit/b03554d2f883564361222cb282f6a2c89764ba58))
* **tool-servers:** search, introspect, validate, dry_run and execute over the tool servers ([#180](https://github.com/BeOnAuto/runtime/issues/180)) ([e94dbd8](https://github.com/BeOnAuto/runtime/commit/e94dbd8c586add55f46f8935b425c79467ce4db6))


### Bug Fixes

* **api:** a page may read the challenge of a refusal across origins ([#193](https://github.com/BeOnAuto/runtime/issues/193)) ([6c59e85](https://github.com/BeOnAuto/runtime/commit/6c59e854ecc8f2d33b3ac09d6819d84f055e8033))
* **api:** a sign-in asks the identity service for the organization scope ([#189](https://github.com/BeOnAuto/runtime/issues/189)) ([9453526](https://github.com/BeOnAuto/runtime/commit/9453526e96bd852bbd0fbbd04d6f2129b12ed63e))
* **definitions:** the overview reads a condition or a loop written within a line as a phrase of it ([#204](https://github.com/BeOnAuto/runtime/issues/204)) ([abcb304](https://github.com/BeOnAuto/runtime/commit/abcb3046e7211e5082f90a2ce3487b803862a114))
* **global:** four scans of outside text run in linear time ([#195](https://github.com/BeOnAuto/runtime/issues/195)) ([3fdcbf2](https://github.com/BeOnAuto/runtime/commit/3fdcbf28738dab5527d3945c944103127d4caab0))
* **identity:** a session's organization is read from the claim the identity service puts it in ([#201](https://github.com/BeOnAuto/runtime/issues/201)) ([7cca14b](https://github.com/BeOnAuto/runtime/commit/7cca14b5d151b64d037a41502c933103c3ca2e91))

## [0.9.1](https://github.com/BeOnAuto/runtime/compare/v0.9.0...v0.9.1) (2026-10-13)


### Bug Fixes

* **server:** the image states the two scanner findings that do not apply to it ([#179](https://github.com/BeOnAuto/runtime/issues/179)) ([01dc4da](https://github.com/BeOnAuto/runtime/commit/01dc4da9c9f5bb5bd14df643186f798cf7774d9e))

## [0.9.0](https://github.com/BeOnAuto/runtime/compare/v0.8.0...v0.9.0) (2026-10-13)


### Features

* **api:** the runtime serves its OpenAPI document and its guides over HTTP ([#175](https://github.com/BeOnAuto/runtime/issues/175)) ([739f231](https://github.com/BeOnAuto/runtime/commit/739f231b48a8b243a08eb31d092b5db193370829))
* **prediction:** builds answered by a trainer, scored, shadowed, activated and asked ([#161](https://github.com/BeOnAuto/runtime/issues/161)) ([b4e085a](https://github.com/BeOnAuto/runtime/commit/b4e085a51130eb51317a483c3f1a1dfe2aef7bf5))


### Bug Fixes

* **ledger:** a read looks up other databases' writes before it takes its snapshot ([#162](https://github.com/BeOnAuto/runtime/issues/162)) ([6f7b527](https://github.com/BeOnAuto/runtime/commit/6f7b52761ac69e647cc05d6c9f5c2ae0f65aae71))
* **server:** build the image on node:26.11.1-slim and leave npm out of it ([#178](https://github.com/BeOnAuto/runtime/issues/178)) ([f9fbcab](https://github.com/BeOnAuto/runtime/commit/f9fbcabdb46e2312deb4d6b3213fc02eff3901b8))

## [0.8.0](https://github.com/BeOnAuto/runtime/compare/v0.7.0...v0.8.0) (2026-10-13)


### Features

* **server:** a compact startup screen for npx [@on](https://github.com/on).auto/runtime, with Studio the one link to follow ([#167](https://github.com/BeOnAuto/runtime/issues/167)) ([20fd114](https://github.com/BeOnAuto/runtime/commit/20fd1145c1524cf5d6cbfb403303113f43e9c704))

## [0.7.0](https://github.com/BeOnAuto/runtime/compare/v0.6.0...v0.7.0) (2026-10-13)


### Features

* **server:** npx [@on](https://github.com/on).auto/runtime opens with the Auto logo, links and one clean stop ([#165](https://github.com/BeOnAuto/runtime/issues/165)) ([81975aa](https://github.com/BeOnAuto/runtime/commit/81975aae2923de05e3a2819067feb5be82f2ef03))

## [0.6.0](https://github.com/BeOnAuto/runtime/compare/v0.5.0...v0.6.0) (2026-10-12)


### ⚠ BREAKING CHANGES

* **server:** npx @on.auto/runtime starts the runtime, on port 5555 by default ([#163](https://github.com/BeOnAuto/runtime/issues/163))
* **global:** the runtime is @on.auto/runtime and every package is under @on.auto ([#155](https://github.com/BeOnAuto/runtime/issues/155))
* **global:** the runtime is named auto-runtime ([#153](https://github.com/BeOnAuto/runtime/issues/153))
* **global:** playbooks are the one name in storage, configuration and code ([#151](https://github.com/BeOnAuto/runtime/issues/151))
* **global:** align runtime APIs and documentation around playbooks

### Features

* **api:** a browser opening the server finds a page that opens the console ([#92](https://github.com/BeOnAuto/runtime/issues/92)) ([7dc46cb](https://github.com/BeOnAuto/runtime/commit/7dc46cb5b2e2adb3c0389a6f7f199e23c64f74fb))
* **api:** authenticate callers and serve the brain operations over HTTP ([#66](https://github.com/BeOnAuto/runtime/issues/66)) ([4d744b0](https://github.com/BeOnAuto/runtime/commit/4d744b0ae91a18786ad71f2f14d61f02c21a4cfd))
* **api:** instructions, tool descriptions, guides and prompts for agents over MCP ([#126](https://github.com/BeOnAuto/runtime/issues/126)) ([f4a7d7f](https://github.com/BeOnAuto/runtime/commit/f4a7d7f64360e325e33245c13e6722804e23e402))
* **api:** lead MCP tool results and errors with plain words ([#83](https://github.com/BeOnAuto/runtime/issues/83)) ([1021942](https://github.com/BeOnAuto/runtime/commit/1021942da9c150bca93c39bdb8a03b67859f9731))
* **api:** serve every operation on one MCP endpoint ([#74](https://github.com/BeOnAuto/runtime/issues/74)) ([7b1d79f](https://github.com/BeOnAuto/runtime/commit/7b1d79ff7cd7f766128194bc60caa28e364e97ab))
* **api:** serve operations as MCP tools ([#69](https://github.com/BeOnAuto/runtime/issues/69)) ([266df06](https://github.com/BeOnAuto/runtime/commit/266df06b1f47b54d34837d0f6605aff3e47dafe1))
* **brains:** add the brain operations and the ledger that stores them ([#64](https://github.com/BeOnAuto/runtime/issues/64)) ([3d0cfe5](https://github.com/BeOnAuto/runtime/commit/3d0cfe5d791f512e20361c87ba3377a313c1ae79))
* **computation:** a brain computes with a program, exactly and the same way every time ([#106](https://github.com/BeOnAuto/runtime/issues/106)) ([99b59df](https://github.com/BeOnAuto/runtime/commit/99b59df03544a5031a912f25e0241403031215d4))
* **definitions:** one answer fact, facts composed from every capability, an input-aware contract ([#147](https://github.com/BeOnAuto/runtime/issues/147)) ([db609dc](https://github.com/BeOnAuto/runtime/commit/db609dce22fb75b586e3d3c77ea7f814e0ce5928))
* **global:** add README quickstart and Studio invite links ([#95](https://github.com/BeOnAuto/runtime/issues/95)) ([68b0f3b](https://github.com/BeOnAuto/runtime/commit/68b0f3b75c74095c13d4ee0af1568415b47d2278))
* **global:** align runtime APIs and documentation around playbooks ([4e57fe2](https://github.com/BeOnAuto/runtime/commit/4e57fe280208a4c94535856923d9ab52105fee93))
* **global:** rebuild the runtime as a Node 26 TypeScript monorepo ([#46](https://github.com/BeOnAuto/runtime/issues/46)) ([405d04b](https://github.com/BeOnAuto/runtime/commit/405d04bd1b7b7e824c06369041273f10d28fddcf))
* **inference:** call what a brain does by its functions ([#84](https://github.com/BeOnAuto/runtime/issues/84)) ([7eaf4dc](https://github.com/BeOnAuto/runtime/commit/7eaf4dcdac2cbff81b488ee4adbab54ca1f00309))
* **inference:** execute prompts as specs ([#71](https://github.com/BeOnAuto/runtime/issues/71)) ([fda92e7](https://github.com/BeOnAuto/runtime/commit/fda92e76104f2c5b9ec15328ea98a7a8b921c1ee))
* **inference:** list the models a server can call ([#87](https://github.com/BeOnAuto/runtime/issues/87)) ([90f3cde](https://github.com/BeOnAuto/runtime/commit/90f3cdee395765168d0cf72e8a6c600218368c64))
* **inference:** tell callers which model providers a server has ([#79](https://github.com/BeOnAuto/runtime/issues/79)) ([4d522f6](https://github.com/BeOnAuto/runtime/commit/4d522f667a999d3aef15203ecfddc16c3a2dfb79))
* **interaction:** a brain asks a person or a system and takes the answer later ([#123](https://github.com/BeOnAuto/runtime/issues/123)) ([b4512c0](https://github.com/BeOnAuto/runtime/commit/b4512c0d7f9a2946cae06fe11a7d08de26187faa))
* **interaction:** an interaction function calls a tool and answers with its result ([#139](https://github.com/BeOnAuto/runtime/issues/139)) ([d6998f1](https://github.com/BeOnAuto/runtime/commit/d6998f19d796cd083ff976c824d8d445ea0d0988))
* **interaction:** an interaction function names the tool it sends through and reads its replies ([#135](https://github.com/BeOnAuto/runtime/issues/135)) ([af87111](https://github.com/BeOnAuto/runtime/commit/af87111ccb256b914790d9791e4e2630c62c3d15))
* **interaction:** an open request lists the shape its answer takes ([#129](https://github.com/BeOnAuto/runtime/issues/129)) ([04201ab](https://github.com/BeOnAuto/runtime/commit/04201ab02815b97737703ad29926cdbfbc62541c))
* **ledger:** content kept as streamed bytes, and operations served over HTTP alone ([#146](https://github.com/BeOnAuto/runtime/issues/146)) ([f78ab74](https://github.com/BeOnAuto/runtime/commit/f78ab7486059408c28b211893c7c994b7951c8dc))
* **ledger:** keep the ledger in PostgreSQL ([#86](https://github.com/BeOnAuto/runtime/issues/86)) ([cbf6c4a](https://github.com/BeOnAuto/runtime/commit/cbf6c4a7d1a5dad143a3936838252ea25c31b483))
* **ledger:** named facts, a context typed by each fact, and content kept whole under its digest ([#143](https://github.com/BeOnAuto/runtime/issues/143)) ([12f5816](https://github.com/BeOnAuto/runtime/commit/12f581635eec016c6266158a496fbeea16072b62))
* **ledger:** open the ledger on any Emmett SQLite driver, without sqlite3 ([#82](https://github.com/BeOnAuto/runtime/issues/82)) ([a4c766a](https://github.com/BeOnAuto/runtime/commit/a4c766aa783f5c17d802c13004a8cbd0005b8351))
* **ledger:** read what a brain recorded, bound to the brain ([#89](https://github.com/BeOnAuto/runtime/issues/89)) ([618517a](https://github.com/BeOnAuto/runtime/commit/618517a357a0a9405bfd909bfbf33bee69967b13))
* **mcp:** a server's tools are allowed and marked testable on its own entry ([#134](https://github.com/BeOnAuto/runtime/issues/134)) ([9203df9](https://github.com/BeOnAuto/runtime/commit/9203df9da2a9102b7608bf1794b4dc4725de262e))
* **mcp:** an agent tests a tool call through the brain before writing a function ([#131](https://github.com/BeOnAuto/runtime/issues/131)) ([498219d](https://github.com/BeOnAuto/runtime/commit/498219da0e465e58b65d090d22e3041bffe204be))
* **mcp:** list the tool servers a brain may use, with the tools each offers ([#119](https://github.com/BeOnAuto/runtime/issues/119)) ([d71c0cd](https://github.com/BeOnAuto/runtime/commit/d71c0cd0c3e747922c6b409f1f9aad63f183251a))
* **mcp:** reason functions use tools from the MCP servers the operator configures ([#98](https://github.com/BeOnAuto/runtime/issues/98)) ([f86bd00](https://github.com/BeOnAuto/runtime/commit/f86bd0036b203b52da60fc1288cf022c4560c077))
* **object-storage:** content kept on an S3 object store behind CONTENT_STORE_URL ([#150](https://github.com/BeOnAuto/runtime/issues/150)) ([a400df9](https://github.com/BeOnAuto/runtime/commit/a400df935f8241279c6487cd5d299f39a2776f5e))
* **operations:** add the application layer ([#61](https://github.com/BeOnAuto/runtime/issues/61)) ([c8c4a4a](https://github.com/BeOnAuto/runtime/commit/c8c4a4a98eec849a341114e3483470bcdc28e102))
* **orchestration:** a workflow starts on a schedule and on events, with up to three triggers ([#130](https://github.com/BeOnAuto/runtime/issues/130)) ([a06e969](https://github.com/BeOnAuto/runtime/commit/a06e9692de35ac0277e658866fa61ef50f8d4e6c))
* **orchestration:** a workflow waits for runs that finish later, with deadlines and cancel ([#115](https://github.com/BeOnAuto/runtime/issues/115)) ([48d90dd](https://github.com/BeOnAuto/runtime/commit/48d90ddc6f6bf26a7afdf28c0f03cb557977f1d3))
* **orchestration:** run workflow specs on Temporal ([#70](https://github.com/BeOnAuto/runtime/issues/70)) ([b0faa0f](https://github.com/BeOnAuto/runtime/commit/b0faa0fceac43e3cfc3ed206ecab4761369132db))
* **prediction:** the prediction function's document, its schemas and its dataset from history ([#157](https://github.com/BeOnAuto/runtime/issues/157)) ([4f4c3b3](https://github.com/BeOnAuto/runtime/commit/4f4c3b38cea964e28ee013ab034d4e89f4dc0f7a))
* **recollection:** a brain keeps views of its own history and answers from them ([#112](https://github.com/BeOnAuto/runtime/issues/112)) ([bd334af](https://github.com/BeOnAuto/runtime/commit/bd334af99c85e3cc025b8d7af80e2b055d763bcb))
* **server:** npx [@on](https://github.com/on).auto/runtime starts the runtime, on port 5555 by default ([#163](https://github.com/BeOnAuto/runtime/issues/163)) ([0205f63](https://github.com/BeOnAuto/runtime/commit/0205f637d0cccb12529e4f3fc499b8b20955c74d))
* **server:** read structured settings from a YAML configuration file ([#80](https://github.com/BeOnAuto/runtime/issues/80)) ([1460def](https://github.com/BeOnAuto/runtime/commit/1460defec12e0910731d73d67136ff7973dfc7df))
* **server:** readable start-up and a quick start for AI assistants ([#77](https://github.com/BeOnAuto/runtime/issues/77)) ([a9fcb65](https://github.com/BeOnAuto/runtime/commit/a9fcb65bedb70185f7660d5b38f8f8d169b00ad9))
* **server:** run a local Temporal with pnpm dev ([#75](https://github.com/BeOnAuto/runtime/issues/75)) ([be0b02a](https://github.com/BeOnAuto/runtime/commit/be0b02af2393a1cb34f361482e3a0dd9dbe7947d))
* **server:** serve workflows ([#72](https://github.com/BeOnAuto/runtime/issues/72)) ([aecb3f9](https://github.com/BeOnAuto/runtime/commit/aecb3f94109d7ced3b04f3986a469a9ce2ff132e))
* **server:** the database password signed from the cloud identity under DATABASE_CREDENTIALS ([#160](https://github.com/BeOnAuto/runtime/issues/160)) ([1b17197](https://github.com/BeOnAuto/runtime/commit/1b1719732896e5c0758ba15d34a8c236336c8074))
* **specs:** add the spec operations ([#67](https://github.com/BeOnAuto/runtime/issues/67)) ([7651e40](https://github.com/BeOnAuto/runtime/commit/7651e40498ce65993d2e8478b25ae586b1571283))
* **specs:** answer a brain's analytics from a table of run outcomes kept in the ledger ([#105](https://github.com/BeOnAuto/runtime/issues/105)) ([f71f442](https://github.com/BeOnAuto/runtime/commit/f71f442e182c954f6d16d656cfdd7d378d61e5fe))
* **specs:** every event names itself, its cause and its run, and a workflow's steps are events ([#107](https://github.com/BeOnAuto/runtime/issues/107)) ([adf527b](https://github.com/BeOnAuto/runtime/commit/adf527bcb334c854cec7f8bbc08d0959c3394f71))
* **specs:** list a brain's runs, read a run's history and follow a brain's events ([#93](https://github.com/BeOnAuto/runtime/issues/93)) ([2019e5b](https://github.com/BeOnAuto/runtime/commit/2019e5b65bd5f421204add5a0b89aac1fc6788f2))
* **specs:** publish events into a brain and present its own facts as events ([#104](https://github.com/BeOnAuto/runtime/issues/104)) ([77e8f8f](https://github.com/BeOnAuto/runtime/commit/77e8f8f61a868585d252b77b622bebf7688c6540))
* **workflow-engine:** the brain's one language is TypeScript, run in a QuickJS sandbox ([#141](https://github.com/BeOnAuto/runtime/issues/141)) ([5791aff](https://github.com/BeOnAuto/runtime/commit/5791aff2ac668b3670e49ed9c0e5328953fc789c))
* **workflow-engine:** the contract of a workflow engine on the ledger ([#85](https://github.com/BeOnAuto/runtime/issues/85)) ([a862223](https://github.com/BeOnAuto/runtime/commit/a862223708362f6de9382105e54d9b4f179a8d94))
* **workflow-engine:** the workflow machine, its engine and an in-memory driver ([#88](https://github.com/BeOnAuto/runtime/issues/88)) ([61d3ade](https://github.com/BeOnAuto/runtime/commit/61d3ade0cb13317e5c5052f10cc7f2071621ba15))
* **workflow-host:** a projector folder per definition type, and a pool of model processes ([#148](https://github.com/BeOnAuto/runtime/issues/148)) ([3281b17](https://github.com/BeOnAuto/runtime/commit/3281b172dbcdb23015f7ae8585c2868681f9d9f4))
* **workflow-host:** run every workflow in the server, on the workflow engine, without Temporal ([#96](https://github.com/BeOnAuto/runtime/issues/96)) ([13f4a7e](https://github.com/BeOnAuto/runtime/commit/13f4a7ea875f3c35547e440bb52c679dd492af3b))
* **workflow-host:** workflows react to what their brain records, on events and on a schedule ([#113](https://github.com/BeOnAuto/runtime/issues/113)) ([41baa13](https://github.com/BeOnAuto/runtime/commit/41baa13f3104b4296e434cb48bcfad6211b66d64))


### Bug Fixes

* **api:** judge the arguments of an MCP tool call as HTTP does ([#76](https://github.com/BeOnAuto/runtime/issues/76)) ([b07642d](https://github.com/BeOnAuto/runtime/commit/b07642dbe6c3434bf65869180d116cf166a566d9))
* **api:** the served tools advertise no output schema ([#136](https://github.com/BeOnAuto/runtime/issues/136)) ([b140126](https://github.com/BeOnAuto/runtime/commit/b1401264c1720beb565ddecf9fb9aeb7dcd77769))
* **api:** the server's page opens the studio on this server again ([#128](https://github.com/BeOnAuto/runtime/issues/128)) ([fad12d6](https://github.com/BeOnAuto/runtime/commit/fad12d6a0451c45b3ea5315d9769e4b794748aae))
* **api:** the server's page opens the studio, whose origin is the one always allowed ([#94](https://github.com/BeOnAuto/runtime/issues/94)) ([5765599](https://github.com/BeOnAuto/runtime/commit/576559945d6724fbbe2c6b75dcd8f7651f180832))
* **global:** remove the duplicate recollation folder and third-party references ([#57](https://github.com/BeOnAuto/runtime/issues/57)) ([28f3184](https://github.com/BeOnAuto/runtime/commit/28f3184c8c8247c9ec6ae44471de9de163e35e76))
* **global:** settle three tests, show a rejected run's record, and instruct connecting agents ([#118](https://github.com/BeOnAuto/runtime/issues/118)) ([4f99a5e](https://github.com/BeOnAuto/runtime/commit/4f99a5ef4d45101a1165e21437b2a4a140a7af03))
* **global:** settle two flaky tests and bound what tool servers log ([#103](https://github.com/BeOnAuto/runtime/issues/103)) ([55f1360](https://github.com/BeOnAuto/runtime/commit/55f136084917994963fecfab91653ff9aa12d33a))
* **interaction:** answers survive a restart, timers run while receivers hang ([#125](https://github.com/BeOnAuto/runtime/issues/125)) ([c4d01f9](https://github.com/BeOnAuto/runtime/commit/c4d01f900c9e25f4d237f5e8284aa42dd250c002))
* **ledger:** the run list fills every page when filtered by primitive or name ([#127](https://github.com/BeOnAuto/runtime/issues/127)) ([6c9fd7e](https://github.com/BeOnAuto/runtime/commit/6c9fd7e83e3667c1393b2dcd27625248b9d80e10))
* **mcp:** list only reachable tool servers, refuse an unknown server, and decode MCP inputs once ([#120](https://github.com/BeOnAuto/runtime/issues/120)) ([73cb2ab](https://github.com/BeOnAuto/runtime/commit/73cb2ab9b8d061a95a7ea0e33a06af325c70b579))
* **mcp:** the tool-server listing answers for the org when no brain is named ([#132](https://github.com/BeOnAuto/runtime/issues/132)) ([50fb66a](https://github.com/BeOnAuto/runtime/commit/50fb66af4d12df84c036d21d25d4a63ee91aa821))
* **operations:** a key limited to some brains is told to name one ([#133](https://github.com/BeOnAuto/runtime/issues/133)) ([c437767](https://github.com/BeOnAuto/runtime/commit/c43776767d23051e3d823d985f3f8f502dae0666))
* **operations:** make UUIDv7 ids portable to Cloudflare Workers ([#81](https://github.com/BeOnAuto/runtime/issues/81)) ([c5a48c4](https://github.com/BeOnAuto/runtime/commit/c5a48c4c6b71e12083103bca50793058e727634c))
* **prediction:** the data test in one session a page, the brief checked at save, reads bounded ([#159](https://github.com/BeOnAuto/runtime/issues/159)) ([2e09885](https://github.com/BeOnAuto/runtime/commit/2e09885f9f67f67e38447be59868b4ddf655822c))
* **server:** computation and recall run under the development runner again ([#121](https://github.com/BeOnAuto/runtime/issues/121)) ([40e4f82](https://github.com/BeOnAuto/runtime/commit/40e4f8215ca1116c50c436adb7db98fc9a3d432a))
* **specs:** bound nested event data and close the gaps a published event could use ([#108](https://github.com/BeOnAuto/runtime/issues/108)) ([5584e7f](https://github.com/BeOnAuto/runtime/commit/5584e7fa083dc6811349d3cd370d9c6b9b5a4d08))
* **specs:** keep the deferral out of the history, and cap how deep an expression's value may nest ([#110](https://github.com/BeOnAuto/runtime/issues/110)) ([14c9774](https://github.com/BeOnAuto/runtime/commit/14c9774755e4391dd1736f1dad84e929fc2ecc92))
* **workflow-engine:** bound regular expressions and object keys, and give expressions a deadline ([#99](https://github.com/BeOnAuto/runtime/issues/99)) ([749bda9](https://github.com/BeOnAuto/runtime/commit/749bda98b2f474c22593277ffafac66ef6764349))
* **workflow-engine:** workers inherit no flag from the server ([#122](https://github.com/BeOnAuto/runtime/issues/122)) ([4441b3e](https://github.com/BeOnAuto/runtime/commit/4441b3e2a6440877250a378f06c63d2eb6fd021f))
* **workflow-host:** a lone recall function is never shown waiting behind others ([#137](https://github.com/BeOnAuto/runtime/issues/137)) ([3df2373](https://github.com/BeOnAuto/runtime/commit/3df2373e6ed4fb254bcdbc33ae407dddd72136f2))


### Performance Improvements

* **ledger:** size each fill listing by what the batch before showed fits in 16 MiB ([#111](https://github.com/BeOnAuto/runtime/issues/111)) ([673b4ab](https://github.com/BeOnAuto/runtime/commit/673b4ab832e4f6b343055321acb98be7246285b4))
* **workflow-engine:** keep workers warm between jobs, so a run costs only its own work ([#117](https://github.com/BeOnAuto/runtime/issues/117)) ([3a47712](https://github.com/BeOnAuto/runtime/commit/3a477124f2908cc12efc434c4921662ccf37c2b5))


### Code Refactoring

* **global:** playbooks are the one name in storage, configuration and code ([#151](https://github.com/BeOnAuto/runtime/issues/151)) ([79fb090](https://github.com/BeOnAuto/runtime/commit/79fb0901a98fc9bb19aa2a30cca8c6ee208bfe03))
* **global:** the runtime is [@on](https://github.com/on).auto/runtime and every package is under [@on](https://github.com/on).auto ([#155](https://github.com/BeOnAuto/runtime/issues/155)) ([6e04f07](https://github.com/BeOnAuto/runtime/commit/6e04f073bfd320decc5d248003dc4c1280a8bbf2))
* **global:** the runtime is named auto-runtime ([#153](https://github.com/BeOnAuto/runtime/issues/153)) ([54b7ae6](https://github.com/BeOnAuto/runtime/commit/54b7ae685e3cefd8f97a9511bdc5b4e18047d1cb))

## Changelog
