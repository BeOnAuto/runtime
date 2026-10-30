import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import type { DefinitionCall, DefinitionCallResult } from '../testing/run-terms.ts';
import { testWorkflowPolicy } from '../testing/test-sandbox.ts';
import { interpret, workflowExample, yamlObject } from '../testing/workflows.ts';

const example = yamlObject(workflowExample);

function triagedAs(urgency: string): (call: DefinitionCall) => DefinitionCallResult {
  return ({ name }) =>
    name === 'classify-ticket'
      ? { status: 'succeeded', output: { category: 'billing', urgency } }
      : { status: 'succeeded', output: 'Refund failed twice; the customer is waiting.' };
}

describe('the example of a workflow that triages a ticket', () => {
  it('stores as a valid definition document', async () => {
    await expect(Effect.runPromise(parseWorkflowDocument(workflowExample, testWorkflowPolicy))).resolves.toEqual(
      example,
    );
  });

  it('drafts a note for an urgent ticket and hands on what the approval event carried', async () => {
    const { ending } = await interpret(example, {
      input: { ticket: 'I was charged twice' },
      respond: triagedAs('high'),
      started: (start) => {
        start.deliver({ id: 'a1', type: 'com.acme.escalation.approved', data: { by: 'dana' } });
      },
    });

    expect(ending).toEqual({
      kind: 'completed',
      output: {
        ticket: 'I was charged twice',
        triage: { category: 'billing', urgency: 'high' },
        note: 'Refund failed twice; the customer is waiting.',
        approved_by: 'dana',
      },
    });
  });

  it('skips the note and the approval for a ticket that is not urgent, handing its input on', async () => {
    const { ending } = await interpret(example, { input: { ticket: 'How do I export?' }, respond: triagedAs('low') });

    expect(ending).toEqual({
      kind: 'completed',
      output: { ticket: 'How do I export?', triage: { category: 'billing', urgency: 'low' } },
    });
  });
});
