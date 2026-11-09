import { IssueSchema, type RejectedCall } from '@on.auto/operations';
import { Schema } from 'effect';

export const AdmissionRefusalSchema = Schema.Struct({
  reason: Schema.String,
  detail: Schema.String,
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  resolve_at: Schema.optionalKey(Schema.String),
  lifts_at: Schema.optionalKey(Schema.String),
  limited_because: Schema.optionalKey(Schema.String),
});

export type AdmissionRefusal = typeof AdmissionRefusalSchema.Type;

export function admissionRefusalOf(refusal: RejectedCall): AdmissionRefusal {
  const { reason, detail, kind, because, issues, resolve_at: resolveAt } = refusal;
  const { lifts_at: liftsAt, limited_because: limitedBecause } = refusal;
  return {
    reason,
    detail,
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
    ...(issues === undefined ? {} : { issues }),
    ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
    ...(liftsAt === undefined ? {} : { lifts_at: liftsAt }),
    ...(limitedBecause === undefined ? {} : { limited_because: limitedBecause }),
  };
}
