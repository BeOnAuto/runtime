import { Schema } from 'effect';

const sha256Hex = /^[0-9a-f]{64}$/u;

const UsageFields = {
  actions: Schema.Number,
  last: Schema.NullOr(Schema.String),
};

export const UsageRequestSchema = Schema.Struct(UsageFields);

export const ActivationRequestSchema = Schema.Struct({ installation: Schema.String, ...UsageFields });

export const AdmissionRequestSchema = Schema.Struct({
  action: Schema.String.check(Schema.isPattern(sha256Hex)),
});

export const AllocationRefreshRequestSchema = Schema.Struct({ allocation: Schema.String });

export const AllocationReportRequestSchema = Schema.Struct({
  report: Schema.Struct({
    allocation: Schema.String,
    installation: Schema.String,
    sequence: Schema.Number,
    spent: Schema.Number,
    at: Schema.String,
  }),
  signature: Schema.String,
});
