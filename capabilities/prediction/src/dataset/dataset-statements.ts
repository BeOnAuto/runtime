import {
  statement,
  statementOf,
  type LayoutStep,
  type RowPhase,
  type Statement,
  type StatementValue,
} from '@on.auto/workflow-host';

export const predictionLayoutSteps: readonly LayoutStep[] = [
  {
    layout: 7,
    statements: [
      statement`DROP TABLE IF EXISTS prediction_builds_1`,
      statement`DROP TABLE IF EXISTS prediction_models_1`,
      statement`DROP TABLE IF EXISTS prediction_rows`,
      statement`DROP TABLE IF EXISTS prediction_datasets`,
    ],
  },
];

export const datasetTables = { datasets: 'prediction_datasets', rows: 'prediction_rows' } as const;

export const datasetsTable = statementOf(
  [
    `CREATE TABLE IF NOT EXISTS ${datasetTables.datasets} (
    playbook_key TEXT NOT NULL,
    data_sha256 TEXT NOT NULL,
    saved BIGINT NOT NULL,
    phase TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    checkpoint_at TEXT,
    rows BIGINT NOT NULL,
    series BIGINT NOT NULL,
    first_period TEXT,
    last_period TEXT,
    events_folded BIGINT NOT NULL,
    passed_over BIGINT NOT NULL,
    tries BIGINT NOT NULL,
    stalled_record TEXT,
    stalled_detail TEXT,
    data TEXT NOT NULL,
    PRIMARY KEY (playbook_key, data_sha256)
  )`,
  ],
  [],
);

export const rowsTable = statementOf(
  [
    `CREATE TABLE IF NOT EXISTS ${datasetTables.rows} (
    playbook_key TEXT NOT NULL,
    data_sha256 TEXT NOT NULL,
    series TEXT NOT NULL,
    period_index BIGINT NOT NULL,
    period TEXT NOT NULL,
    target DOUBLE PRECISION,
    target_count BIGINT NOT NULL,
    target_at BIGINT,
    events BIGINT NOT NULL,
    PRIMARY KEY (playbook_key, data_sha256, series, period_index)
  )`,
  ],
  [],
);

export interface Values {
  readonly values: readonly StatementValue[];
  readonly separator: string;
}

export type Piece = string | Values;

export function each(values: readonly StatementValue[], separator = ', '): Values {
  return { values, separator };
}

export function composed(...pieces: readonly Piece[]): Statement {
  const parts: string[] = [];
  const values: StatementValue[] = [];
  let current = '';
  for (const piece of pieces) {
    if (typeof piece === 'string') {
      current += piece;
    } else {
      for (const [index, value] of piece.values.entries()) {
        parts.push(index === 0 ? current : `${current}${piece.separator}`);
        values.push(value);
        current = '';
      }
    }
  }
  parts.push(current);
  return statementOf(parts, values);
}

export function tuples(rows: readonly (readonly StatementValue[])[]): readonly Piece[] {
  return rows.flatMap((row, index) => [index === 0 ? '(' : ', (', each(row), ')']);
}

export function datasetAdded(
  playbookKey: string,
  dataSha256: string,
  saved: number,
  data: string,
): (phase: RowPhase) => Statement {
  return (phase) => statement`INSERT INTO prediction_datasets (
      playbook_key, data_sha256, saved, phase, checkpoint, rows, series, events_folded, passed_over, tries, data
    ) VALUES (${playbookKey}, ${dataSha256}, ${saved}, ${phase}, '', 0, 0, 0, 0, 0, ${data})
    ON CONFLICT (playbook_key, data_sha256) DO NOTHING`;
}

export function datasetPhased(playbookKey: string, dataSha256: string, phase: RowPhase): Statement {
  return statement`UPDATE prediction_datasets SET phase = ${phase}
    WHERE playbook_key = ${playbookKey} AND data_sha256 = ${dataSha256} AND phase IN ('waiting', 'rebuilding')`;
}

export function datasetDropped(playbookKey: string, dataSha256: string): readonly Statement[] {
  return [
    statement`DELETE FROM prediction_rows WHERE playbook_key = ${playbookKey} AND data_sha256 = ${dataSha256}`,
    statement`DELETE FROM prediction_datasets WHERE playbook_key = ${playbookKey} AND data_sha256 = ${dataSha256}`,
  ];
}

export function datasetsOfPlaybook(playbookKey: string): Statement {
  return statement`SELECT playbook_key, data_sha256, saved, phase, checkpoint, checkpoint_at, rows, series, first_period,
      last_period, events_folded, passed_over, tries, stalled_record, stalled_detail, data
    FROM prediction_datasets WHERE playbook_key = ${playbookKey} ORDER BY saved, data_sha256`;
}

export function datasetNamed(playbookKey: string, dataSha256: string): Statement {
  return statement`SELECT playbook_key, data_sha256, saved, phase, checkpoint, checkpoint_at, rows, series, first_period,
      last_period, events_folded, passed_over, tries, stalled_record, stalled_detail, data
    FROM prediction_datasets WHERE playbook_key = ${playbookKey} AND data_sha256 = ${dataSha256}`;
}

export const playbooksWithDatasets = statement`SELECT DISTINCT playbook_key FROM prediction_datasets ORDER BY playbook_key`;
