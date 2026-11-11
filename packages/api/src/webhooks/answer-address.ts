import { webhookToleranceSeconds, type PresentedWebhook } from '@on.auto/identity';
import { OrgIdSchema, PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { DeliveryBounds } from './delivery-bounds.ts';
import type { AnswerAddress } from './delivery-ports.ts';

export const answerRoutePath = `${versionPrefix}/orgs/:org/playbooks/:playbook/connections/:connection/runs/:run_id/answer`;

const isOrgId = Schema.is(OrgIdSchema);

const isPlaybookId = Schema.is(PlaybookIdSchema);

const isRunId = Schema.is(Schema.String.check(Schema.isUUID()));

const mostConnectionCharacters = 256;

export function addressIn(c: Context<ApiEnv>): AnswerAddress | undefined {
  const [org, playbook, connection = '', runId] = ['org', 'playbook', 'connection', 'run_id'].map((name) =>
    String(c.req.param(name)),
  );
  const wellFormed =
    isOrgId(org) && isPlaybookId(playbook) && isRunId(runId) && connection.length <= mostConnectionCharacters;
  return wellFormed ? { org, playbook, connection, runId: runId.toLowerCase() } : undefined;
}

export function takenForOf({ playbook, runId }: AnswerAddress): string {
  return `${playbook}/${runId}`;
}

export function keptUntilMsOf({ timestamp }: PresentedWebhook, bounds: DeliveryBounds): number {
  return (timestamp + webhookToleranceSeconds + bounds.keptPastTheWindowSeconds) * 1000;
}
