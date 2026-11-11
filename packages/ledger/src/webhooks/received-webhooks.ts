import { SQL } from '@event-driven-io/dumbo';
import { Clock, Effect, Schema } from 'effect';

import type { ReturningExecutor } from '../event-store.ts';
import { receivedWebhooks } from './received-webhooks-table.ts';

export interface WebhookReceipt {
  readonly org: string;
  readonly connection: string;
  readonly webhookId: string;
  readonly takenFor: string;
  readonly keptUntilMs: number;
}

export interface ReceivedWebhooks {
  readonly taken: (receipt: WebhookReceipt) => Effect.Effect<string>;
  readonly close: () => Promise<void>;
}

const decodeHolder = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ taken_for: Schema.String })]));

function takenOn(execute: ReturningExecutor, receipt: WebhookReceipt): Effect.Effect<string> {
  const { org, connection, webhookId, takenFor, keptUntilMs } = receipt;
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.promise(async () => {
      await execute.command(SQL`DELETE FROM ${receivedWebhooks} WHERE kept_until < ${now}`);
      const { rows } = await execute.command(
        SQL`INSERT INTO ${receivedWebhooks} (org, connection, webhook_id, taken_for, kept_until)
          VALUES (${org}, ${connection}, ${webhookId}, ${takenFor}, ${keptUntilMs})
          ON CONFLICT (org, connection, webhook_id) DO UPDATE SET kept_until = ${receivedWebhooks}.kept_until
          RETURNING taken_for`,
      );
      const [held] = decodeHolder(rows);
      return held.taken_for;
    }),
  );
}

export function receivedWebhooksOn(execute: ReturningExecutor, close: () => Promise<void>): ReceivedWebhooks {
  return { taken: (receipt) => takenOn(execute, receipt), close };
}
