const primaryResultCodes: ReadonlyMap<number, string> = new Map([
  [1, 'SQLITE_ERROR'],
  [2, 'SQLITE_INTERNAL'],
  [3, 'SQLITE_PERM'],
  [4, 'SQLITE_ABORT'],
  [5, 'SQLITE_BUSY'],
  [6, 'SQLITE_LOCKED'],
  [7, 'SQLITE_NOMEM'],
  [8, 'SQLITE_READONLY'],
  [9, 'SQLITE_INTERRUPT'],
  [10, 'SQLITE_IOERR'],
  [11, 'SQLITE_CORRUPT'],
  [12, 'SQLITE_NOTFOUND'],
  [13, 'SQLITE_FULL'],
  [14, 'SQLITE_CANTOPEN'],
  [15, 'SQLITE_PROTOCOL'],
  [16, 'SQLITE_EMPTY'],
  [17, 'SQLITE_SCHEMA'],
  [18, 'SQLITE_TOOBIG'],
  [19, 'SQLITE_CONSTRAINT'],
  [20, 'SQLITE_MISMATCH'],
  [21, 'SQLITE_MISUSE'],
  [22, 'SQLITE_NOLFS'],
  [23, 'SQLITE_AUTH'],
  [24, 'SQLITE_FORMAT'],
  [25, 'SQLITE_RANGE'],
  [26, 'SQLITE_NOTADB'],
  [27, 'SQLITE_NOTICE'],
  [28, 'SQLITE_WARNING'],
]);

const busy = 5;

const primaryCodeBits = 0xff;

interface FailedStatement {
  readonly message: string;
  readonly errcode: number;
}

function isAFailedStatement(error: unknown): error is FailedStatement {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_SQLITE_ERROR' &&
    'errcode' in error &&
    typeof error.errcode === 'number'
  );
}

function primaryCodeOf({ errcode }: FailedStatement): number {
  return errcode % (primaryCodeBits + 1);
}

export function isBusy(error: unknown): boolean {
  return isAFailedStatement(error) && primaryCodeOf(error) === busy;
}

export function sqliteErrorOf(error: unknown): unknown {
  if (!isAFailedStatement(error)) {
    return error;
  }
  const errno = primaryCodeOf(error);
  const code = primaryResultCodes.get(errno);
  return code === undefined
    ? error
    : Object.assign(new Error(`${code}: ${error.message}`, { cause: error }), { code, errno });
}
