# Changelog

## [0.57.0](https://github.com/BeOnAuto/runtime/compare/v0.56.0...v0.57.0) (2026-11-14)


### ⚠ BREAKING CHANGES

* **reasoning:** only calls of tools not marked reads are counted, unless max_tool_calls is set
* **reasoning:** a run at a limit stops as not finished, unless its function says continue
* **definitions:** prompt_sha256 and prompt_bytes name a run's prompt kept outside its record
* **tool-servers:** a function reads the text of a file a tool answers as an embedded resource
* **ledger:** a secret on SQLite is written through the ledger's one writer, not a pool of its own
* **interaction:** a person is told what became of their reply unless the function says otherwise
* **definitions:** a run's payloads are carried unresolved, and each reader says how it reads them
* **operations:** the rebuilding kind and its problem type leave, since nothing raises them
* **interaction:** an interaction function asks a system, a person or an agent, never a sign-in
* **reasoning:** a tool error is read as any error, and no run waits for a person's approval
* **global:** the memory type leaves, and a playbook has six function types

### Features

* **api:** /debug shows a person everything an agent receives, with search ([68cb5b7](https://github.com/BeOnAuto/runtime/commit/68cb5b73266eb399a05fcdec25679994acd78859))
* **api:** a connection takes signed deliveries at its own addresses ([231cf64](https://github.com/BeOnAuto/runtime/commit/231cf6447911b4f5db613f4e5abf79b1504ef8bc))
* **api:** an agent connects a service with no published OpenAPI document by writing one ([79a755a](https://github.com/BeOnAuto/runtime/commit/79a755a3d78a0c4271c5ecad8cb29d66df76a5a9))
* **api:** give-tools gives each use of a tool the function type its mark calls for ([ef97cbc](https://github.com/BeOnAuto/runtime/commit/ef97cbc1fc739aaebcdf62446589b9acf2038bcd))
* **api:** start and the first-playbook recipe start from the job, a function of its type per part ([7759f6f](https://github.com/BeOnAuto/runtime/commit/7759f6f2f64a4fc6ca80e8df18498f461c390840))
* **api:** start and the recipes name no field of business and say each rule plainly ([fc3bb42](https://github.com/BeOnAuto/runtime/commit/fc3bb42c78934492182bc9af94e287c5b3e48147))
* **api:** the debug page renders without a runtime of its own ([c85e3e6](https://github.com/BeOnAuto/runtime/commit/c85e3e63f2214e0ce4f6c59038145655c5ea1cc8))
* **api:** the instructions send an agent to the guide start, which says what a workflow owns ([b43a039](https://github.com/BeOnAuto/runtime/commit/b43a039800d68487fcf81b24bb07c14f74a8e4a5))
* **api:** the instructions, the listing and the welcome say which function type each part takes ([7759f6f](https://github.com/BeOnAuto/runtime/commit/7759f6f2f64a4fc6ca80e8df18498f461c390840))
* **connections:** a connection keeps a signing secret for what its service sends ([689815f](https://github.com/BeOnAuto/runtime/commit/689815f1154d174441c830aeb5d4d378fcdf0a39))
* **connections:** a connection made through a gateway keeps its account and its key ([d9cb391](https://github.com/BeOnAuto/runtime/commit/d9cb3916129bcbd18163ab587a2b1f4f48a051f1))
* **connections:** a key credential carries instructions, a key page and a format ([3564beb](https://github.com/BeOnAuto/runtime/commit/3564beb7888fd383642b9ba2ff790f49e8fb6a6a))
* **connections:** an HTTP API is given its OpenAPI document whole, and read as it is added ([f85f65a](https://github.com/BeOnAuto/runtime/commit/f85f65aeead3e1bb94b84e19b6ff8925018f9735))
* **connections:** approving a connection takes the playbooks that may use it ([f7d875b](https://github.com/BeOnAuto/runtime/commit/f7d875b8e32f5d75dbce0cdf1fd344e742a5a554))
* **connections:** the link of a document given whole names the calls its entry allows ([380b374](https://github.com/BeOnAuto/runtime/commit/380b374ee130a617527097b502c5fe6ab400d743))
* **connections:** the list of providers says whether a connection acts as the app ([aff6fa5](https://github.com/BeOnAuto/runtime/commit/aff6fa582a05d61828499ca489ecf11502831e00))
* **connections:** which playbooks may use a connection can be changed after it is added ([873afde](https://github.com/BeOnAuto/runtime/commit/873afde04227eec10df48a4ff439b2e887ecbf80))
* **definitions:** a definition's document, overview and diagram are kept once, behind the switch ([aab12b4](https://github.com/BeOnAuto/runtime/commit/aab12b4e2fafccf3cd447a9450e1789dd385b634))
* **definitions:** a document not read just now is waited for, and read once a process ([cd81690](https://github.com/BeOnAuto/runtime/commit/cd81690fa57f951a5a7acd0b4ec21e1eac60cff8))
* **definitions:** a retired definition can be restored, paused ([da97992](https://github.com/BeOnAuto/runtime/commit/da97992ed0f100e7002821d139554c5b559dd8bc))
* **definitions:** a run whose value is lost ends with its reason, and can always be ended ([ef97cbc](https://github.com/BeOnAuto/runtime/commit/ef97cbc1fc739aaebcdf62446589b9acf2038bcd))
* **definitions:** a run's ending keeps a long prompt outside the fact ([7d76f38](https://github.com/BeOnAuto/runtime/commit/7d76f38e8ed20667b5e74c76b8c43c60d06aeee8))
* **definitions:** a run's input, output and answer are kept once, behind the switch ([83b5d0f](https://github.com/BeOnAuto/runtime/commit/83b5d0f1592e3a9e16cb7540c437c724b56a84ce))
* **definitions:** a run's payloads are carried unresolved, and each reader says how it reads them ([e886b58](https://github.com/BeOnAuto/runtime/commit/e886b581fe183bb5dfbdda57082669dd34dc33a1))
* **definitions:** a shell ends a started run with a refusal before its next attempt reads anything ([aee15d8](https://github.com/BeOnAuto/runtime/commit/aee15d87fff65801520a23e626ccaf235eff7c80))
* **definitions:** a workflow's page takes a glance, which Studio's Overview and share cards show ([5f55d4b](https://github.com/BeOnAuto/runtime/commit/5f55d4b5a3497f8af46f347e7187d4e23956fac9))
* **definitions:** current definitions kept as a read model, staged by a switch that ships off ([f3ca47b](https://github.com/BeOnAuto/runtime/commit/f3ca47b8b9a7f179e2d5ea774abdacf3fdc7ea58))
* **definitions:** every definition has a permanent id, and layout 23 fills its name from the facts ([be9a487](https://github.com/BeOnAuto/runtime/commit/be9a48793a369f5c7268abaf439b784eee3c7034))
* **definitions:** prompt_sha256 and prompt_bytes name a run's prompt kept outside its record ([58ab077](https://github.com/BeOnAuto/runtime/commit/58ab0778ba60053e19183b297a871149f255580b))
* **definitions:** the definitions read model meets its review's conditions before shadow ([1ad32d4](https://github.com/BeOnAuto/runtime/commit/1ad32d421160c27955f472c163e4327929094db8))
* **generation:** an asset is read by its id, with a fresh address and byte ranges ([72ef78a](https://github.com/BeOnAuto/runtime/commit/72ef78a669ad813df7d7ae7928c52c794d43679b))
* **generation:** gpt-image-2.6-flare takes the place of gpt-image-1-mini ([af973c1](https://github.com/BeOnAuto/runtime/commit/af973c133ab2a7f23945351b5b8ef505f5c31cdd))
* **generation:** the models a generation function may name are listed with their limits ([8b3c3d4](https://github.com/BeOnAuto/runtime/commit/8b3c3d4118c2d7f298f6790b94ebb2f167a9173b))
* **global:** a request's delivery carries takes_answer, beside its request, to the host's fetch ([e4da061](https://github.com/BeOnAuto/runtime/commit/e4da061c9fd73628b09c1cb9b4cfb2c20b3394a0))
* **global:** a workflow's triggers and the playbook's events have guides of their own ([a27f947](https://github.com/BeOnAuto/runtime/commit/a27f94734fb90b9c5eeefb383958d2e46cdf911a))
* **global:** an agent sets a connected service up before the first run ([d1708ae](https://github.com/BeOnAuto/runtime/commit/d1708aee8b2f38b8c495503f6067bd75cba7963f))
* **global:** the memory type leaves, and a playbook has six function types ([bba9886](https://github.com/BeOnAuto/runtime/commit/bba988654e541e5c1b9fbf68b628993d85b8ab48))
* **interaction:** a connection's tools say when a message through it can be a card ([7d76f38](https://github.com/BeOnAuto/runtime/commit/7d76f38e8ed20667b5e74c76b8c43c60d06aeee8))
* **interaction:** a conversation is read now when its connection is woken ([c77e1c1](https://github.com/BeOnAuto/runtime/commit/c77e1c1e9ce189e68a9a29f86c294a1bc3275c1c))
* **interaction:** a delivery records the reading of its replies ([08a7760](https://github.com/BeOnAuto/runtime/commit/08a77604d0b7a5d9017dd5bd4df30e9e6b867616))
* **interaction:** a person is told what became of their reply unless the function says otherwise ([973e61f](https://github.com/BeOnAuto/runtime/commit/973e61fb5cd839f2f44ca3f027461d81a8275bac))
* **interaction:** a request renders its message as a card for Slack ([9f7aa18](https://github.com/BeOnAuto/runtime/commit/9f7aa18ce938b09c6d679d20b4932cd7066a0c50))
* **interaction:** a request says where it waits, and is read no sooner than its provider allows ([d88c975](https://github.com/BeOnAuto/runtime/commit/d88c975b0b0e9411db842a64c670aadf17ef4e54))
* **interaction:** a request that ends says so where it was asked ([35b6924](https://github.com/BeOnAuto/runtime/commit/35b69247e553b64df29439394f2a59f7a2b17f97))
* **interaction:** a run asks the person it acts for to sign in to a site, and waits ([76117a5](https://github.com/BeOnAuto/runtime/commit/76117a5d55496c3104c4f1a7e33b882f470cd29b))
* **interaction:** an interaction function asks a system, a person or an agent, never a sign-in ([08882b9](https://github.com/BeOnAuto/runtime/commit/08882b9cdc85793caa162422a569cabe43139b23))
* **ledger:** a fact is measured with its kept payloads, and a stream is read in pages ([8886c5a](https://github.com/BeOnAuto/runtime/commit/8886c5a12d31eb14c4c176342ec15c5bb078eaca))
* **ledger:** a key names a playbook or a definition, and the org leads the run tree and event id ([7b095e5](https://github.com/BeOnAuto/runtime/commit/7b095e546e6e438313c7a7c9c876a58d4e098ce6))
* **ledger:** content may be kept until an expiry, and a chore erases what is past it ([8adfdfd](https://github.com/BeOnAuto/runtime/commit/8adfdfd35726e0cd7e5aa50bb9bad696da34da54))
* **ledger:** names of definitions judged per append in one lock order, and layout steps in code ([e9db9e6](https://github.com/BeOnAuto/runtime/commit/e9db9e67402b99c74b0b20d0bd66119c19452118))
* **ledger:** one append to several streams, all or nothing ([78f4914](https://github.com/BeOnAuto/runtime/commit/78f49145379b25f3fe0ad1d6971f1d973adf019d))
* **ledger:** the heads of recorded content gain when their content expires and when it was erased ([9a082a3](https://github.com/BeOnAuto/runtime/commit/9a082a3bc247c261b51b47c47831461f897010f8))
* **lookup:** a lookup reads the outputs of the playbook's own runs ([6e58247](https://github.com/BeOnAuto/runtime/commit/6e58247ee10ae3113b49633ad0c2bf26e4dd76f5))
* **operations:** a fact's payload, inline or kept outside by its digest ([a987e7f](https://github.com/BeOnAuto/runtime/commit/a987e7fb46240327cac9d3d108e44b58840a8c6c))
* **operations:** a payload is kept once past 16 KiB, and never within what a page shows whole ([5cf4e8b](https://github.com/BeOnAuto/runtime/commit/5cf4e8bcba7b2b36eb23ac9449759de678834677))
* **operations:** a refusal for content not read just now and a value lost from storage are read ([2f17556](https://github.com/BeOnAuto/runtime/commit/2f1755646c16592249e5cdacee84d0a6212fb15b))
* **operations:** a value kept outside is read through the cache and the gate whatever the option ([b011da7](https://github.com/BeOnAuto/runtime/commit/b011da71b068127db584a32f9252af78f98f0b2e))
* **operations:** the limit a run stopped or answered at is read before anything records it ([bb25004](https://github.com/BeOnAuto/runtime/commit/bb250045baa5b48e6bb49326c4da9a73412dd27a))
* **playbooks:** a retired playbook can be restored ([206ffd6](https://github.com/BeOnAuto/runtime/commit/206ffd6a1b310c4d8405cdf93ce9c7b8c61d3d32))
* **providers:** a provider's entry says how its conversations are replied to and marked ([0fb9ca4](https://github.com/BeOnAuto/runtime/commit/0fb9ca47bd7ebfe62727e6735b37d81e7b9d53f4))
* **providers:** slack searches with search.messages and reads history fifteen messages a call ([c9dd607](https://github.com/BeOnAuto/runtime/commit/c9dd60795389c3316f1ca1e6b8dc78e081c3a136))
* **providers:** the slack provider reaches Slack's Web API through Auto's own app ([51f04ce](https://github.com/BeOnAuto/runtime/commit/51f04cea76a567675453264dbf90f5d6cf20a3ef))
* **reasoning:** a function's max_input_tokens sets what its run may read, up to its host's most ([65d3b91](https://github.com/BeOnAuto/runtime/commit/65d3b9118abe92006d1707ae3fd498a512fb55ff))
* **reasoning:** a portable schema is enforced on every provider and read back exactly ([98fc2e2](https://github.com/BeOnAuto/runtime/commit/98fc2e2d37c3e17280b2cf665168018ed544faaa))
* **reasoning:** a run at a limit stops as not finished, unless its function says continue ([4eaf1c5](https://github.com/BeOnAuto/runtime/commit/4eaf1c531314181c197081e052ecb0b4f19313f2))
* **reasoning:** a run waits for a person's approval of a tool call and sends it once ([a3a5839](https://github.com/BeOnAuto/runtime/commit/a3a583946c12140b1009fad1a92818af8ca246a0))
* **reasoning:** a schema a provider refuses is described to the model instead ([de9e18e](https://github.com/BeOnAuto/runtime/commit/de9e18e0caad1ee4ff0f6713d8eb2572f825b6fb))
* **reasoning:** a tool error is read as any error, and no run waits for a person's approval ([63d9a97](https://github.com/BeOnAuto/runtime/commit/63d9a9788d31241b952a60bea3dffd503162ff4a))
* **reasoning:** an agent is told when its answer schema cannot be enforced ([5e6aa05](https://github.com/BeOnAuto/runtime/commit/5e6aa05753dbf20c97381ac8e4c996e70ae298ce))
* **reasoning:** an answer that misses its schema is asked for once more, with the issues ([c0c6ea4](https://github.com/BeOnAuto/runtime/commit/c0c6ea4058b58f5c12988ecd88dbd2c538fdc375))
* **reasoning:** only calls of tools not marked reads are counted, unless max_tool_calls is set ([d926d9b](https://github.com/BeOnAuto/runtime/commit/d926d9be692fe1f61949af2ff5f7b637dc220488))
* **reasoning:** the answer check tells which models take the portable schemas ([463d988](https://github.com/BeOnAuto/runtime/commit/463d98829dabbb1622c386623d8240287eb295cf))
* **server:** payload offloading is a setting, on by default, and a start refuses missing content ([7e676cf](https://github.com/BeOnAuto/runtime/commit/7e676cf75642bcb2e5949fd7e05e7cb52212c47a))
* **tool-servers:** a server's row says in words that its messages can be cards ([2442548](https://github.com/BeOnAuto/runtime/commit/2442548ccbeb12b069ce7bc9840ba08518e730d7))
* **tool-servers:** a tool call may send 256 KiB of arguments, as much as a run may take ([b6d4397](https://github.com/BeOnAuto/runtime/commit/b6d4397d59bf40b47b56c63a969e9244db0bf716))
* **tool-servers:** an image a tool answers is kept as an asset of the run ([2ee16b3](https://github.com/BeOnAuto/runtime/commit/2ee16b3a9d3c8a6119e6d25b49cfa93000a92773))
* **workflow-engine:** a run log may keep a large held value once, by its digest, in state format 12 ([3d81925](https://github.com/BeOnAuto/runtime/commit/3d81925cf87d60e04de8dcb29bd22e01c898326b))
* **workflow-engine:** a workflow run keeps the cause of the step that ended it ([3cbc519](https://github.com/BeOnAuto/runtime/commit/3cbc519f712ec9eed10b9a26ef85e3ce02119560))
* **workflow-host:** a playbook held at a record keeps its hold through a restart and is seen ([ef97cbc](https://github.com/BeOnAuto/runtime/commit/ef97cbc1fc739aaebcdf62446589b9acf2038bcd))
* **workflow-host:** a refused start keeps the refusal's kind, because and trigger ([2f0d29f](https://github.com/BeOnAuto/runtime/commit/2f0d29fc7f76ba64473df0039fff21b9aeafa940))
* **workflow-host:** a schedule holds a due time its workflow could not be read for ([7759f6f](https://github.com/BeOnAuto/runtime/commit/7759f6f2f64a4fc6ca80e8df18498f461c390840))
* **workflow-host:** a shell answers a waiting call whose run never ended ([d0b9e88](https://github.com/BeOnAuto/runtime/commit/d0b9e88310607dc97712430983858c6bc40173d4))
* **workflow-host:** a triggered run names the person whose sign-ins it uses ([0fd97ff](https://github.com/BeOnAuto/runtime/commit/0fd97ff541dbfb8997f0037b82c1522528a8c96f))
* **workflow-host:** the workflow host keeps values outside, and a workflow is handed what was kept ([f30ab11](https://github.com/BeOnAuto/runtime/commit/f30ab116afbb6e0ece411f7219d6e9dea614ca72))
* **workflow-host:** triggers, listeners and pages are given the output a run keeps outside ([1888737](https://github.com/BeOnAuto/runtime/commit/1888737ae6425bdc84f91930baf10311b876dc64))


### Bug Fixes

* **activity:** the reader of the activity comes from the credential, and no address goes in its URL ([6f4756f](https://github.com/BeOnAuto/runtime/commit/6f4756f5bce2ac109d3d3258bd05c4c9ba689f42))
* **ci:** the npm package smoke waits for the ready line before it counts it ([e60b687](https://github.com/BeOnAuto/runtime/commit/e60b687c9bded19540d6e6fca4745960147cd10a))
* **connections:** a credential that cannot be read names no key to the caller ([3aac647](https://github.com/BeOnAuto/runtime/commit/3aac64756df241ddd8473eb4796465a3ab5ef88c))
* **connections:** the watched ledger of the tests passes on the erasure of what is due ([4ef50ce](https://github.com/BeOnAuto/runtime/commit/4ef50cea0f74816a260276b43e0d93d8271d0a51))
* **definitions:** a change storage could not show yet and a schedule's skipped run say so plainly ([ef97cbc](https://github.com/BeOnAuto/runtime/commit/ef97cbc1fc739aaebcdf62446589b9acf2038bcd))
* **deps:** the model clients and Azure sign-in run on dependencies with no known advisories ([88bbf84](https://github.com/BeOnAuto/runtime/commit/88bbf84be4ba75158b1e6922bba991a763b9ec9d))
* **global:** the license words name the account holder or an organization admin ([8c2eaf6](https://github.com/BeOnAuto/runtime/commit/8c2eaf687bc3685257b0386ed732b4c4ee3255c4))
* **interaction:** a message the playbook sent is never read as a reply ([8ce060b](https://github.com/BeOnAuto/runtime/commit/8ce060bba6bfb3eaba3316bc5101eb46e1796cc2))
* **interaction:** a reply in a message's thread reaches its request, however many others wait ([1d2a786](https://github.com/BeOnAuto/runtime/commit/1d2a7869276343a3842026dae23c39b0fe7098df))
* **ledger:** a projection's fill holds one read of facts at a time, however long the history ([7759f6f](https://github.com/BeOnAuto/runtime/commit/7759f6f2f64a4fc6ca80e8df18498f461c390840))
* **ledger:** a secret on SQLite is written through the ledger's one writer, not a pool of its own ([da85ded](https://github.com/BeOnAuto/runtime/commit/da85ded549e2e05fbecc55b941b6fe3c7fd82d4c))
* **ledger:** a write on SQLite outside a transaction waits for the one writer instead of failing ([7759f6f](https://github.com/BeOnAuto/runtime/commit/7759f6f2f64a4fc6ca80e8df18498f461c390840))
* **ledger:** a write that waits for SQLite's writer is traced under its caller ([4f5d970](https://github.com/BeOnAuto/runtime/commit/4f5d970bfc4bb7d0c512340401f84e5ad1ef0183))
* **prediction:** the default history never exceeds the window ([2cb75b0](https://github.com/BeOnAuto/runtime/commit/2cb75b03feb4d4b919528471f6e1879e0be9ef32))
* **providers:** slack asks for no search:read, and a reconnect asks nothing its provider dropped ([79c0a47](https://github.com/BeOnAuto/runtime/commit/79c0a47c6c08d431a433014cfb6730b5d3c37bca))
* **reasoning:** a composer can scrub its own secrets from provider messages ([a64ce0b](https://github.com/BeOnAuto/runtime/commit/a64ce0b0636505db00e9ccabc996b8d64c44fc10))
* **reasoning:** a gateway lacking structured outputs gets the schema in the prompt, not json_object ([acf348a](https://github.com/BeOnAuto/runtime/commit/acf348ad06e0bd08de533f6f7d2203ea129fea72))
* **reasoning:** a run cut at max_output_tokens says what to move out before it says raise the limit ([ef97cbc](https://github.com/BeOnAuto/runtime/commit/ef97cbc1fc739aaebcdf62446589b9acf2038bcd))
* **reasoning:** an interrupted call that may change something is never sent again ([1f2427f](https://github.com/BeOnAuto/runtime/commit/1f2427f38e9ec9e2301fe7c335e2ec8cf78bdca7))
* **tool-servers:** a function reads the text of a file a tool answers as an embedded resource ([468096e](https://github.com/BeOnAuto/runtime/commit/468096e969e5c27ef3b427733a5c095657d092d1))
* **workflow-host:** a hold outlasts an unknown reason and a clock gone back; a loss is said once ([6efd9a4](https://github.com/BeOnAuto/runtime/commit/6efd9a4bf70c5e9dcc48e19921fdee3d84c767e6))
* **workflow-host:** a run that ended lets go of its calls' payloads a day on, keeping their rows ([1e027e5](https://github.com/BeOnAuto/runtime/commit/1e027e541792a530171a7155ef7845657e2dc392))


### Performance Improvements

* **activity:** list_activity reads the rows of the org's playbooks four at a time ([2a172e5](https://github.com/BeOnAuto/runtime/commit/2a172e5360db0ae40f19afdd0b6dbb719338c7b9))
* **ledger:** a large playbook is read in bounded pieces ([d0ef8ad](https://github.com/BeOnAuto/runtime/commit/d0ef8adb01fb608569df4757efa5a72abd0c2212))
* **tool-servers:** the org's search asks for the providers it offers beside the servers it lists ([ebf6dd9](https://github.com/BeOnAuto/runtime/commit/ebf6dd93dbbe0ff260758241e7965dcb69991d49))
* **tool-servers:** the org's search keeps what each server listed for five minutes ([2e6db1a](https://github.com/BeOnAuto/runtime/commit/2e6db1a3e9e53e6fce213c46463fc8de206626e1))


### Code Refactoring

* **operations:** the rebuilding kind and its problem type leave, since nothing raises them ([5118f91](https://github.com/BeOnAuto/runtime/commit/5118f91cc76aa5a8dad5ae210dc183ad36edf817))

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
