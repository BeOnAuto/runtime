# @on.auto/secrets

The secret store of the runtime: what it must hold to act for someone, such as a key a person pasted, a client secret whoever runs it registered, a registration it made for itself or the tokens a person's consent gave it. The server opens the store at start and gives it to the connections of [`@on.auto/connections`](../connections/README.md), which keep in it the credential a person gives, through their port `SecretKeeping`. Behind the store are three seams: the **rows**, which keep the bookkeeping of each secret and which the ledger implements over SQLite and PostgreSQL, as its README's [Kept secrets](../ledger/README.md#kept-secrets) says; the **keeper**, which holds each value; and the **custodian**, which holds the key that wraps each value's own data key. This package holds the store, the three ports, the one custodian and the one keeper there are, so the ledger knows no key and the connections know no ledger.

## Words

- **The secret store**: `SecretStore`, what the connections are given: `keep`, `read`, `replace`, `claim`, `endingsOf` and `forget`, with `rotated` and `close` for the server.
- **A row**: the record of a secret: its id, its version, its claim, its ending, when it was kept, and its holding.
- **A holding**: how a value is held, `{ keptBy, held, wrappedKey?, kid? }`: the keeper that holds it, what the keeper handed back, and for a sealed value the wrapped data key and the custodian's kid.
- **The keeper**: where a value rests. The one there is keeps it in the row itself, sealed, under the name `ledger`.
- **Sealed**: encrypted under a data key made for that value alone, the data key wrapped by the custodian's key and kept beside the value.
- **The custodian**: who holds the key that wraps data keys; the one there is holds a key in hand.
- **The kid**: the id of the custodian's key, written on each sealed row and in the log, never the key.
- **Rotation**: a new custodian named beside the previous one; at start every data key the previous one wrapped is wrapped again by the current one, and no value is touched.

## Entry

`@on.auto/secrets` (`src/index.ts`) exports:

- the ports, each an interface of functions: `SecretRows`, with `Holding`, `SecretRow`, `HeldRow`, `Holder` and the answers `Replacement` and `Claim`; `Custodian`, `{ kid, wrap(dataKey), unwrap(wrapped) }`, each failing with a `KeepingFailure`, and `Custodians`, `{ current, previous? }`; and `Keeper`, `{ name, hold(id, value), reveal(holding), release(holding) }`, whose `hold` fails with a `KeepingFailure` and whose `reveal` with a `ReadingFailure`;
- `secretStoreOn(rows, keeper, custodians)`, the `SecretStore` over them, its refusal of a value, `SecretRefused`, and its three failures, `SecretKeyUnknown`, `CustodianRefused` and `KeeperUnavailable`, with `KeepingFailure`, the last two, and `ReadingFailure`, all three;
- `localCustodian(key)`, the custodian of a key in hand, and `secretKeyBytes`, the length of such a key, 32;
- `sealedKeeper(custodians)`, the keeper that seals a value into its row.

The server composes them in `packages/server/src/database/secret-store.ts`: the rows for its database, a `localCustodian` of the current key and one of the previous key where there is one, the `sealedKeeper` of both, and the store over the three.

## The row

The ledger keeps the rows in one table, `kept_secrets`, with these columns:

| Column          | What it holds                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`            | the secret's id, a UUIDv7, the table's primary key                                                         |
| `version`       | 1 when the secret is kept, one more at each replacement                                                    |
| `kept_at`       | when the value it holds was kept, an ISO 8601 time in UTC, as text                                         |
| `claimed_until` | until when the row is claimed by whoever renews it, the same kind of time, or `NULL`                       |
| `ends_with`     | the ending of the secret the runtime may show, or `NULL`                                                   |
| `kept_by`       | the keeper that holds the value, `ledger`                                                                  |
| `held`          | what the keeper handed back: for `ledger`, the sealed value, one JWE in its compact form                   |
| `wrapped_key`   | for `ledger`, the value's data key wrapped by the custodian, one JWE in its compact form; `NULL` otherwise |
| `kid`           | for `ledger`, the kid of the custodian's key that wrapped it; `NULL` otherwise                             |

`SecretRows` is that table's SQL as a port, and seals nothing: `keep(id, holding, endsWith?)` writes a row at its first version, `kept_at` now, and fails as a defect for an id it keeps already; `read(id)` answers its holding, its version and `claimedUntil`, the end of its claim while that is open, or nothing for an id it does not keep; `replace(id, version, holding)` writes a new holding in one conditional update, only while the row's version is the one the caller read, at the next version, `kept_at` now, its claim ended and its ending cleared; `claim(id, version, lastingMs)` marks the row claimed until `lastingMs` from now, only while its version is the one read and no claim is open, a claim being open while its end is later than now; `endingsOf(ids)` answers the ending of each id that has one, in one read, and nothing for no ids; `forget(id)` deletes the row and answers the holding it held, and forgetting an id twice is forgetting it once. Two more serve the start: `heldBy({ keptBy, kid? }, limit)` answers at most `limit` rows a keeper holds, under a kid where one is named, `{ id, version, holding }` in the order of their ids; and `reheld(read, holding)` writes another holding of a row in one conditional update, only while its version and its holding are still the ones `read` names, and answers whether it did, so that two servers starting at once hold each row again once and a replacement made between a read and the write is never written over; the version, the claim, the ending and `kept_at` stay. `replace` and `claim` answer `{ replaced: true, version }` or `{ replaced: false }`, `{ claimed: true, until }` or `{ claimed: false }`, for a row whose version moved and for a row that is gone alike, never with an error. The rows read every time they write or compare, `kept_at`, the end of a claim and the moment a claim is judged open, from the clock they are given, Effect's `Clock` for the ledger's, so a test drives it with `TestClock`. `close()` closes the rows' connections.

## Sealing

A value the `ledger` keeper holds is sealed by `jose`, the library that verifies the identity service's tokens in `@on.auto/identity`, as one JWE in its compact form whose protected header is `{ alg: 'dir', enc: 'A256GCM' }`: the value is encrypted with AES-GCM under a data key of 32 random bytes made for it alone, from `crypto.getRandomValues`, and nothing else is in the header. The custodian wraps the data key, and the wrapping goes in `wrapped_key` and the custodian's kid in `kid`, beside the value and not in its header, which is authenticated data, so a rotation rewrites those two columns and never the value. A replacement seals the new value under a new data key. Every data key made or unwrapped is filled with zeros once its seal, its unseal or its wrapping again is done, so none outlasts its one use. Nothing of it is the runtime's own: no cipher, no nonce and no derivation of a key.

## The custodian

`localCustodian(key)` takes a key of 32 bytes as a `Redacted` byte array, and a key of another length stops it, naming the length and never the bytes: `A key that seals secrets is 32 bytes, and this one is 16`. Its `kid` is the first 16 hex characters of the key's SHA-256, `sha256Of` of `@on.auto/operations`, so no one names a key and one key always has one kid. `wrap(dataKey)` answers one JWE in its compact form, `{ alg: 'A256KW', enc: 'A256GCM' }`, of the data key under the key, `jose`'s envelope of AES key wrap around a content key of its own; `unwrap(wrapped)` answers the data key, taking those two algorithms alone and no compression, so a wrapping under another key, or of another algorithm under this one, is refused as a `CustodianRefused` in its own words, `The custodian of the key <kid> refused to unwrap a data key: its wrapped key does not open under this key`. Under the kid it names, that means a wrapping changed outside the runtime.

The store takes `custodians: { current, previous? }`: the current one wraps every data key, and a read asks the one its row's kid names. A previous custodian with the current one's kid is no previous at all. Each read unwraps its data key again and nothing keeps one unwrapped, since a row is read when a connection is first used in a process and when its tokens are renewed.

## The keeper

`sealedKeeper(custodians)` is the keeper named `ledger`. `hold(id, value)` makes a data key, seals the value under it, has the current custodian wrap it, and answers `{ keptBy: 'ledger', held, wrappedKey, kid }`; the id names nothing in what it holds. `reveal(holding)` asks the custodian the holding's kid names to unwrap the data key, and opens the value with `dir` and `A256GCM` alone and no compression; a kid that is neither the current custodian's nor the previous one's, or a holding that names none, is refused as a `SecretKeyUnknown`. `hold` and `reveal` fail as their custodian does. `release(holding)` does nothing, since the row is the value.

## The failures

A value the store cannot read now fails the call that asked for it, and nothing else: the store keeps the row as it was, and reads it again at the next call. There are three such failures, each a tagged error that names no value and no key, its words in `detail`:

- `SecretKeyUnknown`, `secret_key_unknown`, `{ kid, detail }`: the row is sealed under a kid that is neither the current custodian's nor the previous one's, `The secret is sealed under the key <kid>, which is neither the current key nor the previous one`.
- `CustodianRefused`, `custodian_refused`, `{ kid, detail }`: the custodian of the kid failed to wrap or unwrap a data key, and says why, `The custodian of the key <kid> refused to unwrap a data key: <the custodian's words>`.
- `KeeperUnavailable`, `keeper_unavailable`, `{ detail }`: the keeper, or the custodian it asks, did not answer within the bound the store sets, 30 seconds through Effect's `timeoutOrElse`, `The keeper of the secret, or the custodian of its key, did not answer within 30 seconds`.

A read fails with any of the three, a `ReadingFailure`; a keep and a replacement with the last two, a `KeepingFailure`, and keep nothing then, so a value is kept or replaced only when its keeper and its custodian answered. A custodian or a keeper answers the last two itself where it can tell, and the store answers `KeeperUnavailable` for one that is still silent at the bound.

## The store

`secretStoreOn(rows, keeper, custodians)` answers the `SecretStore`.

- `keep(value, endsWith?)` takes the value as a `Redacted` string, and the ending the runtime may show where it is given one, makes an id, a UUIDv7 as `randomUUIDv7` of `@on.auto/operations` makes the ledger's other ids, has the keeper hold the value under it and keeps the row, and answers the id. An empty value, or one of more than 8 KiB of UTF-8, is refused before anything is sealed, as a `SecretRefused` that is `empty` or `too_large` and says nothing of the value: `A secret to keep is empty`, `A secret to keep holds more than 8 KiB`. A keeper that does not hold the value fails it with a `KeepingFailure`, and no row is kept.
- `read(id)` answers a `StoredSecret`: the value as a `Redacted`, which prints and serializes as `<redacted>`, so a value cannot reach a log by accident, the row's `version`, and `claimedUntil`; it answers nothing for an id the store does not keep, never an error, and fails with one of the three failures above.
- `replace(id, version, value)` has the keeper hold the new value and replaces the row's holding under the version read, refusing a value and failing as `keep` does, the row then as it was; `claim`, `endingsOf` and `close` are the rows' own.
- `forget(id)` forgets the row and has the keeper release the holding it held.
- `rotated()` holds again under the current custodian what the previous one wrapped: it reads with `heldBy({ keptBy: 'ledger', kid })` the rows of the previous custodian's kid, 100 at a time, has the previous custodian unwrap each data key and the current one wrap it, writes the new `wrappedKey` and `kid` with `reheld`, and answers how many rows it held again. Rows of the current kid, of any other kid and of any other keeper are left as they are, and so is each row's value, its version, its claim and the time it was kept. Without a previous custodian, or with the current one given as the previous, it holds nothing again. Once a rotation has run, nothing is wrapped under the previous key any more, so it can be dropped. Each row's unwrapping and wrapping again is bounded as a read is, and a custodian that refuses or does not answer fails the rotation with its `KeepingFailure`, the rows held again before it under the current custodian and the rest as they were; the server stops its start on it, naming the setting of the previous key before the custodian's words.

A failure of the rows, of the keeper or of the custodian other than these is a defect, as a failure of the ledger's database is.

A secret is only as recoverable as its key. The store keeps no copy of a key and no way around one: a lost key loses every data key wrapped under it and so every value, and a row whose key is gone can only be forgotten. The server's settings say where its key comes from, in [Configure the runtime](../../docs/self-host/configuration.md#storage).

## Testing

`@on.auto/secrets/testing` (`src/testing/index.ts`) holds what the tests of the rows and of the store share:

- `memoryRows({ now })`, rows kept in memory under the rule of the lease, whose claims and times are read from `now`, and which fail as a defect for an id they keep already, as the ledger's table does: the one copy of the lease beside the ledger's SQL. `kept()` answers each row by its columns, in the order of its ids.
- `valuesInTheClear({ now, mostCharacters })`, values a test holds in the clear over `memoryRows`, `{ keptBy: 'memory', held }`, under ids it gives: it keeps, reads, replaces, claims, answers endings and forgets as the rows do, refuses a value to keep or a replacement past its bound, `A secret to keep holds more than <n> characters`, and answers what it holds, `values()` and `endings()`. The tool-servers package's `memoryTokens` and the connections package's harness keep their values in it.
- `recordingCustodian(key?)`, a custodian of a key in hand, a random one unless it is given one, that counts its wraps and unwraps, `wraps()` and `unwraps()`, and holds the data keys it wrapped and unwrapped, `dataKeys()`, so a test sees them filled with zeros. Told to `refuse()`, it refuses both as a `CustodianRefused` in the words `custodianRefusal`, `the key is disabled`; told to `stall()`, it answers neither, and the promise `stall()` answers settles once it is first asked; told to `answer()`, it answers again.
- `rowsBehaviour(entry)`, every claim on a `SecretRows`: a holding kept, with and without a wrapped key and a kid, read back and forgotten twice as once, no second row under an id kept, the endings, a replacement at the version read, after which the next version may be claimed at once, and none at another or of a row that is gone, a claim a read answers while it is open and none while one is open, of a moved version or of a row that is gone, the rows a keeper holds under a kid, in order and at most as many as asked, a row held again only while its version and its holding are the ones read, its version, claim, ending and time kept, and a sealed row replaced or held again with the holding of another keeper, its wrapped key and kid then empty.
- `storeBehaviour(entry)`, what the store adds over any rows, the claims of the rows themselves being `rowsBehaviour`'s: a value kept under a UUIDv7 with its ending and read back redacted, sealed as a `dir` JWE under a data key of its own that the row's `wrapped_key` holds under the row's `kid`, a wrap at each keep and an unwrap at each read with each data key then filled with zeros, a forget twice as once, through which the keeper releases, the empty and the oversized value refused before anything is wrapped, as a replacement, a replacement at the next version under a new data key, and a rotation over more than one batch that wraps again the data keys of the previous key's rows, touches no value, keeps each row's version and claim and leaves a stray kid, and none without a previous key. Its failures are a suite of their own in `src/testing/failure-behaviour.ts`: a value under another key not read, `secret_key_unknown` with that key's kid; a value and a replacement a refusing custodian does not wrap, `custodian_refused`, the row as it was; and a value a refusing custodian does not unwrap, `custodian_refused`, and one a stalled custodian leaves unanswered, `keeper_unavailable` at 30 seconds of `TestClock` and not a millisecond before, read again once the custodian answers, its row as it was and no failure naming the value.

An entry, `SecretsEntry`, is `{ aDatabase, rowsOn, rowsIn }`: a fresh database, the rows on one, and the rows of one as its table holds them, by their columns in the order of their ids. `src/testing/memory-rows.test.ts` runs both suites over `memoryRows`, and the ledger runs them over SQLite and PostgreSQL. `src/store/secret-store.test.ts` adds what only a keeper or rows of a test's own show: the id the store hands its keeper and the holding it releases, a replacement made between a rotation's read of a row and its write, which the rotation leaves as it is, the data key a rotation unwrapped, filled with zeros once wrapped again, and a rotation whose previous custodian refuses, which fails with that refusal and holds nothing again.

## Source

`src/rows` holds the port of the rows, `src/custodians` the port of the custodian, its refusal and the custodian of a key in hand, `src/keepers` the port of the keeper, the ledger's keeper, its data keys, the unknown kid and the keeper that does not answer, `src/store` the store, the bound of an answer, its rotation and its refusal, and `src/testing` the rows in memory, the values in the clear, the recording custodian, the suites and the entry of the tests.
