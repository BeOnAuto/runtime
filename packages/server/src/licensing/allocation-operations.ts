import { SignedSchema, type LicensePorts } from '@on.auto/meter';
import { defineHttpOperation } from '@on.auto/operations';
import { Schema } from 'effect';

const AllocationGivenSchema = Schema.Struct({
  allocation: SignedSchema.annotate({
    description: 'The allocation an operator of Auto signed for this installation: its payload, signature and kid',
  }),
});

const AllocationSchema = Schema.Struct({
  allocation: Schema.String,
  installation: Schema.String,
  credits: Schema.Number,
  spent: Schema.Number,
  refresh_by: Schema.String,
});

const ReportSchema = Schema.Struct({
  report: Schema.Struct({
    allocation: Schema.String,
    installation: Schema.String,
    sequence: Schema.Number,
    spent: Schema.Number,
    at: Schema.String,
  }),
  signature: Schema.String,
});

export function defineActivateAllocation(license: Pick<LicensePorts, 'allocate'>) {
  return defineHttpOperation('org', 'command', {
    name: 'activate_allocation',
    title: 'Activate allocation',
    description: [
      'Gives this runtime the allocation an operator of Auto signed for its installation, for an installation that does not reach Auto: credits it spends where Auto cannot see, with seven days of grace since it was last refreshed.',
      'From then on the runtime admits each new action against the allocation itself, asking Auto nothing, until its credits are spent or its grace has passed.',
      'It answers the allocation, its credits, what was spent of them and when it must be refreshed by; one not signed by Auto, for another installation or past its grace is refused as a conflict of the kind license_invalid.',
    ].join(' '),
    route: { method: 'POST', path: '/license/allocation' },
    body: { kind: 'json' },
    permittedBy: ['org:write'],
    inputSchema: AllocationGivenSchema,
    answer: { kind: 'json', outputSchema: AllocationSchema },
    reasons: ['invalid_input', 'conflict', 'unavailable'],
    handle: ({ allocation }) => license.allocate(allocation),
  });
}

export function defineReportAllocation(license: Pick<LicensePorts, 'allocationReport'>) {
  return defineHttpOperation('org', 'command', {
    name: 'report_allocation',
    title: 'Report allocation',
    description: [
      'Makes the next report of what this runtime spent of its allocation, numbered one after the last and counted in all from its ledger, signed with the key of its installation.',
      'An owner of its org uploads it in Studio for an installation that does not reach Auto; one that reaches Auto sends its report every hour itself.',
      'A runtime with no allocation, or with no key to sign with, is refused as a conflict.',
    ].join(' '),
    route: { method: 'POST', path: '/license/allocation/report' },
    body: { kind: 'json' },
    permittedBy: ['org:write'],
    inputSchema: Schema.Struct({
      allocation: Schema.optionalKey(
        Schema.String.annotate({
          description:
            'The allocation the report is of, which must be the one the runtime holds; that one when left out',
        }),
      ),
    }),
    answer: { kind: 'json', outputSchema: ReportSchema },
    reasons: ['conflict', 'unavailable'],
    handle: ({ allocation }) => license.allocationReport(allocation),
  });
}
