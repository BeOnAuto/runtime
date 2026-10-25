import { statement, type ConnectionPorts, type Dialect, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

interface AddedColumn {
  readonly table: string;
  readonly column: string;
  readonly added: Statement;
  readonly addedWhenMissing: Statement;
}

function columnsOnSQLite(table: string): Statement {
  return statement`SELECT name FROM pragma_table_info(${table})`;
}

const addedColumns: readonly AddedColumn[] = [
  {
    table: 'workflow_timers',
    column: 'armed_by',
    added: statement`ALTER TABLE workflow_timers ADD COLUMN armed_by BIGINT`,
    addedWhenMissing: statement`ALTER TABLE workflow_timers ADD COLUMN IF NOT EXISTS armed_by BIGINT`,
  },
  {
    table: 'workflow_calls',
    column: 'child',
    added: statement`ALTER TABLE workflow_calls ADD COLUMN child TEXT`,
    addedWhenMissing: statement`ALTER TABLE workflow_calls ADD COLUMN IF NOT EXISTS child TEXT`,
  },
  {
    table: 'workflow_calls',
    column: 'root_id',
    added: statement`ALTER TABLE workflow_calls ADD COLUMN root_id TEXT`,
    addedWhenMissing: statement`ALTER TABLE workflow_calls ADD COLUMN IF NOT EXISTS root_id TEXT`,
  },
];

const indexesOfAddedColumns: readonly Statement[] = [
  statement`CREATE INDEX IF NOT EXISTS workflow_calls_open_by_root ON workflow_calls (root_id)
    WHERE state IN ('running', 'waiting')`,
  statement`CREATE INDEX IF NOT EXISTS workflow_calls_waiting_by_run ON workflow_calls (run_key) WHERE state = 'waiting'`,
];

const followerTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS workflow_followed_playbooks (
    playbook_key TEXT NOT NULL PRIMARY KEY,
    cursor TEXT,
    delivered TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    waiting INTEGER NOT NULL DEFAULT 0,
    checked BIGINT NOT NULL DEFAULT 0
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_followed_playbooks_by_check ON workflow_followed_playbooks (waiting, checked)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_followed_orgs (
    stream_id TEXT NOT NULL PRIMARY KEY,
    position BIGINT NOT NULL
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_followed_scans (name TEXT NOT NULL PRIMARY KEY)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_passed_runs (
    run_key TEXT NOT NULL PRIMARY KEY,
    passed_through BIGINT NOT NULL
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_listeners (
    run_key TEXT NOT NULL,
    listener TEXT NOT NULL,
    playbook_key TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    armed_by BIGINT NOT NULL,
    filters TEXT NOT NULL,
    workflow TEXT NOT NULL,
    version BIGINT NOT NULL,
    passed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_key, listener)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_listeners_by_stream ON workflow_listeners (stream_id, passed)`,
  statement`CREATE INDEX IF NOT EXISTS workflow_listeners_by_playbook ON workflow_listeners (playbook_key)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_listener_types (
    playbook_key TEXT NOT NULL,
    type TEXT NOT NULL,
    run_key TEXT NOT NULL,
    listener TEXT NOT NULL,
    PRIMARY KEY (playbook_key, type, run_key, listener)
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_subscriptions (
    playbook_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    reference TEXT NOT NULL,
    version BIGINT NOT NULL,
    kind TEXT NOT NULL,
    rule TEXT NOT NULL,
    activated_by TEXT NOT NULL,
    activated_at BIGINT NOT NULL,
    next_due BIGINT,
    running TEXT,
    PRIMARY KEY (playbook_key, workflow, reference)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_subscriptions_due ON workflow_subscriptions (next_due)
    WHERE next_due IS NOT NULL`,
  statement`CREATE TABLE IF NOT EXISTS workflow_subscription_types (
    playbook_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    type TEXT NOT NULL,
    PRIMARY KEY (playbook_key, workflow, type)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_subscription_types_by_type
    ON workflow_subscription_types (playbook_key, type, workflow)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_reaction_rates (
    playbook_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    minute BIGINT NOT NULL,
    starts INTEGER NOT NULL,
    PRIMARY KEY (playbook_key, workflow)
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_reaction_backlog (
    playbook_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    run_id TEXT NOT NULL,
    start TEXT NOT NULL,
    due BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (playbook_key, run_id)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_reaction_backlog_due ON workflow_reaction_backlog (due)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_reaction_refusals (
    playbook_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    version INTEGER NOT NULL,
    minute BIGINT NOT NULL,
    count INTEGER NOT NULL,
    reason TEXT NOT NULL,
    recorded INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (playbook_key, workflow)
  )`,
];

const hostTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS workflow_runs (
    run_key TEXT NOT NULL PRIMARY KEY,
    stream_id TEXT NOT NULL,
    dispatched_through BIGINT NOT NULL DEFAULT 0,
    ended_at BIGINT,
    taken BIGINT NOT NULL DEFAULT 0
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_runs_live ON workflow_runs (taken, run_key)
    WHERE ended_at IS NULL OR dispatched_through < ended_at`,
  statement`CREATE TABLE IF NOT EXISTS workflow_snapshot_chunks (
    run_key TEXT NOT NULL,
    version BIGINT NOT NULL,
    chunk INTEGER NOT NULL,
    chunks INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (run_key, version, chunk)
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_timers (
    run_key TEXT NOT NULL,
    timer_id TEXT NOT NULL,
    state TEXT NOT NULL,
    due_at BIGINT,
    armed_by BIGINT,
    PRIMARY KEY (run_key, timer_id)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_timers_due ON workflow_timers (due_at) WHERE state = 'armed'`,
  statement`CREATE TABLE IF NOT EXISTS workflow_calls (
    call_key TEXT NOT NULL PRIMARY KEY,
    run_key TEXT NOT NULL,
    state TEXT NOT NULL,
    call TEXT,
    attributes TEXT,
    result TEXT,
    delivered INTEGER NOT NULL DEFAULT 0,
    child TEXT,
    root_id TEXT,
    started_by BIGINT,
    dispatched_at BIGINT
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_calls_unfinished ON workflow_calls (call_key)
    WHERE state = 'running' OR (state = 'answered' AND delivered = 0)`,
  statement`CREATE INDEX IF NOT EXISTS workflow_calls_waiting_by_dispatch ON workflow_calls (dispatched_at)
    WHERE state = 'waiting'`,
  statement`CREATE TABLE IF NOT EXISTS workflow_pending_cancels (
    run_key TEXT NOT NULL PRIMARY KEY,
    cause TEXT NOT NULL,
    cancelled_by TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT NOT NULL
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_due (
    run_key TEXT NOT NULL PRIMARY KEY,
    version BIGINT NOT NULL,
    next_due_at BIGINT
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_due_by_time ON workflow_due (next_due_at)
    WHERE next_due_at IS NOT NULL`,
  statement`CREATE TABLE IF NOT EXISTS workflow_settlements (
    run_key TEXT NOT NULL PRIMARY KEY,
    settlement TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at BIGINT
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_leases (
    name TEXT NOT NULL PRIMARY KEY,
    holder TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  ...followerTables,
];

const ColumnRows = Schema.Array(Schema.Struct({ name: Schema.String }));

async function columnAddedOn(connection: ConnectionPorts, { table, column, added }: AddedColumn): Promise<void> {
  const columns = Schema.decodeUnknownSync(ColumnRows)(await connection.read(columnsOnSQLite(table)));
  if (!columns.some(({ name }) => name === column)) {
    await connection.write(added);
  }
}

type TablesMade = (connection: ConnectionPorts, tables: readonly Statement[]) => Promise<void>;

const tablesMadeIn: Readonly<Record<Dialect, TablesMade>> = {
  sqlite: async (connection, tables) => {
    await connection.migrated([...hostTables, ...tables]);
    await addedColumns.reduce<Promise<void>>(
      (before, column) => before.then(() => columnAddedOn(connection, column)),
      Promise.resolve(),
    );
    await connection.migrated(indexesOfAddedColumns);
  },
  postgresql: (connection, tables) =>
    connection.migrated([
      ...hostTables,
      ...tables,
      ...addedColumns.map(({ addedWhenMissing }) => addedWhenMissing),
      ...indexesOfAddedColumns,
    ]),
};

export function hostTablesMadeOn(connection: ConnectionPorts, tables: readonly Statement[]): Promise<void> {
  return tablesMadeIn[connection.dialect](connection, tables);
}
