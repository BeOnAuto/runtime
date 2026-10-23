import type { ContentStore } from '@on.auto/operations';
import { awsCredentialChainOf } from '@on.auto/outbound';
import { Effect } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { commandSpansIn, commandSpanStep } from '../telemetry/object-commands.ts';

export type ContentStoreSettings = Pick<Settings, 'content' | 'proxy'>;

export interface ComposedContentStore {
  readonly store: ContentStore;
  readonly reached: Effect.Effect<void>;
}

function hostOf(endpoint: string | undefined): string {
  return endpoint === undefined ? 'the S3 endpoint of its region' : new URL(endpoint).host;
}

export function contentStoreOf({
  content,
  proxy,
}: ContentStoreSettings): Effect.Effect<ComposedContentStore> | undefined {
  if (content.store === 'ledger') {
    return undefined;
  }
  const { endpoint, region, location } = content;
  const unreachable = (answer: string) =>
    new Error(
      `CONTENT_STORE_URL names the bucket ${location.bucket} on ${hostOf(endpoint)}, which could not be reached: ${answer}`,
    );
  return Effect.gen(function* () {
    const [{ bucketOnS3, objectContentOn, objectStoreReached, storageClientOf }, credentials] = yield* Effect.promise(
      () => Promise.all([import('@on.auto/object-storage'), awsCredentialChainOf(proxy)]),
    );
    const client = storageClientOf({ endpoint, region, proxy }, credentials);
    client.middlewareStack.add(commandSpansIn(location.bucket), commandSpanStep);
    const composed: ComposedContentStore = {
      store: objectContentOn(bucketOnS3({ client: () => client, name: location.bucket }), location),
      reached: objectStoreReached(() => client, location).pipe(
        Effect.catchTag('object_store_unreachable', ({ answer }: { readonly answer: string }) =>
          Effect.die(unreachable(answer)),
        ),
      ),
    };
    return composed;
  });
}
