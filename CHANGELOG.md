# Changelog

## [0.59.0](https://github.com/BeOnAuto/runtime/compare/v0.58.0...v0.59.0) (2026-11-21)


### ⚠ BREAKING CHANGES

* **goals:** a goal keeps its own record and results
* **server:** a server that signs people in now decides every call by the role each person holds. The first person to sign in is the admin, and everyone who signs in after them is a viewer, who can read and comment but cannot run or change anything until an admin gives them another role. A person who no longer holds a role is refused every call at once. The server also loads its access policies as it starts, so their memory, about 100 to 130 MiB, is taken from start, and it does not start if it cannot load them.
* **server:** IDENTITY_ISSUER, IDENTITY_JWKS and IDENTITY_JWKS_URL are no longer supported: a runtime given one of them stops at start and names it, so remove it. The OpenAPI document names the openIdConnect scheme only where the runtime signs people in, with the runtime's own OpenID Connect metadata, and names the permissions each operation needs as roles of its bearer requirement. The members of a runtime with PUBLIC_URL and no OIDC_ISSUER now act in the org default. Before, each acted in an org whose id was their Auto organization's id, and the playbooks kept there are reached only with an API key of that org. OIDC_SCOPES or OIDC_TOKEN_ENDPOINT_AUTH_METHOD set without OIDC_ISSUER now stops such a runtime at start, so remove them.
* **server:** A runtime with PUBLIC_URL and no OIDC_ISSUER signs its members in itself, with their Auto accounts, as its own OAuth 2.1 authorization server, and no longer admits the access tokens of the identity service IDENTITY_ISSUER names. Its PUBLIC_URL must be an https URL; a runtime that only its own computer reaches sets ACCESS_MODE=local instead.
* **connections:** in a provider entry, a websocket destination's `credential` names an app credential of the entry's secret way, which the way declares in `app_credentials`. An entry you added whose websocket destination names a `credential` its secret way does not declare there is refused when the runtime starts: declare it under `app_credentials` of the secret way.
* **global:** a ledger a release before this one made, of layout 25 or earlier, is refused as the server opens it, left as it was, and needs a new install. definitions are filed under the definition's key; no reader of the earlier filing is kept. runs are filed under the definition's key; no reader of the earlier filing is kept.
* **definitions:** a run's output past 1 MiB is now kept in part as assets of its playbook, recorded with the kind text and made by function_output. Once such an asset is kept, do not roll back to 0.57.0 or an earlier release until it expires (ASSET_RETENTION_DAYS, 90 by default): 0.57.0 reads the asset but hands it on to the next function or tool as its description rather than its content, and an earlier release cannot read it. A computation may now return up to an eighth of its sandbox's memory as JSON.

### Features

* **activity:** a comment on a function or workflow follows it when it moves or is renamed ([d185bc0](https://github.com/BeOnAuto/runtime/commit/d185bc046c662b04b669df4499ac9ab1e98f05fc))
* **activity:** a comment's row in the activity list names its address as it is now ([d265429](https://github.com/BeOnAuto/runtime/commit/d265429e6902d5afd5fc4b2664ff6647126e9476))
* **api:** a proven delivery hands on the event it carries ([6155886](https://github.com/BeOnAuto/runtime/commit/61558868918bc8ebd0e6f31460e006a6ba7a61bb))
* **connections:** a connection's change asks its playbooks for a subscription round ([1cb3be9](https://github.com/BeOnAuto/runtime/commit/1cb3be90ae5ba1813f51d61a47b2168bb88bd62f))
* **connections:** a key is tested through the tool its way names before it is kept ([07544bd](https://github.com/BeOnAuto/runtime/commit/07544bdc9faf1e997c1c68e6f6bee0ece0bf5355))
* **connections:** a playbook's events show each subscription made, failed or removed at a service ([080bebb](https://github.com/BeOnAuto/runtime/commit/080bebb740a87946018be58e6690bfd9e1832f14))
* **connections:** a saved trigger asks for its subscription ([b708381](https://github.com/BeOnAuto/runtime/commit/b70838170593ffeefcdf8c89681eb93ba25a5531))
* **connections:** a server given by hand says how its service sends ([b3856c7](https://github.com/BeOnAuto/runtime/commit/b3856c7240f5862548af4c0de64f688e5a4b6b94))
* **connections:** the subscription loop's connection carries the account it was connected in ([4a256af](https://github.com/BeOnAuto/runtime/commit/4a256aff4e8abdbb21bdb9cd73628f4b8b02c63e))
* **connections:** the subscriptions of a playbook are recorded and kept, at ledger layout 28 ([4a8e452](https://github.com/BeOnAuto/runtime/commit/4a8e45201bddcb4bed6cc752f25e95ff8dbe3559))
* **definitions:** a function's output past 1 MiB keeps its largest members as files ([c356618](https://github.com/BeOnAuto/runtime/commit/c35661846c70a0fb6cfc7756ffb757f6eb350563))
* **definitions:** move_definitions moves functions and workflows to another playbook ([26cbbaa](https://github.com/BeOnAuto/runtime/commit/26cbbaaaa53698558a8f503501315d53c7db6cee))
* **definitions:** sources under /connections/ are kept for the runtime ([fc84bcf](https://github.com/BeOnAuto/runtime/commit/fc84bcf153481f2dbda0598fe168cc508336ed73))
* **definitions:** update_definition renames a function or workflow with new_name ([f27f397](https://github.com/BeOnAuto/runtime/commit/f27f39780e3ea39fb732c9157d0c3f8581413e6a))
* **global:** runs are filed under their definition, and stores move to ledger layout 27 ([942fe7a](https://github.com/BeOnAuto/runtime/commit/942fe7aa08f0afaf31694c0476354ef770389088))
* **goals:** a goal keeps its own record and results ([4652053](https://github.com/BeOnAuto/runtime/commit/4652053d8eef63da2ac1947443edbff9c36b7411))
* **goals:** a goal's id can be changed, and its workflows follow ([e54b842](https://github.com/BeOnAuto/runtime/commit/e54b8424d6a462040df0ce93c97fe456bb6e63de))
* **goals:** a person can dismiss a thing of a goal for everyone, and restore it ([74bbd35](https://github.com/BeOnAuto/runtime/commit/74bbd35c5592bf1e0d555a781fac6fa0e4dd298d))
* **interaction:** a message a connection shows as a card is written as one, laid out by the guide ([f5e0444](https://github.com/BeOnAuto/runtime/commit/f5e0444abe34518d4d0b97895e47aa3db623a882))
* **interaction:** replies are read with the run's input, and from an answer that is the list ([9af4098](https://github.com/BeOnAuto/runtime/commit/9af4098d1558d4b28b335fb7f08eea5d800c9887))
* **ledger:** a host may give the catch-up of projection tables a budget ([1642b48](https://github.com/BeOnAuto/runtime/commit/1642b48d0c48b36ac1286f2a602879b1571d95f3))
* **ledger:** a projection table is filled in pages, each committed with its checkpoint ([62d006a](https://github.com/BeOnAuto/runtime/commit/62d006aff807cc2fa8dbc489faa7b9a384102b08))
* **providers:** an entry declares the events its service reports ([1c249af](https://github.com/BeOnAuto/runtime/commit/1c249afc949d0d899d72b96ca882ef291c8cfb41))
* **providers:** an entry gives the steps of the page where a person approves its key ([65baf32](https://github.com/BeOnAuto/runtime/commit/65baf32a99edb4a03f26bac7e36af60670a76bf0))
* **providers:** slack-bot makes its app from a link, checks its token and takes an app-level token ([2f6cd6b](https://github.com/BeOnAuto/runtime/commit/2f6cd6b4e9d24254b20636d417cddcdddb6df57b))
* **providers:** the GitHub entry tells Auto as soon as someone answers ([8123687](https://github.com/BeOnAuto/runtime/commit/8123687aebf51655c6bc20956d75803825bbdaa5))
* **server:** a server that signs people in decides each call by the role each person holds ([1844932](https://github.com/BeOnAuto/runtime/commit/1844932645f616a214be0985bfe1e62ef0e62f95))
* **server:** a server that signs people in manages its members and invites people by link ([492139b](https://github.com/BeOnAuto/runtime/commit/492139bb39d258e28a6ee346836411b3819a75db))
* **server:** a sign-in must carry the claim OIDC_REQUIRED_CLAIM names, with exactly its value ([346794b](https://github.com/BeOnAuto/runtime/commit/346794b620123dabfd92a40dd88edbf4386c5693))
* **server:** a subscription's deliveries are received at the runtime's address ([20b3bf8](https://github.com/BeOnAuto/runtime/commit/20b3bf81f0c80c0b711b51a1c0002096513fb116))
* **server:** admin grant-admin, reset-setup and register-client for whoever runs the server ([9c8c120](https://github.com/BeOnAuto/runtime/commit/9c8c120b07c749fd8fa842ab343f70667fce5d43))
* **server:** an admin sets how people join and the role they join with ([9f8d30c](https://github.com/BeOnAuto/runtime/commit/9f8d30c34e79b4576fdb7fdadf2a31efbc00961f))
* **server:** at sign-in, the name is read from UserInfo and an unasked refresh token handed back ([9c8c120](https://github.com/BeOnAuto/runtime/commit/9c8c120b07c749fd8fa842ab343f70667fce5d43))
* **server:** people and agents sign in through the runtime's own authorization server ([782ae9c](https://github.com/BeOnAuto/runtime/commit/782ae9c66520486367b93bbc083ee01e67c03832))
* **server:** people sign in through their company's own identity provider ([62d006a](https://github.com/BeOnAuto/runtime/commit/62d006aff807cc2fa8dbc489faa7b9a384102b08))
* **server:** the API takes the session of a person who signed in at their company's provider ([62d006a](https://github.com/BeOnAuto/runtime/commit/62d006aff807cc2fa8dbc489faa7b9a384102b08))
* **server:** the definitions list carries each title and generation models carry a name ([964004b](https://github.com/BeOnAuto/runtime/commit/964004ba57f6e4530ebf3d4456296f8bf1d5c080))
* **server:** the first person to sign in is recorded as the admin, each newcomer as a viewer ([773ed6d](https://github.com/BeOnAuto/runtime/commit/773ed6d7ca91782b821e0b296acd2a50189e3e7a))
* **server:** the first sign-in sets the value of the required claim every later sign-in must carry ([9c8c120](https://github.com/BeOnAuto/runtime/commit/9c8c120b07c749fd8fa842ab343f70667fce5d43))
* **server:** the runtime no longer supports IDENTITY_ISSUER, IDENTITY_JWKS and IDENTITY_JWKS_URL ([9c8c120](https://github.com/BeOnAuto/runtime/commit/9c8c120b07c749fd8fa842ab343f70667fce5d43))
* **server:** the server keeps a socket for each app credential its connections hold ([b29e5f9](https://github.com/BeOnAuto/runtime/commit/b29e5f918f1d349f8e69272745417df96b22177e))
* **server:** with OIDC_ISSUER and no client, the server registers itself with the identity provider ([fb2bbe7](https://github.com/BeOnAuto/runtime/commit/fb2bbe7712b7d0aa2450e3efa7fa42ec1cb3841f))
* **server:** with PUBLIC_URL and no OIDC_ISSUER, people sign in at the default identity provider ([9c8c120](https://github.com/BeOnAuto/runtime/commit/9c8c120b07c749fd8fa842ab343f70667fce5d43))
* **tool-servers:** a sign-in asks for each address its provider's requests go to ([d7d8509](https://github.com/BeOnAuto/runtime/commit/d7d8509d04e1a3f82e3b13dbbc8c0c0638454895))
* **workflow-host:** a connection's event is taken in for the triggers that name it ([8f9bbde](https://github.com/BeOnAuto/runtime/commit/8f9bbde05670994cbc35a60ca97e74f405ecff2c))


### Bug Fixes

* **access-control:** a request reads the caller's roles once and decides all its tools together ([09f7264](https://github.com/BeOnAuto/runtime/commit/09f7264d7d0938dda1f1e9e0961fa7dc1698bf7c))
* **api:** a delivery is proven by the secret of its own subscription ([e8e9e77](https://github.com/BeOnAuto/runtime/commit/e8e9e778f7191ea690caebd2ac5b573244c7aa86))
* **definitions:** a value given as JSON text is taken as the value it holds, by one rule ([67bc99d](https://github.com/BeOnAuto/runtime/commit/67bc99d12e24efeab48e3437a92fcd374a780102))
* **deps:** hono 4.13.18 and its Node adapter 2.1.7 close published advisories ([62d006a](https://github.com/BeOnAuto/runtime/commit/62d006aff807cc2fa8dbc489faa7b9a384102b08))
* **generation:** what a generation function makes keeps its address ([9f8d30c](https://github.com/BeOnAuto/runtime/commit/9f8d30c34e79b4576fdb7fdadf2a31efbc00961f))
* **goals:** a result that arrives late keeps its measure ([0704628](https://github.com/BeOnAuto/runtime/commit/070462854d23e55bbb9d450a5d892b8b2f841ca3))
* **interaction:** a reply in a request's Slack thread answers it ([0704628](https://github.com/BeOnAuto/runtime/commit/070462854d23e55bbb9d450a5d892b8b2f841ca3))
* **interaction:** a reply to a request sent to a person counts from that person alone ([0cdee48](https://github.com/BeOnAuto/runtime/commit/0cdee487ad920990ce672e3eba25ffa21904c8a0))
* **interaction:** an answer sent as JSON text is taken as the value it holds ([a2af01f](https://github.com/BeOnAuto/runtime/commit/a2af01fe6ae85e7076da0768b409af5d9306e51e))
* **interaction:** notices naming no conversation read a connection no faster than one conversation ([93a9106](https://github.com/BeOnAuto/runtime/commit/93a9106189e3a87183b5a495491f1116229cfdce))
* **operations:** an argument given as JSON text is taken as the value it holds, for every tool ([587e205](https://github.com/BeOnAuto/runtime/commit/587e205ae8af82d9e404c58c748f254ac63aafdd))
* **providers:** a connection added again is given a webhook address of its own ([5249301](https://github.com/BeOnAuto/runtime/commit/5249301ed0adb18764191d529dfe873f426c7983))
* **providers:** a request to a service refuses an address its values changed ([975a5c3](https://github.com/BeOnAuto/runtime/commit/975a5c3b49db96d1deb0a21856f0d134370c9869))
* **providers:** the Slack Bot entry declares its socket's heartbeat ([7baf80c](https://github.com/BeOnAuto/runtime/commit/7baf80cd2f35d2948dcd7d45ce114c06205e63c6))
* **providers:** the Slack Bot key's instructions follow the page where a person approves it ([32faf62](https://github.com/BeOnAuto/runtime/commit/32faf6293f3aee7f650e910b17947d8d66ce4a5b))
* **workflow-host:** a host handed a clock sleeps on it alone ([38fd4e8](https://github.com/BeOnAuto/runtime/commit/38fd4e87655cd58af4c636fd990e2b5dfe6881d8))
* **workflow-host:** a retired playbook takes no event of a connection ([60cd6d1](https://github.com/BeOnAuto/runtime/commit/60cd6d147378f1b238188be40a136052555c06ee))
* **workflow-host:** the intake judges a playbook's triggers as they were saved ([0e7f47f](https://github.com/BeOnAuto/runtime/commit/0e7f47fe18160195d1f68308b915685bcff74959))

## [0.58.0](https://github.com/BeOnAuto/runtime/compare/v0.57.0...v0.58.0) (2026-11-18)


### ⚠ BREAKING CHANGES

* **providers:** in a provider entry, the calls `subscribe`, `renew` and `unsubscribe` of `events.destinations` no longer read `with`, `sent.conversation` or `sent.id`. They read `topic`, the topic the destination renders: put what the call needs into `topic` and read `{{ topic }}`. A call written as a request places `{{ secret }}` in its `body`, not in its `url`, and needs an entry whose credential is a bearer token. A websocket destination's `open` is a request, `method`, `url` and `address`, sent with the app's `credential`; `open.tool` and a `wss` address written in `open.url` are no longer read. A destination's `wake` is renamed `filter`, with the same keys inside it. An entry you added that uses one of these is refused when the runtime starts.
* **reasoning:** a run of a reasoning function whose prompt writes a list or an object whole, such as {{ input.account }} where account is an object, is now rejected as invalid_input with the part and the line of the prompt, where it used to send the model the items run together or [object Object] and succeed. Write one of its fields, or {{ input.account | json }} to send it as JSON.
* **tool-servers:** an operator who runs the server, the image or the auto-runtime command changes nothing. A program that composes the core gives the most one tool call may send: every ToolAccess answers mostRequestBytesTo(server), which makeToolAccess gives from its option mostRequestBytes, 16 MiB unless given; toolBounds.argumentBytes is gone, with requestBytes, stdioRequestBytes and handArgumentBytes in its place; admission of @on.auto/tool-servers/policy takes each call's mostBytes; renderedArguments of @on.auto/definitions/tool-blocks takes the bound as its fourth argument; DocumentReading takes mostRequestBytesTo, and so do the tools of CallPorts, InteractionPorts and LookupPorts. a program that composes the core and implements ToolAccess itself also answers mostRequestBytes, the most one call may send to a server that is not started as a program; makeToolAccess answers it from its option mostRequestBytes, 16 MiB unless given.

### Features

* **definitions:** a kept text is read within its reader's bound, and a workflow passes it whole ([341fcd1](https://github.com/BeOnAuto/runtime/commit/341fcd16659a3c34ccf7cfa5fe19c3b8c2d73d04))
* **generation:** current image, speech and video models, and OpenAI's speech retires on its day ([9f0f398](https://github.com/BeOnAuto/runtime/commit/9f0f3989e3a8353eba8ab22fc2d3b2be1acc1b2f))
* **goals:** goal cards, owner pages say what and why ([6027488](https://github.com/BeOnAuto/runtime/commit/602748811f0c3af85a7c3ba84ad32c889a7fa4a4))
* **interaction:** a shell can show the typing indicator for a delivered reply a request awaits ([a06a500](https://github.com/BeOnAuto/runtime/commit/a06a5004bbe54f490e6325309e8fd6345127152e))
* **interaction:** a shell keeps a delivered reply only where a request waits for its message ([d70b407](https://github.com/BeOnAuto/runtime/commit/d70b407a2bb53027e1afb43dfa00ac035396ee70))
* **ledger:** each projection table is recorded as caught up, and one that is not is made again ([17168c2](https://github.com/BeOnAuto/runtime/commit/17168c27e9be7f8974646e714e1bb7603cd97f00))
* **providers:** an entry may say where its deliveries carry the reply ([d1e0419](https://github.com/BeOnAuto/runtime/commit/d1e04190becf874fece64276c5ab30ace1f3a4ca))
* **providers:** an entry's events declare each request one way, and wake is renamed filter ([78d8224](https://github.com/BeOnAuto/runtime/commit/78d822424bedcd0fbbfa0050d91b5c815643066c))
* **tool-servers:** a tool call sends what TOOL_CALL_MAX_REQUEST_MIB sets, and a run takes 1 MiB ([5e34f05](https://github.com/BeOnAuto/runtime/commit/5e34f05254b9bced0cffd950196f7f4cc0bba7c3))
* **tool-servers:** an asset passed whole is written into a tool's request a piece at a time ([c8c508e](https://github.com/BeOnAuto/runtime/commit/c8c508ec000253ad4d1b9aa27f418ce58d646ee0))
* **tool-servers:** an auth block may name discovery issuer and the audience of its token ([5fc0995](https://github.com/BeOnAuto/runtime/commit/5fc0995cd2bcdafbdfc9c5b136df1c688f8690fa))


### Bug Fixes

* **access-control:** the refusal that keeps an org's last admin says what to do ([6027488](https://github.com/BeOnAuto/runtime/commit/602748811f0c3af85a7c3ba84ad32c889a7fa4a4))
* **api:** an agent asks one round of questions, proposes once, and takes one yes ([f27ad74](https://github.com/BeOnAuto/runtime/commit/f27ad74eb04e5d54e9e9e3177e0cc60bbbc99de0))
* **api:** the proposal ends with its closing question, and a changed proposal is asked again ([346ff5a](https://github.com/BeOnAuto/runtime/commit/346ff5a67324a49d6f3262d0ccc4d1795ffe80c9))
* **definitions:** goals read a # written straight before a word as text ([c280ddb](https://github.com/BeOnAuto/runtime/commit/c280ddb54111f625f4f1e95512c55dbe8617633e))
* **interaction:** a reply taken is told before a later reply is told it was not taken ([d1e0419](https://github.com/BeOnAuto/runtime/commit/d1e04190becf874fece64276c5ab30ace1f3a4ca))
* **reasoning:** a prompt that writes a list or an object as text stops the run, naming the line ([6027488](https://github.com/BeOnAuto/runtime/commit/602748811f0c3af85a7c3ba84ad32c889a7fa4a4))
* **workflow-host:** a failed round of the host, or read of its due rows, is tried again at a retry ([41eb366](https://github.com/BeOnAuto/runtime/commit/41eb366c5543f17b588abb0b830946a748f8cfad))
* **workflow-host:** a follower whose start fails asks to be woken at its retry and tries again ([f703335](https://github.com/BeOnAuto/runtime/commit/f703335486dc68dd45ead781dd24c8b5c8f4d024))
* **workflow-host:** a read of when work is next due that fails asks to be woken at a retry ([7afbf2d](https://github.com/BeOnAuto/runtime/commit/7afbf2d92350954ef1061bff707f91d7c2b34037))
* **workflow-host:** a start that waits for a later minute wakes the host when it is due ([c280ddb](https://github.com/BeOnAuto/runtime/commit/c280ddb54111f625f4f1e95512c55dbe8617633e))
* **workflow-host:** after a failed round the follower waits for its retry or a schedule yet to come ([a06a500](https://github.com/BeOnAuto/runtime/commit/a06a5004bbe54f490e6325309e8fd6345127152e))

## [0.57.0](https://github.com/BeOnAuto/runtime/compare/v0.56.0...v0.57.0) (2026-11-16)


### ⚠ BREAKING CHANGES

* **ledger:** @on.auto/runtime/ledger/sqlite3 is now @on.auto/runtime/ledger/sqlite.
* **providers:** the slack provider is removed. A connection made from it is served as a provider this runtime no longer lists: a connection made through your own registered Slack client keeps its recorded credential, and one made through Auto's consent service can no longer be renewed or reconnected. Connect Slack Bot with a Slack app of your own instead, as the Connect Slack guide shows.
* **generation:** GENERATION_MAX_PLAYBOOK_MIB is now ASSET_STORAGE_QUOTA_MIB and GENERATION_RETENTION_DAYS is now ASSET_RETENTION_DAYS. An operator who set either renames it; the old names are not read. A runtime that still sets an old name starts on the default (2,048 MiB, 90 days), so rename it before you upgrade.
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

* **access-control:** a host reconciles who holds which role with what the identity service lists ([4490d4d](https://github.com/BeOnAuto/runtime/commit/4490d4d4c3329ec4670eef78c4b9577868eb6d3e))
* **access-control:** a host writes every role through the one decider, from any source ([4490d4d](https://github.com/BeOnAuto/runtime/commit/4490d4d4c3329ec4670eef78c4b9577868eb6d3e))
* **access-control:** a Viewer is held to reading on every operation, and a run keeps its rights ([62059cc](https://github.com/BeOnAuto/runtime/commit/62059cc01bcb434289a992b7c29bd244040683ae))
* **access-control:** only an admin signed in to Studio does what manages permissions ([ff34598](https://github.com/BeOnAuto/runtime/commit/ff34598ce7b4dfba70b3b3399da9c66b82da5d3e))
* **access-control:** the decider provisions a person who joins and deprovisions one who leaves ([a210c9d](https://github.com/BeOnAuto/runtime/commit/a210c9da654fb0553a63aeae14f99461755a62f8))
* **access-control:** the dispatcher asks a Cedar policy decision point in report-only mode ([dd46b60](https://github.com/BeOnAuto/runtime/commit/dd46b60c55f038f2a900e8e7b7abcd3316afadec))
* **access-control:** the engine loads in a Worker from the module its bundler compiled ([62059cc](https://github.com/BeOnAuto/runtime/commit/62059cc01bcb434289a992b7c29bd244040683ae))
* **access-control:** the runtime answers what its caller may do, at GET /caller ([a074c57](https://github.com/BeOnAuto/runtime/commit/a074c573adc83e0c879a37e3f78bb7925c0a63ed))
* **access-control:** who holds which role is facts of one decider, read through a read model ([62059cc](https://github.com/BeOnAuto/runtime/commit/62059cc01bcb434289a992b7c29bd244040683ae))
* **api:** /debug shows a person everything an agent receives, with search ([68cb5b7](https://github.com/BeOnAuto/runtime/commit/68cb5b73266eb399a05fcdec25679994acd78859))
* **api:** a connection takes signed deliveries at its own addresses ([231cf64](https://github.com/BeOnAuto/runtime/commit/231cf6447911b4f5db613f4e5abf79b1504ef8bc))
* **api:** a guide leaves out what its page marks for another reader ([a074c57](https://github.com/BeOnAuto/runtime/commit/a074c573adc83e0c879a37e3f78bb7925c0a63ed))
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
* **connections:** a provider may replace another, whose connections are reconnected through it ([ff34598](https://github.com/BeOnAuto/runtime/commit/ff34598ce7b4dfba70b3b3399da9c66b82da5d3e))
* **connections:** an admin connects again a replaced connection where only an admin connects it ([ff34598](https://github.com/BeOnAuto/runtime/commit/ff34598ce7b4dfba70b3b3399da9c66b82da5d3e))
* **connections:** an HTTP API is given its OpenAPI document whole, and read as it is added ([f85f65a](https://github.com/BeOnAuto/runtime/commit/f85f65aeead3e1bb94b84e19b6ff8925018f9735))
* **connections:** approving a connection takes the playbooks that may use it ([f7d875b](https://github.com/BeOnAuto/runtime/commit/f7d875b8e32f5d75dbce0cdf1fd344e742a5a554))
* **connections:** the link of a document given whole names the calls its entry allows ([380b374](https://github.com/BeOnAuto/runtime/commit/380b374ee130a617527097b502c5fe6ab400d743))
* **connections:** the list of providers says whether a connection acts as the app ([aff6fa5](https://github.com/BeOnAuto/runtime/commit/aff6fa582a05d61828499ca489ecf11502831e00))
* **connections:** which playbooks may use a connection can be changed after it is added ([873afde](https://github.com/BeOnAuto/runtime/commit/873afde04227eec10df48a4ff439b2e887ecbf80))
* **definitions:** a definition's document, overview and diagram are kept once, behind the switch ([aab12b4](https://github.com/BeOnAuto/runtime/commit/aab12b4e2fafccf3cd447a9450e1789dd385b634))
* **definitions:** a document not read just now is waited for, and read once a process ([cd81690](https://github.com/BeOnAuto/runtime/commit/cd81690fa57f951a5a7acd0b4ec21e1eac60cff8))
* **definitions:** a host reads whether a run's caller cancelled it before its start ([30ec626](https://github.com/BeOnAuto/runtime/commit/30ec626b506cb3f4db0f27784e633c38e6be2c9f))
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
* **definitions:** the link to a definition's page in Studio names its id beside its name ([30ec626](https://github.com/BeOnAuto/runtime/commit/30ec626b506cb3f4db0f27784e633c38e6be2c9f))
* **generation:** an asset is read by its id, with a fresh address and byte ranges ([72ef78a](https://github.com/BeOnAuto/runtime/commit/72ef78a669ad813df7d7ae7928c52c794d43679b))
* **generation:** an asset of any kind is read, under settings named for assets ([73196bf](https://github.com/BeOnAuto/runtime/commit/73196bfeadd30110eed925d676b4aa22aebca67b))
* **generation:** gpt-image-2.6-flare takes the place of gpt-image-1-mini ([af973c1](https://github.com/BeOnAuto/runtime/commit/af973c133ab2a7f23945351b5b8ef505f5c31cdd))
* **generation:** the guide says each limit and example model as the server it is on has them ([ea4ab7b](https://github.com/BeOnAuto/runtime/commit/ea4ab7b83a01e5888327ceba34e5d315dffcca45))
* **generation:** the models a generation function may name are listed with their limits ([8b3c3d4](https://github.com/BeOnAuto/runtime/commit/8b3c3d4118c2d7f298f6790b94ebb2f167a9173b))
* **global:** a guide says each value as its server has it, at capability contract 6 ([91562f8](https://github.com/BeOnAuto/runtime/commit/91562f8909cf63c87da2ad91ee843d46a569514d))
* **global:** a request's delivery carries takes_answer, beside its request, to the host's fetch ([e4da061](https://github.com/BeOnAuto/runtime/commit/e4da061c9fd73628b09c1cb9b4cfb2c20b3394a0))
* **global:** a workflow's triggers and the playbook's events have guides of their own ([a27f947](https://github.com/BeOnAuto/runtime/commit/a27f94734fb90b9c5eeefb383958d2e46cdf911a))
* **global:** an agent sets a connected service up before the first run ([d1708ae](https://github.com/BeOnAuto/runtime/commit/d1708aee8b2f38b8c495503f6067bd75cba7963f))
* **global:** list_generation_models is served on a connection to one playbook too ([1a8588d](https://github.com/BeOnAuto/runtime/commit/1a8588d720cfe7497add1262e883b8b240c75ca0))
* **global:** the memory type leaves, and a playbook has six function types ([bba9886](https://github.com/BeOnAuto/runtime/commit/bba988654e541e5c1b9fbf68b628993d85b8ab48))
* **goals:** playbooks with goals, slice 1, goal plus tracking ([dd46b60](https://github.com/BeOnAuto/runtime/commit/dd46b60c55f038f2a900e8e7b7abcd3316afadec))
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
* **ledger:** kept content belongs to its org, each place of its bytes recorded, by layout step 25 ([dce31fa](https://github.com/BeOnAuto/runtime/commit/dce31facfb3482dfa09de4c6727660b04430aecb))
* **ledger:** names of definitions judged per append in one lock order, and layout steps in code ([e9db9e6](https://github.com/BeOnAuto/runtime/commit/e9db9e67402b99c74b0b20d0bd66119c19452118))
* **ledger:** one append to several streams, all or nothing ([78f4914](https://github.com/BeOnAuto/runtime/commit/78f49145379b25f3fe0ad1d6971f1d973adf019d))
* **ledger:** the heads of recorded content gain when their content expires and when it was erased ([9a082a3](https://github.com/BeOnAuto/runtime/commit/9a082a3bc247c261b51b47c47831461f897010f8))
* **lookup:** a lookup reads the outputs of the playbook's own runs ([6e58247](https://github.com/BeOnAuto/runtime/commit/6e58247ee10ae3113b49633ad0c2bf26e4dd76f5))
* **operations:** a call that names the run it belongs to arrives through the run ([70b90cc](https://github.com/BeOnAuto/runtime/commit/70b90cc262bbd4921aa75f5c5c43fca025d5c08a))
* **operations:** a fact's payload, inline or kept outside by its digest ([a987e7f](https://github.com/BeOnAuto/runtime/commit/a987e7fb46240327cac9d3d108e44b58840a8c6c))
* **operations:** a payload is kept once past 16 KiB, and never within what a page shows whole ([5cf4e8b](https://github.com/BeOnAuto/runtime/commit/5cf4e8bcba7b2b36eb23ac9449759de678834677))
* **operations:** a refusal for content not read just now and a value lost from storage are read ([2f17556](https://github.com/BeOnAuto/runtime/commit/2f1755646c16592249e5cdacee84d0a6212fb15b))
* **operations:** a refusal names its cause, the role or what the call came through ([0163d5b](https://github.com/BeOnAuto/runtime/commit/0163d5b754d016c5bd7edfed31ba57318167280c))
* **operations:** a value kept outside is read through the cache and the gate whatever the option ([b011da7](https://github.com/BeOnAuto/runtime/commit/b011da71b068127db584a32f9252af78f98f0b2e))
* **operations:** the dispatcher can be decided by the policy decision point, nothing composes it ([f3c4dbe](https://github.com/BeOnAuto/runtime/commit/f3c4dbed34c2cbd8613bbe2d2e740a1053c7baae))
* **operations:** the limit a run stopped or answered at is read before anything records it ([bb25004](https://github.com/BeOnAuto/runtime/commit/bb250045baa5b48e6bb49326c4da9a73412dd27a))
* **playbooks:** a retired playbook can be restored ([206ffd6](https://github.com/BeOnAuto/runtime/commit/206ffd6a1b310c4d8405cdf93ce9c7b8c61d3d32))
* **providers:** a playbook reaches Slack as a bot alone, and no run receives a member's address ([99cdbcd](https://github.com/BeOnAuto/runtime/commit/99cdbcd4ad78943da303c248846ed60261ebc2d1))
* **providers:** a provider is found by every name its entry declares ([2b600aa](https://github.com/BeOnAuto/runtime/commit/2b600aad4ad9ab5a22d1caf1d323fd3a3a8ebeac))
* **providers:** a provider's entry says how its conversations are replied to and marked ([0fb9ca4](https://github.com/BeOnAuto/runtime/commit/0fb9ca47bd7ebfe62727e6735b37d81e7b9d53f4))
* **providers:** google-drive saves a text as a file, a Google Doc or a Sheet ([6fdb862](https://github.com/BeOnAuto/runtime/commit/6fdb8628de050feb380dd03e505018f69ec5f133))
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
* **runtime:** an agent designs the workflow with the person, reads through lookups, and is told what to double-check ([ac78ba1](https://github.com/BeOnAuto/runtime/commit/ac78ba19901f676eef135acb3c1b50055edd8741))
* **server:** goals are kept and judged on every server ([a210c9d](https://github.com/BeOnAuto/runtime/commit/a210c9da654fb0553a63aeae14f99461755a62f8))
* **server:** on Node a run whose process is gone is ended, or resumed under its caller ([73196bf](https://github.com/BeOnAuto/runtime/commit/73196bfeadd30110eed925d676b4aa22aebca67b))
* **server:** payload offloading is a setting, on by default, and a start refuses missing content ([7e676cf](https://github.com/BeOnAuto/runtime/commit/7e676cf75642bcb2e5949fd7e05e7cb52212c47a))
* **tool-servers:** a server's row says in words that its messages can be cards ([2442548](https://github.com/BeOnAuto/runtime/commit/2442548ccbeb12b069ce7bc9840ba08518e730d7))
* **tool-servers:** a tool call may send 256 KiB of arguments, as much as a run may take ([b6d4397](https://github.com/BeOnAuto/runtime/commit/b6d4397d59bf40b47b56c63a969e9244db0bf716))
* **tool-servers:** an image a tool answers is kept as an asset of the run ([2ee16b3](https://github.com/BeOnAuto/runtime/commit/2ee16b3a9d3c8a6119e6d25b49cfa93000a92773))
* **tool-servers:** an operation whose body is not JSON is offered ([2b283b0](https://github.com/BeOnAuto/runtime/commit/2b283b0ee487040777a6f7d13d84600b996fd934))
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
* **api:** a guide reads any spelling of a mark, fills an example in one pass, and stops no start ([91562f8](https://github.com/BeOnAuto/runtime/commit/91562f8909cf63c87da2ad91ee843d46a569514d))
* **ci:** the npm package smoke waits for the ready line before it counts it ([e60b687](https://github.com/BeOnAuto/runtime/commit/e60b687c9bded19540d6e6fca4745960147cd10a))
* **connections:** a credential that cannot be read names no key to the caller ([3aac647](https://github.com/BeOnAuto/runtime/commit/3aac64756df241ddd8473eb4796465a3ab5ef88c))
* **connections:** the watched ledger of the tests passes on the erasure of what is due ([4ef50ce](https://github.com/BeOnAuto/runtime/commit/4ef50cea0f74816a260276b43e0d93d8271d0a51))
* **definitions:** a change storage could not show yet and a schedule's skipped run say so plainly ([ef97cbc](https://github.com/BeOnAuto/runtime/commit/ef97cbc1fc739aaebcdf62446589b9acf2038bcd))
* **definitions:** a run whose process died can be ended; an attempt holds its run by a fencing token ([2948fc7](https://github.com/BeOnAuto/runtime/commit/2948fc71a80724ec35b369d6378c1d0ea0fe9704))
* **definitions:** the read model keeps what a workflow contributes, at its version 3 ([99cdbcd](https://github.com/BeOnAuto/runtime/commit/99cdbcd4ad78943da303c248846ed60261ebc2d1))
* **deps:** the model clients and Azure sign-in run on dependencies with no known advisories ([88bbf84](https://github.com/BeOnAuto/runtime/commit/88bbf84be4ba75158b1e6922bba991a763b9ec9d))
* **documents:** a Word document that runs out of memory while decoding reads as out of memory ([ac78ba1](https://github.com/BeOnAuto/runtime/commit/ac78ba19901f676eef135acb3c1b50055edd8741))
* **global:** the license words name the account holder or an organization admin ([8c2eaf6](https://github.com/BeOnAuto/runtime/commit/8c2eaf687bc3685257b0386ed732b4c4ee3255c4))
* **interaction:** a message the playbook sent is never read as a reply ([8ce060b](https://github.com/BeOnAuto/runtime/commit/8ce060bba6bfb3eaba3316bc5101eb46e1796cc2))
* **interaction:** a reply in a message's thread reaches its request, however many others wait ([1d2a786](https://github.com/BeOnAuto/runtime/commit/1d2a7869276343a3842026dae23c39b0fe7098df))
* **ledger:** a projection's fill holds one read of facts at a time, however long the history ([7759f6f](https://github.com/BeOnAuto/runtime/commit/7759f6f2f64a4fc6ca80e8df18498f461c390840))
* **ledger:** a secret on SQLite is written through the ledger's one writer, not a pool of its own ([da85ded](https://github.com/BeOnAuto/runtime/commit/da85ded549e2e05fbecc55b941b6fe3c7fd82d4c))
* **ledger:** a write on SQLite outside a transaction waits for the one writer instead of failing ([7759f6f](https://github.com/BeOnAuto/runtime/commit/7759f6f2f64a4fc6ca80e8df18498f461c390840))
* **ledger:** a write that waits for SQLite's writer is traced under its caller ([4f5d970](https://github.com/BeOnAuto/runtime/commit/4f5d970bfc4bb7d0c512340401f84e5ad1ef0183))
* **ledger:** the ledger runs on the SQLite built into Node.js, so the runtime starts on older Linux ([65a166b](https://github.com/BeOnAuto/runtime/commit/65a166b64980887924f42fb5f4e7db7401bb9c2e))
* **ledger:** the opening check leaves archived facts out, and a suite holds every read to the mark ([ea411fe](https://github.com/BeOnAuto/runtime/commit/ea411fe2088c216d2c185fd2e0443f33902b3c6c))
* **object-storage:** the sweep of uploads deletes a page of its keys at a time ([2b600aa](https://github.com/BeOnAuto/runtime/commit/2b600aad4ad9ab5a22d1caf1d323fd3a3a8ebeac))
* **prediction:** the default history never exceeds the window ([2cb75b0](https://github.com/BeOnAuto/runtime/commit/2cb75b03feb4d4b919528471f6e1879e0be9ef32))
* **providers:** google drive offers no option that asks for access to every file ([01ea1c6](https://github.com/BeOnAuto/runtime/commit/01ea1c69c74e740bca759f40c1be8d51ada85cc5))
* **providers:** slack asks for no search:read, and a reconnect asks nothing its provider dropped ([79c0a47](https://github.com/BeOnAuto/runtime/commit/79c0a47c6c08d431a433014cfb6730b5d3c37bca))
* **reasoning:** a composer can scrub its own secrets from provider messages ([a64ce0b](https://github.com/BeOnAuto/runtime/commit/a64ce0b0636505db00e9ccabc996b8d64c44fc10))
* **reasoning:** a gateway lacking structured outputs gets the schema in the prompt, not json_object ([acf348a](https://github.com/BeOnAuto/runtime/commit/acf348ad06e0bd08de533f6f7d2203ea129fea72))
* **reasoning:** a run cut at max_output_tokens says what to move out before it says raise the limit ([ef97cbc](https://github.com/BeOnAuto/runtime/commit/ef97cbc1fc739aaebcdf62446589b9acf2038bcd))
* **reasoning:** an interrupted call that may change something is never sent again ([1f2427f](https://github.com/BeOnAuto/runtime/commit/1f2427f38e9ec9e2301fe7c335e2ec8cf78bdca7))
* **tool-servers:** a function reads the text of a file a tool answers as an embedded resource ([468096e](https://github.com/BeOnAuto/runtime/commit/468096e969e5c27ef3b427733a5c095657d092d1))
* **workflow-engine:** a pool's timer that fires early waits out its deadline ([30ec626](https://github.com/BeOnAuto/runtime/commit/30ec626b506cb3f4db0f27784e633c38e6be2c9f))
* **workflow-engine:** an offloaded value counts as its digest and size in one recorded change ([ff34598](https://github.com/BeOnAuto/runtime/commit/ff34598ce7b4dfba70b3b3399da9c66b82da5d3e))
* **workflow-host:** a hold outlasts an unknown reason and a clock gone back; a loss is said once ([6efd9a4](https://github.com/BeOnAuto/runtime/commit/6efd9a4bf70c5e9dcc48e19921fdee3d84c767e6))
* **workflow-host:** a run that ended lets go of its calls' payloads a day on, keeping their rows ([1e027e5](https://github.com/BeOnAuto/runtime/commit/1e027e541792a530171a7155ef7845657e2dc392))
* **workflow-host:** the cancelled run of contract four is no longer exported ([b00d97e](https://github.com/BeOnAuto/runtime/commit/b00d97ebcc110e959fc63c2a052727b9339fea1b))


### Performance Improvements

* **activity:** list_activity reads the rows of the org's playbooks four at a time ([2a172e5](https://github.com/BeOnAuto/runtime/commit/2a172e5360db0ae40f19afdd0b6dbb719338c7b9))
* **ledger:** a large playbook is read in bounded pieces ([d0ef8ad](https://github.com/BeOnAuto/runtime/commit/d0ef8adb01fb608569df4757efa5a72abd0c2212))
* **tool-servers:** the org's search asks for the providers it offers beside the servers it lists ([ebf6dd9](https://github.com/BeOnAuto/runtime/commit/ebf6dd93dbbe0ff260758241e7965dcb69991d49))
* **tool-servers:** the org's search keeps what each server listed for five minutes ([2e6db1a](https://github.com/BeOnAuto/runtime/commit/2e6db1a3e9e53e6fce213c46463fc8de206626e1))


### Code Refactoring

* **ledger:** name the SQLite entry sqlite, as the add-on it was named for has gone ([2b283b0](https://github.com/BeOnAuto/runtime/commit/2b283b0ee487040777a6f7d13d84600b996fd934))
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
