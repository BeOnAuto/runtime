import { admittedOnTheThirdTry, neverAdmittingTally, todaysFreeCreditsUsed } from './input-log-answers.ts';
import type { InputLogPath } from './input-log-path.ts';

export const admissionPaths: readonly InputLogPath[] = [
  {
    name: 'admission-wait',
    source: `
do:
  - first: { call: run_definition, with: { type: reasoning, name: summarize, input: { text: hello } } }
  - second: { call: run_definition, with: { type: reasoning, name: tally } }
`,
    ends: { kind: 'completed', output: { summary: 'tally of {}' } },
    answer: admittedOnTheThirdTry,
  },
  {
    name: 'admission-timeout',
    source: `
do:
  - first: { call: run_definition, with: { type: reasoning, name: summarize, input: { text: hello } } }
  - second: { call: run_definition, with: { type: reasoning, name: tally }, timeout: { after: PT10M } }
`,
    ends: {
      kind: 'raised',
      error: {
        type: 'https://on.auto/problems/credits_exhausted',
        status: 409,
        instance: '/do/1/second',
        title: 'The reasoning function tally could not go through',
        detail: todaysFreeCreditsUsed,
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
        cause: { status: 'rejected', reason: 'conflict', kind: 'credits_exhausted', because: 'free_daily_limit' },
      },
    },
    answer: neverAdmittingTally,
  },
];
