import { describe, expect, it } from 'vitest';

import { compositionRoot } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';

const guidesNamingValues = ['lookup-function', 'interaction-function', 'computation-function', 'workflow'];

const settingsOfAnOperator = {
  TOOL_CALL_MAX_REQUEST_MIB: '3',
  INTERACTION_OPEN_REQUESTS: '7',
  WORKFLOW_MAX_DURATION: 'PT3H',
};

async function guidesServedWith(settings: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const ledger = temporaryLedger();
  try {
    const server = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LOG_LEVEL: 'error',
        LEDGER_FILE: ledger.fileName,
        ...noConsentThroughAuto,
        ...settings,
      },
      compositionRoot,
    );
    try {
      return await Promise.all(
        guidesNamingValues.map(async (name) =>
          (await fetch(`http://127.0.0.1:${server.port}/v1/guides/${name}`)).text(),
        ),
      );
    } finally {
      await server.stop();
    }
  } finally {
    ledger.remove();
  }
}

describe('the guides a server serves', () => {
  it('say each limit as the settings of its operator set it, and who can change it, and never the setting', async () => {
    const [lookup, interaction, computation, workflow] = await guidesServedWith(settingsOfAnOperator);
    const served = [lookup, interaction, computation, workflow].join('\n');

    expect([
      lookup?.includes('| The arguments of the call | 3 MiB as JSON |'),
      interaction?.includes('| The arguments of a call | 3 MiB as JSON |'),
      interaction?.includes('| Open requests of a playbook | 7 at once |'),
      computation?.includes('| Memory | 256 MiB a run |'),
      workflow?.includes('| Duration of a run | 3 hours from its start;'),
      lookup?.includes('The limits for what one call may send can be changed only by whoever runs the server.'),
      interaction?.includes(
        'The limits for what one call may send and for the requests a playbook holds open can be changed only by whoever runs the server.',
      ),
      computation?.includes("The limits for a run's memory are fixed on this server."),
      workflow?.includes('The limits for how long a run may last can be changed only by whoever runs the server.'),
    ]).toEqual([true, true, true, true, true, true, true, true, true]);
    expect(served).not.toMatch(
      /data-variable|data-audience|16 MiB as JSON|10,000 at once|30 days from its start|TOOL_CALL_MAX_REQUEST_MIB|INTERACTION_OPEN_REQUESTS|WORKFLOW_MAX_DURATION|COMPUTATION_WORKERS/u,
    );
  });

  it('say the defaults of the runtime where its operator sets none', async () => {
    const [lookup, interaction, , workflow] = await guidesServedWith({});

    expect([
      lookup?.includes('| The arguments of the call | 16 MiB as JSON |'),
      interaction?.includes('| Open requests of a playbook | 10,000 at once |'),
      workflow?.includes('| Duration of a run | 30 days from its start;'),
    ]).toEqual([true, true, true]);
  });
});
