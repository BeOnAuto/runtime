import { openRequests } from '@on.auto/interaction';
import { Ledger, projectedTableOf, type KeyedProjection } from '@on.auto/operations';
import { serveFakeMcp } from '@on.auto/tool-servers/testing';
import { ManagedRuntime, Schema, type Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha } from '../servers/reasoning-server.ts';
import { until } from '../waiting/until.ts';
import { chatEnvironment, chatKey } from './chat-deliveries.ts';
import { interactionServerOn, servingInteractions, type InteractionServer } from './interaction-server.ts';

export interface ProjectionStore {
  readonly environment: Readonly<Record<string, string>>;
  readonly ledgerKeeping: (projection: KeyedProjection) => Layer.Layer<Ledger>;
  readonly tablesOf: (projection: string) => Promise<readonly string[]>;
  readonly dropTable: (table: string) => Promise<void>;
}

export interface ProjectionStoreChoice {
  readonly store: string;
  readonly skipped: boolean;
  readonly aStore: () => Promise<ProjectionStore>;
}

const versionOne: KeyedProjection = {
  ...openRequests,
  version: 1,
  columns: openRequests.columns.filter(({ name }) => name !== 'answer_schema'),
  rowAfter: (row, message) =>
    openRequests.rowAfter(row === undefined ? undefined : { ...row, answer_schema: null }, message),
};

const approvalSchema = {
  type: 'object',
  required: ['choice'],
  properties: { choice: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string', maxLength: 2000 } },
};

const ListedSchema = Schema.Struct({
  interactions: Schema.Array(
    Schema.Struct({
      run_id: Schema.String,
      standing: Schema.String,
      attempts: Schema.Int,
      answer_schema: Schema.NullOr(Schema.JsonObject),
    }),
  ),
});

type Listed = (typeof ListedSchema.Type)['interactions'];

const decodeListed = Schema.decodeUnknownSync(ListedSchema);

async function listedIn(server: InteractionServer): Promise<Listed> {
  return decodeListed((await server.call('GET', `${alpha}/interactions`)).body).interactions;
}

function eachTriedOnce(listed: Listed): boolean {
  return listed.length === 2 && listed.every(({ standing }) => standing === 'retrying');
}

function answerShapesOf(listed: Listed): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    listed.map(({ run_id: id, attempts, answer_schema: schema }) => [id, { attempts, answer_schema: schema }]),
  );
}

const refusedDelivery = ['deliver:', '  server: chat', '  tool: denied', '  with:', "    text: '{{ message }}'"];

async function refusingChat(): Promise<Readonly<Record<string, string>>> {
  const chat = await serveFakeMcp({ bearer: chatKey });
  onTestFinished(chat.close);
  return chatEnvironment(chat.url);
}

async function versionOneLeftIn(store: ProjectionStore): Promise<readonly string[]> {
  await store.dropTable(projectedTableOf(openRequests));
  const runtime = ManagedRuntime.make(store.ledgerKeeping(versionOne));
  await runtime.runPromise(Ledger);
  await runtime.dispose();
  return store.tablesOf(openRequests.name);
}

export function answerShapesOn(stores: readonly ProjectionStoreChoice[]): void {
  describe.each(stores)('the answer shape of an open request, on $store', ({ skipped, aStore }) => {
    it.skipIf(skipped)(
      'is the schema a question recorded and null for a notification, as each append keeps it and once the table of version 1 is rebuilt',
      async () => {
        const store = await aStore();
        const environment = { ...store.environment, ...(await refusingChat()) };
        const first = await servingInteractions(refusedDelivery, environment);
        const question = await first.ask('approve-brief');
        const notification = await first.ask('brief-out');
        const kept = answerShapesOf(await until(() => listedIn(first), eachTriedOnce));
        await first.stop();
        const leftByVersionOne = await versionOneLeftIn(store);

        const second = await interactionServerOn(environment);
        const rebuilt = answerShapesOf(await listedIn(second));

        expect(leftByVersionOne).toEqual([projectedTableOf(versionOne)]);
        expect([kept, rebuilt]).toEqual([
          {
            [question]: { attempts: 1, answer_schema: approvalSchema },
            [notification]: { attempts: 1, answer_schema: null },
          },
          {
            [question]: { attempts: 1, answer_schema: approvalSchema },
            [notification]: { attempts: 1, answer_schema: null },
          },
        ]);
        expect(await store.tablesOf(openRequests.name)).toEqual([projectedTableOf(openRequests)]);
      },
    );
  });
}
