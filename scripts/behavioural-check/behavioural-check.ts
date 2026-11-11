import { join } from 'node:path';

import { servedByAThrowawayServer } from '@on.auto/server/served-to-an-agent';
import { Schema } from 'effect';

import { BriefsSchema, runBehaviouralCheck } from './commands.ts';
import { askingThroughItsCommand, ModelSchema, versionOf } from './models.ts';
import { jsonIn } from './run-folder.ts';

const ModelsSchema = Schema.Struct({ models: Schema.Array(ModelSchema) });

export const recordPath = join(import.meta.dirname, 'results.jsonl');

if (import.meta.main) {
  await runBehaviouralCheck(process.argv.slice(2), {
    served: servedByAThrowawayServer,
    ask: askingThroughItsCommand(),
    models: jsonIn(join(import.meta.dirname, 'models.json'), ModelsSchema).models,
    versionOf,
    now: () => new Date(),
    briefs: jsonIn(join(import.meta.dirname, 'briefs.json'), BriefsSchema),
    record: recordPath,
    print: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
}
