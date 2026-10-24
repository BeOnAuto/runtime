import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { terminologyGuideOf } from './terminology-guide.ts';

const theRequestTerm = 'Interaction:\n\n- Request: What a run of a function waits on when it asks a person';

const page = readFileSync(new URL('../../../../docs/concepts/terminology.md', import.meta.url), 'utf8');

describe('the terminology guide', () => {
  it('lists the capabilities the server runs with the resource each defines and what it does, then the terms', () => {
    const { name, title, text } = terminologyGuideOf(page, ['reasoning function', 'workflow']);

    expect({ name, title }).toEqual({ name: 'terminology', title: 'Terminology' });
    expect(text).toContain(
      [
        'The capabilities, the resource each one defines and what it does:',
        '',
        '- Coordination: Workflow.',
        '- Reasoning: Reasoning function. Use a prompt and a language model, with tools where configured, to interpret information or produce a response.',
        '',
        'Definitions and runs:',
        '',
        '- Playbook: The complete system for a business responsibility, including methods, functions, workflows, relevant information and operating boundaries.',
      ].join('\n'),
    );
    expect(text).toContain('- Language model: A model used by a reasoning function.');
  });

  it('lists the terms of a capability under its own heading only where the server runs its function type', () => {
    const interacting = terminologyGuideOf(page, ['interaction function', 'workflow']).text;
    const notInteracting = terminologyGuideOf(page, ['workflow']).text;

    expect(interacting).toContain(theRequestTerm);
    expect(notInteracting).not.toContain('Interaction:');
    expect(notInteracting).not.toContain('- Inbox:');
  });

  it('is stripped of the markup and links of the page', () => {
    const { text } = terminologyGuideOf(page, ['reasoning function', 'workflow']);

    expect([...text.matchAll(/\*\*|`|\]\(|\|/gu)]).toEqual([]);
  });

  it('leaves out every term that names a function type the server does not run', () => {
    const { text } = terminologyGuideOf(page, ['workflow']);

    expect(text).not.toContain('Language model');
    expect(text).not.toContain('Predictive model');
    expect(text).toContain('- Run: A workflow or function carried out once against particular inputs.');
  });

  it('cannot be made from a page without the tables it reads', () => {
    expect(() => terminologyGuideOf('# Playbook terminology\n\nNo tables yet.\n', [])).toThrow(
      'The terminology page has no table of capabilities',
    );
  });
});
