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
  'language: typescript',
  'source:',
  '  events:',
  '    - type: run_succeeded',
  '      subject: computation/echo',
  'view:',
  '  initial: []',
  '  schema: {type: array, items: {type: string}}',
  '---',
  'export function fold(view: View, event: Event): View {',
  '  const data = event.data as { output: { said: string } };',
  '  return [...view, data.output.said];',
  '}',
  '',
  'export function answer(view: View): Output {',
  '  return view.map((said) => said.toUpperCase());',
  '}',
].join('\n');

describe('the functions pnpm dev serves in worker threads', () => {
  it('runs a computation function, folds its runs into the view of a recall function and answers from the view', async () => {
    const development = startDevelopment(developmentFiles());
    const port = await untilListening(development);
    const call = (method: string, path: string, body?: unknown): Promise<TestResponse> =>
      request(port, method, path, { body });

    await call('POST', '/v1/orgs/local/playbooks', { playbook: 'meetings', name: 'Meetings' });
    await call('POST', `${meetings}/definitions/computation`, { name: 'echo', source: echo });
    const echoed = await call('POST', `${meetings}/definitions/computation/echo/run`, { input: { said: 'hello' } });
    expect(echoed.body).toMatchObject({ status: 'succeeded', output: { said: 'hello' } });
    await call('POST', `${meetings}/definitions/recall`, { name: 'said', source: saidSoFar });
    const recalled = await until(async () => {
      const answered = await call('POST', `${meetings}/definitions/recall/said/run`, { input: {} });
      expect(answered.status).toBe(200);
      return answered;
    });

    expect(recalled.body).toMatchObject({ status: 'succeeded', output: ['HELLO'] });
  });
});
