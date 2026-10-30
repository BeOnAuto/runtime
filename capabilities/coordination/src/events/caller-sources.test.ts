import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testPlaybookNames } from '../testing/test-sandbox.ts';
import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';
import { acmeCaller } from '../testing/workflows.ts';
import { defineSendRunEvent } from './send-run-event.ts';

let playbook: WorkflowPlaybook;

let sendEvent: ReturnType<typeof defineSendRunEvent>;

const approval = `document:
  dsl: '1.0.3'
  namespace: acme
  name: approval
  version: '1.0.0'
do:
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
`;

beforeAll(async () => {
  playbook = await workflowPlaybook();
  sendEvent = defineSendRunEvent(playbook.host, testPlaybookNames);
  await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'approval', source: approval });
});

afterAll(async () => {
  await playbook.close();
});

describe('the source send_run_event gives an event sent without one', () => {
  it.each([
    ['a signed-in person', 'person:user/ada|7 ü%', '/callers/person:user%2Fada%7C7%20%C3%BC%25', 1],
    ['the playbook itself', 'playbook:alpha', '/callers/playbook:alpha', 2],
    ['a key', "acme-ci_1.~!$&'()*+,;=@", "/callers/acme-ci_1.~!$&'()*+,;=@", 3],
  ])('percent-encodes the id of %s where RFC 3986 requires, in one path segment', async (_case, id, source, run) => {
    const runId = `0199a3c4-7d2e-7c1a-9b3f-00000000000${run}`;
    await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'approval', run_id: runId });

    const sent = await playbook.call(
      sendEvent,
      { run_id: runId, event: { type: 'com.acme.other' } },
      { ...acmeCaller, id },
    );

    expect(sent).toMatchObject({ status: 'succeeded', output: { event: { source } } });
  });
});
