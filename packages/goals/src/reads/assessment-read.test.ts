import { describe, expect, it } from 'vitest';

import { unopened, type PinnedRule } from '../assessments/assessment-state.ts';
import { assessmentStateText } from '../goal-tables/assessment-row-state.ts';
import { heldAssessmentsOf, instantIn } from './assessment-read.ts';

const pinned: PinnedRule = {
  goal: 'first-sale',
  goalsVersion: 2,
  settles: 'on_crossing',
  target: { at_least: 1 },
  milestones: [],
};

describe('an assessment row as the goals read holds it', () => {
  it('is nothing when its state was never opened or cannot be read', () => {
    expect(heldAssessmentsOf({ org: 'acme', key: 'a', row: { state: assessmentStateText(unopened) } })).toEqual([]);
    expect(heldAssessmentsOf({ org: 'acme', key: 'a', row: { state: 'not a state' } })).toEqual([]);
  });

  it('has no notices when its notices cannot be read', () => {
    const row = { state: assessmentStateText({ ...unopened, pinned }), notices: null };

    expect(heldAssessmentsOf({ org: 'acme', key: 'a', row })).toEqual([
      { id: 'a', state: { ...unopened, pinned }, pinned, notices: [] },
    ]);
  });

  it('reads an instant from a column, or the given one where the column holds none', () => {
    expect(instantIn({ org: 'acme', key: 'a', row: { at: 5 } }, 'at', 0)).toBe(5);
    expect(instantIn({ org: 'acme', key: 'a', row: { at: null } }, 'at', 0)).toBe(0);
  });
});
