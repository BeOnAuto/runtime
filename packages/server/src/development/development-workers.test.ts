import { describe, expect, it } from 'vitest';

import { developmentFiles, startDevelopment, untilListening } from '../testing/processes/development-process.ts';
import { request, type TestResponse } from '../testing/servers/http-client.ts';
import { until } from '../testing/waiting/until.ts';

const meetings = '/v1/orgs/local/playbooks/meetings';

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

const saidSoFar = [
  '---',
  'description: What the echo function was told, as it was told',
  'of: computation/echo',
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '        subject: computation/echo',
  '  views:',
  '    said: categories',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  '      const fieldOf = (value: Json | undefined, name: string): Json | undefined =>',
  "        typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;",
  "      const said = fieldOf(fieldOf(event.data, 'output'), 'said');",
  "      const name = typeof said === 'string' ? said.toUpperCase() : 'Other';",
  '      return { said: { values: [...(view.said?.values ?? []), { name, value: 1 }] } };',
  '    }',
  '---',
  '{% result %}{{ output.said }}{% endresult %}',
  '',
  '{% lately %}{% for value in views.said.values %}{{ value.name }}{% endfor %}{% endlately %}',
].join('\n');

describe('the functions pnpm dev serves in worker threads', () => {
  it('runs a computation function, and folds its runs into the views of a page that presents them', async () => {
    const development = startDevelopment(developmentFiles());
    const port = await untilListening(development);
    const call = (method: string, path: string, body?: unknown): Promise<TestResponse> =>
      request(port, method, path, { body });

    await call('POST', '/v1/orgs/local/playbooks', { playbook: 'meetings', name: 'Meetings' });
    await call('POST', `${meetings}/definitions/computation`, { name: 'echo', source: echo, diagram: 'none' });
    const echoed = await call('POST', `${meetings}/definitions/computation/echo/run`, { input: { said: 'hello' } });
    expect(echoed.body).toMatchObject({ status: 'succeeded', output: { said: 'hello' } });
    await call('POST', `${meetings}/definitions/page`, { name: 'said', source: saidSoFar });
    const presented = await until(async () => {
      const read = await call('GET', `${meetings}/definitions/page/said`);
      expect(read.body).toMatchObject({ standing: { state: 'live', folded: 1 } });
      return call('GET', `${meetings}/definitions/computation/echo`);
    });

    expect(presented.body).toMatchObject({ page: { lately: 'HELLO' } });
  });
});
