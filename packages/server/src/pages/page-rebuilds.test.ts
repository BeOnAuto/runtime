import { afterEach, describe, expect, it } from 'vitest';

import { foldsHeld, foldsHeldUntilOpened, pageInState, servingPages } from '../testing/servers/page-server.ts';
import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';

const echo = [
  '---',
  'language: typescript',
  'input:',
  '  schema: {type: object}',
  '---',
  'export default function (input: Input): Output {',
  '  return input;',
  '}',
].join('\n');

function withItsPage(subject: string): string {
  return [
    '---',
    'language: typescript',
    'input:',
    '  schema: {type: object}',
    'page:',
    '  data:',
    '    language: typescript',
    '    source:',
    '      events:',
    '        - type: run_succeeded',
    `          subject: computation/${subject}`,
    '    views:',
    '      runs: categories',
    '    module: |',
    '      export function fold(view: View, event: Event): View {',
    '        return { runs: { values: [...(view.runs?.values ?? []), { name: event.type, value: 1 }] } };',
    '      }',
    '  result: Ran.',
    "  lately: '{{ views.runs.values | size }} runs.'",
    '---',
    'export default function (input: Input): Output {',
    '  return input;',
    '}',
  ].join('\n');
}

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function inPlaybook(playbook: string): string {
  return `/v1/orgs/acme/playbooks/${playbook}`;
}

async function ranOnce(playbook: string, subject: string): Promise<readonly number[]> {
  const saved = await server.call('POST', `${inPlaybook(playbook)}/definitions/computation`, {
    body: { name: subject, source: echo, diagram: 'none' },
  });
  const ran = await server.call('POST', `${inPlaybook(playbook)}/definitions/computation/${subject}/run`, {
    body: { input: {} },
  });
  return [saved.status, ran.status];
}

async function pageSaved(playbook: string, subject: string): Promise<number> {
  const saved = await server.call('PUT', `${inPlaybook(playbook)}/definitions/computation/${subject}`, {
    body: { source: withItsPage(subject), diagram: 'none' },
  });
  return saved.status;
}

async function playbookCreated(playbook: string): Promise<number> {
  const created = await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook, name: playbook } });
  return created.status;
}

describe('the views of the pages of a playbook, built at most PAGE_MAX_REBUILDS at once', () => {
  it('builds one page while the next waits its turn, and both once the first has caught up', async () => {
    const gate = foldsHeldUntilOpened();
    server = await servingPages([], { PAGE_MAX_REBUILDS: '1', PROJECTION_PLAYBOOKS_AT_ONCE: '1' }, gate.poolOf);
    const made = [await playbookCreated('beta'), await playbookCreated('alpha')];
    const ran = [await ranOnce('beta', 'first'), await ranOnce('alpha', 'first'), await ranOnce('alpha', 'second')];
    const elsewhere = await pageSaved('beta', 'first');
    await foldsHeld(gate, 1);
    const saved = [await pageSaved('alpha', 'first'), await pageSaved('alpha', 'second')];
    gate.letThrough(1);

    const building = await Promise.all([
      pageInState(server, 'computation/first', 'rebuilding'),
      pageInState(server, 'computation/second', 'waiting'),
    ]);
    gate.open();
    const built = await Promise.all([
      pageInState(server, 'computation/first', 'live'),
      pageInState(server, 'computation/second', 'live'),
    ]);

    expect([made, ran, elsewhere, saved]).toEqual([
      [201, 201],
      [
        [201, 200],
        [201, 200],
        [201, 200],
      ],
      200,
      [200, 200],
    ]);
    expect(building).toMatchObject([
      { page: { standing: { state: 'rebuilding' } } },
      { page: { standing: { state: 'waiting' } } },
    ]);
    expect(built).toMatchObject([
      { page: { standing: { state: 'live', folded: 1 } } },
      { page: { standing: { state: 'live', folded: 1 } } },
    ]);
    expect(await server.call('GET', `${inPlaybook('alpha')}/definitions/computation/second`)).toMatchObject({
      body: { page: { lately: '1 runs.' } },
    });
  });
});
