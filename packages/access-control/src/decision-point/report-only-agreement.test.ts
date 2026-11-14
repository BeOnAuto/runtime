import { describe, expect, it } from 'vitest';

import { editorRoleForEveryPerson } from '../roles/role-assignments.ts';
import {
  askedInReportOnly,
  calls,
  countedByReason,
  decisionPointOver,
} from '../testing/report-only-agreement-calls.ts';
import { loadedMessage } from './cedar-decision-point.ts';

describe('the decision point in report-only mode, with the built-in policies and every person taken as an Editor', () => {
  it('decides every call as the check that decides it today, so the dispatcher logs no difference and answers as it did', async () => {
    const { today, reported, asked, logged } = await askedInReportOnly(
      calls,
      decisionPointOver(editorRoleForEveryPerson),
    );

    expect(calls.length).toBe(11 * (5 * 2 * 4 + 3 * 3));
    expect(reported).toEqual(today);
    expect(countedByReason(today)).toEqual({
      succeeded: 89,
      'rejected invalid_input': 61,
      'rejected forbidden': 389,
    });
    expect(asked).toBe(calls.length);
    expect(logged).toEqual([loadedMessage]);
  });
});
