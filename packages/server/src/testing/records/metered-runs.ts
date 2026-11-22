import { statement } from '@on.auto/ledger';
import { METER_STREAM } from '@on.auto/meter/testing';

import { runIdIn, workflowSource } from '../servers/workflow-server.ts';
import { contributing, givenGoals } from '../settings/goals-kept.ts';
import { namesIn, readOfTheLedgerIn } from './ledger-file.ts';

const tally = workflowSource('tally', 'do:\n  - count:\n      set: { counted: true }\n');

const playbooks = '/v1/orgs/local/playbooks';

async function posted(origin: string, path: string, body: object): Promise<unknown> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const answer: unknown = await response.json();
  return answer;
}

/** Creates the playbook alpha of the org local, a workflow tally in it, and runs it once; answers the run's id. */
export async function aRunOfTallyAt(origin: string): Promise<string> {
  await posted(origin, playbooks, { playbook: 'alpha', name: 'Alpha', goals: givenGoals });
  await posted(origin, `${playbooks}/alpha/definitions/workflow`, { name: 'tally', source: contributing(tally) });
  return runIdIn(await posted(origin, `${playbooks}/alpha/definitions/workflow/tally/run`, { input: {} }));
}

/** The runs the meter admitted, in the order it admitted them, as the ledger in the file holds them. */
export async function admittedByTheMeterIn(ledgerFile: string): Promise<readonly string[]> {
  return namesIn(
    await readOfTheLedgerIn(
      ledgerFile,
      statement`SELECT json_extract(message_data, '$.run') AS name FROM emt_messages WHERE stream_id = ${METER_STREAM} AND message_type = 'action_admitted' ORDER BY global_position`,
    ),
  );
}
