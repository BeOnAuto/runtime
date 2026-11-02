import { describe, expect, it } from 'vitest';

import { addressOfTarget, commentTargetOf, listedTargetOf, type ListedTarget } from './comment-addresses.ts';

const run = '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e';

const event = '019a4012-7c41-7e22-8a10-1b2c3d4e5f60';

const forms: readonly (readonly [string, ListedTarget])[] = [
  ['playbooks/finance', { kind: 'playbook', playbook: 'finance' }],
  [
    'finance/definitions/reasoning/categorize-invoice/7',
    { kind: 'definition', playbook: 'finance', type: 'reasoning', name: 'categorize-invoice', version: 7 },
  ],
  [
    'finance/definitions/page/weekly-close/1',
    { kind: 'definition', playbook: 'finance', type: 'page', name: 'weekly-close', version: 1 },
  ],
  [
    'finance/definitions/workflow/close-the-week/4/steps/do/1/review',
    {
      kind: 'step',
      playbook: 'finance',
      type: 'workflow',
      name: 'close-the-week',
      version: 4,
      step: 'do/1/review',
    },
  ],
  [`finance/runs/${run}`, { kind: 'run', playbook: 'finance', run }],
  [`finance/runs/${run}/events/${event}`, { kind: 'event', playbook: 'finance', run, event }],
  [`finance/runs/${run}/events/${event}_2`, { kind: 'event', playbook: 'finance', run, event: `${event}_2` }],
  [`finance/runs/${run}/result/2`, { kind: 'block', playbook: 'finance', run, block: 2 }],
  [`finance/${run}`, { kind: 'request', playbook: 'finance', run }],
  [`playbooks/${run}`, { kind: 'request', playbook: 'playbooks', run }],
];

describe('the address of what a comment is about', () => {
  it('reads every form a comment takes, and is written back as it was read', () => {
    expect(forms.map(([address]) => commentTargetOf(address))).toEqual(forms.map(([, target]) => target));
    expect(forms.map(([, target]) => addressOfTarget(target))).toEqual(forms.map(([address]) => address));
  });

  it('reads a definition without its version only where a list asks for every version', () => {
    const everyVersion: ListedTarget = {
      kind: 'every_version',
      playbook: 'finance',
      type: 'workflow',
      name: 'close-the-week',
    };

    expect(listedTargetOf('finance/definitions/workflow/close-the-week')).toEqual(everyVersion);
    expect(addressOfTarget(everyVersion)).toBe('finance/definitions/workflow/close-the-week');
    expect(commentTargetOf('finance/definitions/workflow/close-the-week')).toBeUndefined();
  });

  it('runs a step to the end of the address, within the 256 bytes of a reference', () => {
    const longest = `do/${'a'.repeat(252)}`;

    expect(commentTargetOf(`finance/definitions/workflow/close-the-week/4/steps/${longest}`)).toMatchObject({
      step: longest,
    });
    expect(commentTargetOf(`finance/definitions/workflow/close-the-week/4/steps/${longest}a`)).toBeUndefined();
  });
});

describe('an address a comment does not take', () => {
  it('is one with an empty part, white space, a forbidden character, a slash at its end or over 512 characters', () => {
    expect(
      [
        'finance//runs',
        `finance/runs/${run}/`,
        'playbooks/fin ance',
        'playbooks/finance\u0000',
        `finance/definitions/workflow/close-the-week/4/steps/${'do/1/'.repeat(100)}x`,
      ].filter((address) => commentTargetOf(address) !== undefined),
    ).toEqual([]);
  });

  it('is one whose playbook, type, name, version, step, run, event or block does not hold to its rule', () => {
    expect(
      [
        'playbooks/Finance',
        'playbooks/finance/extra',
        'Finance/definitions/reasoning/categorize-invoice/7',
        'finance/definitions/function/categorize-invoice/7',
        'finance/definitions/reasoning/Categorize/7',
        'finance/definitions/reasoning/categorize-invoice/07',
        'finance/definitions/reasoning/categorize-invoice/7/steps/do',
        'finance/definitions/workflow/close-the-week/4/stages/do',
        'finance/definitions/workflow/close-the-week/4/steps',
        'finance/runs/not-a-run',
        `finance/runs/${run.toUpperCase()}`,
        `finance/runs/${run}/events/${event}_0`,
        `finance/runs/${run}/events/x`,
        `finance/runs/${run}/result/0`,
        `finance/runs/${run}/output/1`,
        `finance/runs/${run}/result/1/more`,
        `Finance/${run}`,
        'finance/comments/019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f',
        'finance/reasoning/categorize-invoice',
        'finance',
      ].filter((address) => listedTargetOf(address) !== undefined),
    ).toEqual([]);
  });
});
