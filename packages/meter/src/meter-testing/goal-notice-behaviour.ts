import { expect, it } from 'vitest';

import { runOf } from '../testing/runs.ts';
import { opened, runsNamed, admittedEach, type LedgerOf } from './opened.ts';

const small = { allowance: 1, freeRate: { per_day: 1, per_month: 2 } };

const noticeOf = (run: string, given: object = {}) => ({
  ...runOf(run),
  definition_type: 'interaction',
  trigger: { kind: 'goal' as const, reference: 'goals/quality/assessments/a1' },
  ...given,
});

export function goalNoticeBehaviour(ledgerOf: LedgerOf): void {
  it('admits a goal notice past the free limit without counting it', async () => {
    const { metered } = await opened(ledgerOf, small);
    await admittedEach(metered, runsNamed('run', 3));
    const refused = await metered.admitted(runOf('run-3'));
    const before = (await metered.state()).admitted;
    const answers = await Promise.all(runsNamed('notice', 4).map((run) => metered.admitted(noticeOf(run))));
    const after = (await metered.state()).admitted;

    expect(refused.kind).toBe('license_required');
    expect(answers.map(({ kind }) => kind)).toEqual(['admitted', 'admitted', 'admitted', 'admitted']);
    expect(after).toEqual(before);
  });

  it('counts a goal run that another run called, or that is no notification function, as any run', async () => {
    const { metered } = await opened(ledgerOf, small);
    await admittedEach(metered, runsNamed('run', 3));
    const called = await metered.admitted(noticeOf('called', { called_by: 'run-0' }));
    const computed = await metered.admitted(noticeOf('computed', { definition_type: 'computation' }));

    expect(called.kind).toBe('license_required');
    expect(computed.kind).toBe('license_required');
  });
}
