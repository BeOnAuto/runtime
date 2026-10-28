import { statement } from '@on.auto/ledger';
import { METER_STREAM } from '@on.auto/meter/testing';
import { describe, expect, it } from 'vitest';

import { isAcceptingConnections } from '../testing/processes/accepting-connections.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { homeOfTheTest, spawnRuntimeCommand } from '../testing/processes/runtime-command.ts';
import { namesIn, readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const tally = workflowSource('tally', 'do:\n  - count:\n      set: { counted: true }\n');

const playbooks = '/v1/orgs/local/playbooks';

async function posted(port: number, path: string, body: object): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const answer: unknown = await response.json();
  return answer;
}

async function admittedByTheMeterIn(ledgerFile: string): Promise<readonly string[]> {
  return namesIn(
    await readOfTheLedgerIn(
      ledgerFile,
      statement`SELECT json_extract(message_data, '$.run') AS name FROM emt_messages WHERE stream_id = ${METER_STREAM} AND message_type = 'action_admitted' ORDER BY global_position`,
    ),
  );
}

describe('a runtime the auto-runtime command started', () => {
  it.each<readonly [string, readonly string[]]>([
    ['with no command', []],
    ['with start, in a terminal', ['start']],
    [
      'with start --background, for an agent',
      ['start', '--background', '--instance', '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'],
    ],
  ])('admits each run by its meter, started %s', async (_how, command) => {
    const home = homeOfTheTest('auto-runtime-metered-');
    const port = await aPortNothingListensOn();
    const runtime = spawnRuntimeCommand(command, { home, port });
    await until(() => isAcceptingConnections(port), Boolean);
    await posted(port, playbooks, { playbook: 'alpha', name: 'Alpha' });
    await posted(port, `${playbooks}/alpha/definitions/workflow`, { name: 'tally', source: tally });
    const run = runIdIn(await posted(port, `${playbooks}/alpha/definitions/workflow/tally/run`, { input: {} }));
    runtime.interrupt();
    await runtime.exited;

    expect(await admittedByTheMeterIn(`${home}/.auto-runtime/ledger.db`)).toEqual([`playbook/local/alpha/runs/${run}`]);
  });
});
