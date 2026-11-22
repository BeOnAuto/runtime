import { Socket } from 'node:net';

import { Pool } from 'pg';

import type { PostgreSQLPools } from '../postgresql/postgresql-options.ts';

/**
 * A test's hold on the statements a store sends to PostgreSQL. The pools it makes write through sockets that let a
 * test stop the store before a statement, or learn that a statement has been handed to the server, by a marker: text
 * of the statement or of a value it binds. A test awaits these signals, so it orders a store's statements against its
 * own sessions without reading `pg_stat_activity` again and again.
 */
export interface StatementGate {
  readonly pools: (database: string) => PostgreSQLPools;
  /** Holds the first statement that carries the marker until `go`; `reached` settles once the store asks for it. */
  readonly stopBefore: (marker: string) => StatementStop;
  /** Settles once the first statement that carries the marker has been written to the server's socket. */
  readonly sent: (marker: string) => Promise<void>;
  readonly open: () => number;
  /** Settles once every connection the pools opened is closed. */
  readonly allClosed: () => Promise<void>;
}

interface StatementStop {
  readonly reached: Promise<void>;
  readonly go: () => void;
}

interface Waiting {
  readonly marker: string;
  readonly reached: () => void;
  readonly go: Promise<void>;
}

interface Chunk {
  readonly chunk: Readonly<Uint8Array>;
  readonly encoding: BufferEncoding;
}

type Written = (error?: Readonly<Error> | null) => void;

type Passed = (text: string) => Promise<() => void>;

function afterWriting(written: () => void, callback: Written): Written {
  return (error) => {
    written();
    callback(error);
  };
}

const writing = '_write';

const writingSeveral = '_writev';

class GatedSocket extends Socket {
  readonly #passed: Passed;

  constructor(passed: Passed) {
    super();
    this.#passed = passed;
  }

  override _write(chunk: Readonly<Uint8Array>, encoding: BufferEncoding, callback: Written): void {
    void this.#passed(Buffer.from(chunk).toString('utf8')).then((written) => {
      super[writing](chunk, encoding, afterWriting(written, callback));
      return written;
    });
  }

  override _writev(chunks: readonly Chunk[], callback: Written): void {
    void this.#passed(Buffer.concat(chunks.map(({ chunk }) => chunk)).toString('utf8')).then((written) => {
      super[writingSeveral]?.(
        chunks.map((entry) => ({ ...entry })),
        afterWriting(written, callback),
      );
      return written;
    });
  }
}

function aWaitingList() {
  const waiting: Waiting[] = [];
  return {
    add: (marker: string, go: Promise<void> = Promise.resolve()): Promise<void> => {
      const reached = Promise.withResolvers<void>();
      waiting.push({ marker, reached: reached.resolve, go });
      return reached.promise;
    },
    taken: (text: string): Waiting | undefined => {
      const index = waiting.findIndex(({ marker }) => text.includes(marker));
      return index === -1 ? undefined : waiting.splice(index, 1)[0];
    },
  };
}

function aSocketCount() {
  const sockets = { opened: 0, closed: 0 };
  const closing: (() => void)[] = [];
  const settledIfAllClosed = () => {
    if (sockets.opened === sockets.closed) {
      for (const closed of closing.splice(0)) {
        closed();
      }
    }
  };
  return {
    opened: (passed: Passed): Socket => {
      const socket = new GatedSocket(passed);
      sockets.opened += 1;
      socket.once('close', () => {
        sockets.closed += 1;
        settledIfAllClosed();
      });
      return socket;
    },
    open: () => sockets.opened - sockets.closed,
    allClosed: () => {
      const closed = Promise.withResolvers<void>();
      closing.push(closed.resolve);
      settledIfAllClosed();
      return closed.promise;
    },
  };
}

export function aStatementGate(): StatementGate {
  const stops = aWaitingList();
  const sends = aWaitingList();
  const sockets = aSocketCount();
  const passed = async (text: string): Promise<() => void> => {
    const stop = stops.taken(text);
    if (stop !== undefined) {
      stop.reached();
      await stop.go;
    }
    const sent = sends.taken(text);
    return () => {
      sent?.reached();
    };
  };
  return {
    pools:
      (connectionString) =>
      ({ max }) =>
        new Pool({ connectionString, max, stream: () => sockets.opened(passed) }),
    stopBefore: (marker) => {
      const go = Promise.withResolvers<void>();
      return { reached: stops.add(marker, go.promise), go: go.resolve };
    },
    sent: (marker) => sends.add(marker),
    open: sockets.open,
    allClosed: sockets.allClosed,
  };
}
