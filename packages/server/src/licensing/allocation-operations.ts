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
      'Gives this runtime the offline credits an operator of Auto signed for it, for a runtime that does not reach Auto: credits it spends where Auto cannot see, until the date Auto signed into them, 30 days after they were issued or last refreshed, or 90 under an Enterprise order.',
      'From then on the runtime starts each new run against those credits itself, asking Auto nothing, until they are spent or their date has passed.',
      'It answers the allocation, its credits, what was spent of them and when it must be refreshed by; one not signed by Auto, for another runtime or past its date is refused as a conflict of the kind license_invalid.',
    ].join(' '),
    route: { method: 'POST', path: '/license/allocation' },
    body: { kind: 'json' },
    permittedBy: ['org:write'],
    inputSchema: AllocationGivenSchema,
    outputSchema: AllocationSchema,
    reasons: ['invalid_input', 'conflict', 'unavailable'],
    handle: ({ allocation }) => license.allocate(allocation),
  });
}

export function defineReportAllocation(license: Pick<LicensePorts, 'allocationReport'>) {
  return defineHttpOperation('org', 'command', {
    name: 'report_allocation',
    title: 'Report allocation',
    description: [
      'Makes the next report of what this runtime spent of its offline credits, numbered one after the last and counted in all from the runs it started on them, signed with its key.',
      'An owner of its org uploads it in Studio for a runtime that does not reach Auto; one that reaches Auto sends its report every hour itself.',
      'A runtime with no offline credits, or with no key to sign with, is refused as a conflict.',
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
    outputSchema: ReportSchema,
    reasons: ['conflict', 'unavailable'],
    handle: ({ allocation }) => license.allocationReport(allocation),
  });
}
