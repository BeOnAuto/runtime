import { describe, expect, it } from 'vitest';

import { developmentFiles, startDevelopment, untilListening } from '../testing/processes/development-process.ts';
import { request, type TestResponse } from '../testing/servers/http-client.ts';
import { until } from '../testing/waiting/until.ts';

const meetings = '/v1/orgs/local/playbooks/meetings';

const echoWith = (page: readonly string[]): string =>
  [
    '---',
    'language: typescript',
    'input:',
    '  schema: {type: object}',
    ...page,
    '---',
    'export default function (input: Input): Output {',
    '  return input;',
    '}',
  ].join('\n');

const echo = echoWith([]);

const echoWithWhatItWasTold = echoWith([
  'page:',
  '  data:',
  '    language: typescript',
  '    source:',
  '      events:',
  '        - type: run_succeeded',
  '          subject: computation/echo',
  '    views:',
  '      said: categories',
  '    module: |',
  '      export function fold(view: View, event: Event): View {',
  '        const fieldOf = (value: Json | undefined, name: string): Json | undefined =>',
  "          typeof value === 'object' && value !== null && !Array.isArray(value) ? value[name] : undefined;",
  "        const said = fieldOf(fieldOf(event.data, 'output'), 'said');",
  "        const name = typeof said === 'string' ? said.toUpperCase() : 'Other';",
  '        return { said: { values: [...(view.said?.values ?? []), { name, value: 1 }] } };',
  '      }',
  "  result: '{{ output.said }}'",
  "  lately: '{% for value in views.said.values %}{{ value.name }}{% endfor %}'",
]);

describe('the functions pnpm dev serves in worker threads', () => {
  it('runs a computation function, and folds its runs into the views of its page', async () => {
    const development = startDevelopment(developmentFiles());
    const port = await untilListening(development);
    const call = (method: string, path: string, body?: unknown): Promise<TestResponse> =>
      request(port, method, path, { body });

    await call('POST', '/v1/orgs/local/playbooks', { playbook: 'meetings', name: 'Meetings' });
    await call('POST', `${meetings}/definitions/computation`, { name: 'echo', source: echo, diagram: 'none' });
    const echoed = await call('POST', `${meetings}/definitions/computation/echo/run`, { input: { said: 'hello' } });
    expect(echoed.body).toMatchObject({ status: 'succeeded', output: { said: 'hello' } });
    await call('PUT', `${meetings}/definitions/computation/echo`, { source: echoWithWhatItWasTold, diagram: 'none' });
    const presented = await until(async () => {
      const read = await call('GET', `${meetings}/definitions/computation/echo`);
      expect(read.body).toMatchObject({ page: { standing: { state: 'live', folded: 1 } } });
      return read;
    });

    expect(presented.body).toMatchObject({ page: { lately: 'HELLO' } });
  });
});
