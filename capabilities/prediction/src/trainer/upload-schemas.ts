import { RunIdInputField } from '@on.auto/definitions';
import { CandidateSignatureSchema } from '@on.auto/prediction-contract';
import { Schema } from 'effect';

export const UploadedSchema = Schema.Struct({
  candidate: Schema.String.annotate({ description: 'The SHA-256 of the candidate, which the answer names' }),
  bytes: Schema.Int,
  format: Schema.String.annotate({ description: 'The format of the candidate, as the upload named it' }),
  signature: CandidateSignatureSchema.annotate({
    description: 'The signature of the candidate as the model runtime of its format answered it',
  }),
});

export const UploadInput = Schema.Struct({
  run_id: RunIdInputField,
  format: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The format of the candidate, one the brief of the build lists; the one format it lists when it lists one',
    }),
  ),
});
