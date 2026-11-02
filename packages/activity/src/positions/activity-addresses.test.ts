import { describe, expect, it } from 'vitest';

import {
  addressOf,
  type ActivityItem,
  brokenKeyOf,
  itemOfAddress,
  playbookChangeKeyOf,
  positionOfItem,
  requestKeyOf,
  resultKeyOf,
  versionKeyOf,
} from './activity-addresses.ts';

const runId = '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e';

describe('the address of an item of the activity', () => {
  it('is the playbook and the key of its row, or the register of playbooks for a playbook changed', () => {
    const items: readonly ActivityItem[] = [
      { form: 'request', playbook: 'finance', key: requestKeyOf(runId) },
      { form: 'broken', playbook: 'finance', key: brokenKeyOf('reasoning', 'categorize-invoice') },
      { form: 'result', playbook: 'finance', key: resultKeyOf(runId) },
      { form: 'version', playbook: 'finance', key: versionKeyOf('workflow', 'close-the-week', 4) },
      { form: 'playbook', playbook: 'finance', key: playbookChangeKeyOf(1_793_552_561_512) },
    ];

    expect(items.map((item) => addressOf(item))).toEqual([
      `finance/${runId}`,
      'finance/reasoning/categorize-invoice',
      `finance/runs/${runId}`,
      'finance/definitions/workflow/close-the-week/4',
      'playbooks/finance/1793552561512',
    ]);
    expect(items.map((item) => itemOfAddress(addressOf(item)))).toEqual(items);
  });

  it('is of none of the forms when a segment is wrong, missing or one too many', () => {
    const malformed = [
      '',
      'finance',
      'Finance/reasoning/categorize-invoice',
      `finance/${runId.toUpperCase()}`,
      `finance/${runId}/request`,
      `finance/runs/${runId}/more`,
      'finance/runs/not-a-run',
      'finance/reasoning/Categorize',
      'finance/reasoning/categorize-invoice/more',
      'finance/definitions/workflow/close-the-week/0',
      'finance/definitions/workflow/close-the-week/4/more',
      'finance/definitions/workflow/close-the-week',
      'playbooks/finance/01',
      'playbooks/finance/1793552561512/more',
      'playbooks/Finance/1793552561512',
    ];

    expect(malformed.filter((address) => itemOfAddress(address) !== undefined)).toEqual([]);
  });

  it('places an item at its time, playbook and key', () => {
    expect(positionOfItem({ form: 'result', playbook: 'finance', key: resultKeyOf(runId) }, 5)).toEqual({
      at: 5,
      playbook: 'finance',
      key: `runs/${runId}`,
    });
  });
});
