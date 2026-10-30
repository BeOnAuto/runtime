import { DatabaseSync } from 'node:sqlite';

import { sha256Of } from '@on.auto/operations';
import { Schema } from 'effect';

import { aDatabaseFrom, theSQLiteFloor } from './database-floor.ts';

const dataOfAnEarlierRelease =
  '{"events":[{"type":"visit.made"}],"features":[],"period":"day","series":"/store","target":{"as":"sum","of":"/visits"},"time":"event"}';

const digestOfAnEarlierRelease = sha256Of(dataOfAnEarlierRelease);

const playbookKey = 'playbook/acme/alpha/';

const DefinitionFactSchema = Schema.Tuple([
  Schema.Struct({ global_position: Schema.Number, message_data: Schema.String }),
]);

const JsonObjectSchema = Schema.Record(Schema.String, Schema.Json);

const DefinitionCreatedSchema = Schema.fromJsonString(
  Schema.StructWithRest(Schema.Struct({ content: JsonObjectSchema }), [JsonObjectSchema]),
);

const tablesOfTheFacts = [
  'emt_streams',
  'emt_messages',
  'recorded_content_chunks',
  'recorded_content_heads',
  'kept_secrets',
];

const ofTheDefinition =
  "SELECT global_position, message_data FROM emt_messages WHERE message_type = 'definition_created'";

const aDatasetFolded = `INSERT INTO prediction_datasets (playbook_key, data_sha256, saved, phase, checkpoint, checkpoint_at,
    rows, series, first_period, last_period, events_folded, passed_over, tries, data)
  VALUES (?, ?, 1, 'live', '["1","0"]', NULL, 1, 1, '2024-10-04', '2024-10-04', 1, 0, 0, ?)`;

const aRowFolded = `INSERT INTO prediction_rows (playbook_key, data_sha256, series, period_index, period, target,
    target_count, target_at, events, features)
  VALUES (?, ?, 'north', 20000, '2024-10-04', 11, 1, NULL, 1, '[]')`;

function withTheDetailsOfAnEarlierRelease(messageData: string): string {
  const fact = Schema.decodeUnknownSync(DefinitionCreatedSchema)(messageData);
  const data = Schema.decodeUnknownSync(Schema.fromJsonString(JsonObjectSchema))(dataOfAnEarlierRelease);
  const details = { shape: 'series', data_sha256: digestOfAnEarlierRelease, data };
  return JSON.stringify({ ...fact, content: { ...fact.content, details } });
}

export function aPredictionFunctionAtTheFloor(made: string, carried: string): void {
  aDatabaseFrom(theSQLiteFloor(), carried);
  const database = new DatabaseSync(carried);
  try {
    database.prepare('ATTACH DATABASE ? AS made').run(made);
    for (const table of tablesOfTheFacts) {
      database.exec(`INSERT INTO ${table} SELECT * FROM made.${table}`);
    }
    const [definition] = Schema.decodeUnknownSync(DefinitionFactSchema)(database.prepare(ofTheDefinition).all());
    database
      .prepare('UPDATE emt_messages SET message_data = ? WHERE global_position = ?')
      .run(withTheDetailsOfAnEarlierRelease(definition.message_data), definition.global_position);
    database.prepare(aDatasetFolded).run(playbookKey, digestOfAnEarlierRelease, dataOfAnEarlierRelease);
    database.prepare(aRowFolded).run(playbookKey, digestOfAnEarlierRelease);
  } finally {
    database.close();
  }
}
