import type { KeptSecrets } from '@on.auto/openid-connect/authorization-server';
import { Data } from 'effect';

import type { ConversationRow } from '../tables/chat-rows.ts';

export class ConversationKeyMissing extends Data.TaggedError('conversation_key_missing')<{
  readonly conversation: string;
  readonly message: string;
}> {}

function once<A>(made: () => Promise<A>): () => Promise<A> {
  const kept: { promise?: Promise<A> } = {};
  return () => {
    kept.promise ??= made();
    return kept.promise;
  };
}

export function keyOnceOf(keys: KeptSecrets, { id, keyId }: ConversationRow): () => Promise<string> {
  return once(async () => {
    const key = await keys.read(keyId);
    if (key === undefined) {
      throw new ConversationKeyMissing({
        conversation: id,
        message: `The key of the conversation ${id} is not in the secret store`,
      });
    }
    return key;
  });
}
