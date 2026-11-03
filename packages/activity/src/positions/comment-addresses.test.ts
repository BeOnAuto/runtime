import { describe, expect, it } from 'vitest';

import {
  addressOfTarget,
  commentTargetOf,
  isPart,
  listedTargetOf,
  playbookOfTarget,
  thingAddressOf,
  type ListedTarget,
} from './comment-addresses.ts';

const run = '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e';

const event = '019a4012-7c41-7e22-8a10-1b2c3d4e5f60';

const connection = '019a3f10-2b4c-7d5e-8f60-718293a4b5c6';

const forms: readonly (readonly [string, ListedTarget])[] = [
  ['playbooks/finance', { kind: 'playbook', playbook: 'finance' }],
  [
    'finance/definitions/reasoning/categorize-invoice/7',
    { kind: 'definition', playbook: 'finance', type: 'reasoning', name: 'categorize-invoice', version: 7 },
  ],
  [
    'finance/definitions/memory/vendor-terms/2147483646',
    { kind: 'definition', playbook: 'finance', type: 'memory', name: 'vendor-terms', version: 2_147_483_646 },
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
  ['playbooks/finance/parts/ledger', { kind: 'playbook', playbook: 'finance', part: 'ledger' }],
  ['playbooks/finance/parts/runs-2', { kind: 'playbook', playbook: 'finance', part: 'runs-2' }],
  [
    'finance/definitions/reasoning/categorize-invoice/7/parts/source',
    {
      kind: 'definition',
      playbook: 'finance',
      type: 'reasoning',
      name: 'categorize-invoice',
      version: 7,
      part: 'source',
    },
  ],
  [`finance/runs/${run}/parts/output`, { kind: 'run', playbook: 'finance', run, part: 'output' }],
];

const ofTheOrg: readonly (readonly [string, ListedTarget])[] = [
  ['org', { kind: 'org' }],
  ['org/parts/playbooks', { kind: 'org', part: 'playbooks' }],
  [`org/connections/${connection}`, { kind: 'connection', connection }],
  [`org/connections/${connection}/parts/tools`, { kind: 'connection', connection, part: 'tools' }],
  ['org/members/user_2kLm7Qx', { kind: 'member', member: 'user_2kLm7Qx' }],
  ['org/members/user_2kLm7Qx/parts/role', { kind: 'member', member: 'user_2kLm7Qx', part: 'role' }],
  ['org/settings/billing', { kind: 'settings', page: 'billing' }],
  ['org/settings/runtime/parts/license', { kind: 'settings', page: 'runtime', part: 'license' }],
];

const notOfItsRule = [
  'finance/definitions/page/weekly-close/1',
  'playbooks/Finance',
  'playbooks/finance/extra',
  'Finance/definitions/reasoning/categorize-invoice/7',
  'finance/definitions/function/categorize-invoice/7',
  'finance/definitions/reasoning/Categorize/7',
  'finance/definitions/reasoning/categorize-invoice/07',
  'finance/definitions/reasoning/categorize-invoice/2147483647',
  'finance/definitions/reasoning/categorize-invoice/0123456789',
  'finance/definitions/recall/categorize-invoice/7',
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
  'playbooks/finance/parts',
  'playbooks/finance/parts/Ledger',
  'playbooks/finance/parts/1ledger',
  `playbooks/finance/parts/${'a'.repeat(65)}`,
  'playbooks/finance/parts/ledger/more',
  'playbooks/finance/sections/ledger',
  'finance/definitions/reasoning/categorize-invoice/7/views/source',
  'finance/definitions/reasoning/categorize-invoice/parts/source',
  `finance/runs/${run}/parts`,
  `finance/runs/${run}/events/${event}/parts/output`,
  `finance/runs/${run}/result/2/parts/output`,
  `finance/${run}/parts/output`,
];

const notOfTheOrgsRule = [
  'org/parts',
  'org/parts/Ledger',
  'org/parts/ledger/more',
  'org/connections',
  'org/connections/not-a-connection',
  `org/connections/${connection.toUpperCase()}`,
  `org/connections/${connection}/tools`,
  'org/members',
  `org/members/${'m'.repeat(65)}`,
  'org/members/user.2kLm7Qx',
  'org/settings',
  'org/settings/Billing',
  'org/settings/billing/parts',
  'org/settings/billing/cards/plan',
  'org/comments/019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f',
  'org/playbooks',
];

describe('the address of what a comment is about', () => {
  it('reads every form a comment takes, and is written back as it was read', () => {
    expect(forms.map(([address]) => commentTargetOf(address))).toEqual(forms.map(([, target]) => target));
    expect(forms.map(([, target]) => addressOfTarget(target))).toEqual(forms.map(([address]) => address));
  });
});

describe('the address of a thing of the organization, or of a part', () => {
  it('reads every thing of the organization a comment takes, and its parts, and writes them back', () => {
    expect(ofTheOrg.map(([address]) => commentTargetOf(address))).toEqual(ofTheOrg.map(([, target]) => target));
    expect(ofTheOrg.map(([, target]) => addressOfTarget(target))).toEqual(ofTheOrg.map(([address]) => address));
    expect(ofTheOrg.filter(([, target]) => playbookOfTarget(target) !== undefined)).toEqual([]);
  });

  it('names the thing a part is of, and a thing that is no part by its own address', () => {
    const parts = [...forms, ...ofTheOrg].filter(([, target]) => isPart(target));
    const things = forms.filter(([, target]) => !isPart(target));

    expect(parts.map(([, target]) => thingAddressOf(target))).toEqual([
      'playbooks/finance',
      'playbooks/finance',
      'finance/definitions/reasoning/categorize-invoice/7',
      `finance/runs/${run}`,
      'org',
      `org/connections/${connection}`,
      'org/members/user_2kLm7Qx',
      'org/settings/runtime',
    ]);
    expect(things.map(([, target]) => thingAddressOf(target))).toEqual(things.map(([address]) => address));
  });
});

describe('the address of a step, a definition without its version and a playbook named org', () => {
  it('keeps the addresses of a playbook named org, beside the things of the organization', () => {
    expect(
      [`org/${run}`, 'org/definitions/reasoning/categorize-invoice/7', `org/runs/${run}`].map((address) =>
        commentTargetOf(address),
      ),
    ).toEqual([
      { kind: 'request', playbook: 'org', run },
      { kind: 'definition', playbook: 'org', type: 'reasoning', name: 'categorize-invoice', version: 7 },
      { kind: 'run', playbook: 'org', run },
    ]);
    expect(playbookOfTarget({ kind: 'run', playbook: 'org', run })).toBe('org');
  });

  it('reads a part after a step as part of the step', () => {
    expect(commentTargetOf('finance/definitions/workflow/close-the-week/4/steps/do/1/review/parts/source')).toEqual({
      kind: 'step',
      playbook: 'finance',
      type: 'workflow',
      name: 'close-the-week',
      version: 4,
      step: 'do/1/review/parts/source',
    });
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
    expect(notOfItsRule.filter((address) => listedTargetOf(address) !== undefined)).toEqual([]);
  });

  it('is one of the organization whose connection, member, page or part does not hold to its rule', () => {
    expect(notOfTheOrgsRule.filter((address) => listedTargetOf(address) !== undefined)).toEqual([]);
  });
});
