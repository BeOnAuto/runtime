# @on.auto/node-sqlite

A driver of the event store library, `@event-driven-io/dumbo`, for the SQLite built into Node.js, `node:sqlite`. It takes SQL and its values and answers rows, and knows nothing of the ledger or of any other user of the library. It exists so that a SQLite file can be kept with no native add-on: the library's own SQLite driver for Node runs on the `sqlite3` add-on, whose published Linux binary needs glibc 2.38 and whose project is no longer maintained, and the library has no driver for `node:sqlite`.

It is written to the library's public driver contract and registered the way the library registers its own drivers, so a program reaches it as it reaches any of them. No setting chooses it: a program that wants it names it.

## The driver

`nodeSqliteDumboDriver` is the library's `DumboDatabaseDriver` for `node:sqlite`, under the type `SQLite:node-sqlite`, in the library's `<database>:<driver>` form, as its own `SQLite:sqlite3` (`src/driver/node-sqlite-driver.ts`). Importing the package registers it in the library's `dumboDatabaseDriverRegistry`, so `dumbo({ driverType: 'SQLite:node-sqlite', fileName })` opens a pool on it, as `dumbo({ driver: nodeSqliteDumboDriver, fileName })` does. It hands the library's own pieces back to it: the SQLite formatter of the statements and their values, `sqliteFormatter`, the migrator options, the metadata of a SQLite database, and the parse of a SQLite connection string, so it handles its own type and a connection string of SQLite, as the library's drivers do. The library's event store, Emmett, reaches it through an `EventStoreDriver` of a few lines, which belongs with the code that opens the store.

## The client

`nodeSqliteClient(options)` is the connection to one database (`src/client/node-sqlite-client.ts`). It opens one `DatabaseSync` for `fileName`, or the `connectionString` it is given, or a private database in memory when it is given neither, and answers the four statements of the library's client, a query, a command and a batch of each, each with `rowCount` and `rows`. Transactions are the library's own, through its public `sqliteConnection`: `BEGIN IMMEDIATE` unless another mode is asked, `COMMIT`, `ROLLBACK` and savepoints; the driver writes no SQL of a transaction.

It sets the pragmas the add-on's client set, from the same options: the library's defaults, `DEFAULT_SQLITE_PRAGMA_OPTIONS`, under what a connection string names, under what the caller gives (`src/client/pragmas.ts`). On every connection it sets `synchronous`, `cache_size`, `foreign_keys`, `temp_store` and `mmap_size`, and, unless it is told to skip the pragmas of the database, it reads the journal mode and sets it only where the file holds another. The driver holds no value of a pragma of its own.

A client given `minimumSQLiteVersion` refuses to connect to a SQLite older than that, in plain words that name both versions, and closes the file (`src/client/sqlite-version.ts`). The version that matters is the caller's: a Node.js built by a distribution may be linked to the SQLite of the system, which can be older than the one Node.js carries.

### Three things put back as the add-on had them

`node:sqlite` answers differently from the add-on in three ways, and the client puts each back:

- **Whole numbers.** `node:sqlite` binds every number as a real, so a column of no type keeps `1.0` and a `TEXT` column keeps `'5.0'`. The add-on bound a whole number within 32 bits as an integer and every other number as a real, and the client binds as it did, handing such a number to Node.js as a BigInt (`src/client/binding.ts`). True and false bind as the integers 1 and 0, null and undefined as NULL, a string as text, a BigInt as an integer and bytes as a blob; any other value is refused with its type in the words. The table of what each value is stored as is a test (`src/client/binding.test.ts`).
- **Rows.** `node:sqlite` answers a row as an object with no prototype and bytes as a `Uint8Array`. The client answers plain objects of the columns the statement declares, read in arrays, and bytes as a `Buffer` that views what SQLite answered, with no copy (`src/client/rows.ts`). An integer beyond 2^53, which the add-on answered rounded and without a word, `node:sqlite` refuses, and so does the client: nothing a driver answers should be a different number in silence.
- **A busy file.** The add-on waited for a lock inside SQLite on a thread of Node's pool, up to `busy_timeout`. Inside a synchronous call the same wait holds the thread of the program, and can never end while the holder is a connection of the same program. The client opens each database with SQLite's own wait at nothing and waits off the thread instead: a statement that finds the file busy is tried again after the delays of SQLite's default busy handler, 1, 2, 5, 10, 15, 20, 25, 25, 25, 50, 50 and then 100 ms, until `busy_timeout` has passed, as SQLite's handler does, and then fails with `SQLITE_BUSY` as before (`src/client/busy-handler.ts`). It is tried again only outside an explicit transaction, read from the connection's own `isTransaction`: inside one, SQLite's documentation of `sqlite3_step` says to roll back rather than retry. `SQLITE_LOCKED` is not tried again.

### Errors

`node:sqlite` fails with `ERR_SQLITE_ERROR` and SQLite's extended result code. The client gives such an error the shape the add-on gave, `code` the name of its primary result code from SQLite's published table, `errno` that code, and the words `SQLITE_X: what SQLite said`, with the error of `node:sqlite` as its cause, and hands it to the library's own mapper, `mapSqliteError` (`src/client/result-codes.ts`). So a unique violation is the library's `UniqueConstraintError`, a busy file its `LockNotAvailableError` with the words `SQLITE_BUSY: database is locked`, and a locked table its `DeadlockError`. An error that is not a failed statement of SQLite reaches the mapper as it is.

### Each statement on a later turn of the event loop

A statement holds the thread of the program while it runs, since `node:sqlite` has no asynchronous form. Each statement runs and answers on a later turn of the event loop, after `setImmediate`, so that statements that follow each other let timers and sockets run between them, as Node's guide "Don't Block the Event Loop" sets out for work that runs on the event loop (`src/client/next-turn.ts`). The async context of the caller survives the turn.

## The pool

`nodeSqlitePool(options)` is the pool the driver creates (`src/pool/node-sqlite-pool.ts`), arranged as the add-on's pool of the library was, since the library keeps that arrangement inside the bundle that loads the add-on and exports none of it:

- For a file, one writer connection and a bounded pool of readers, `max(4, cpus)` of them unless `readerPoolSize` says otherwise (`src/pool/writer-and-readers-pool.ts`). Queries go to the readers, which read the committed snapshot while a write is open, and commands, transactions and connections that are not read-only go to the writer. The first connection prepares the file, its journal mode among its pragmas, once, and is prepared again on the next use when that failed.
- For `:memory:`, one connection, which reads what a transaction open on it wrote, as the add-on's did (`src/pool/writer-pool.ts`).
- The writer sits behind a queue, first in first out, one task at a time, with today's two bounds and their words: no more than 1,000 waiting, "Too many pending tasks. Please try again later.", and none waiting longer than 30 seconds to start, unless `maxTaskIdleTime` says otherwise, "Task was not started within the maximum waiting time" (`src/pool/writer-queue.ts`). A task starts in the async context of its caller, so a span of the caller is the parent of what the task does. A task its caller aborts leaves the queue while it waits, and its caller is answered at once while it runs. When the pool closes, what waits is refused with "Writer connection pool has been closed", what runs is waited for, no longer than a deadline when one is given and not at all when the close is forced, and what comes after is refused.
- A statement issued inside a transaction's async context runs on that transaction's connection (`src/pool/connection-context.ts`), which is what an append to several streams in one transaction rests on.

The pools themselves are the library's public `createSingletonConnectionPool` and `createBoundedConnectionPool`; the driver owns only the queue of the writer, the async context of its connection, the routing between writer and readers and the preparation of the file.

## Testing

The package's tests run against real files in a temporary folder and through the library, and cover every file in full. The behaviours of a store that the ledger states are proven where the ledger runs its own suites, on a ledger file opened through this driver beside one opened through the add-on (`packages/ledger/src/testing/sqlite-drivers.ts`).
