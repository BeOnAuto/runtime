import { Data } from 'effect';

export class ModelNotAllowed extends Data.TaggedError('model_not_allowed')<{
  readonly detail: string;
  readonly provider: string;
}> {}
