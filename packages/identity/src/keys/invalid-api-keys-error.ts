import { Data } from 'effect';

export class InvalidApiKeysError extends Data.TaggedError('InvalidApiKeysError')<{ readonly message: string }> {}
