import { LedgerChores, type HeldContentFound, type LedgerServices } from '@on.auto/ledger';
import { Context, Data, Effect, Layer } from 'effect';

import { contentPlaceOf } from '../settings/content-place.ts';
import type { ContentSettings } from '../settings/content-settings.ts';
import { whereTheLedgerIsKept } from '../settings/ledger-settings.ts';
import type { Settings } from '../settings/settings.ts';
import { messageOf, type LedgerRemedy } from './ledger-remedies.ts';

const heldContentLookedFor = 16;

type ContentPlaces = Pick<Settings, 'ledger' | 'content'>;

export class LedgerOfContentNotFound extends Data.TaggedError('LedgerOfContentNotFound')<
  HeldContentFound & { readonly happened: string; readonly remedy: LedgerRemedy; readonly message: string }
> {}

const notMoved = 'Auto Runtime does not move content from one store to another.';

function theOtherPlaceTo(content: ContentSettings): string {
  return content.store === 'ledger' ? 'on object storage' : "in the ledger's database";
}

function ofThoseLookedFor(count: number, checked: number): string {
  return `${count} of the ${checked} it looked for ${count === 1 ? 'is' : 'are'}`;
}

function whatWasFound(content: ContentSettings, { checked, keptElsewhere, missing }: HeldContentFound): string {
  return [
    ...(keptElsewhere === 0 ? [] : [`${ofThoseLookedFor(keptElsewhere, checked)} kept ${theOtherPlaceTo(content)}`]),
    ...(missing === 0 ? [] : [`${ofThoseLookedFor(missing, checked)} not there`]),
  ].join(', and ');
}

function whereContentIsKept(content: ContentSettings): string {
  return content.store === 'ledger'
    ? `${contentPlaceOf(content)}, since CONTENT_STORE_URL is not set`
    : `${contentPlaceOf(content)}, which CONTENT_STORE_URL names`;
}

const settingTheBucketBack: LedgerRemedy = {
  says: `Set CONTENT_STORE_URL, and the endpoint, region and credentials of its bucket, as they were when that content was kept, then start Auto Runtime again. ${notMoved}`,
  command: undefined,
};

const removingTheBucket: LedgerRemedy = {
  says: `Remove CONTENT_STORE_URL, as it was when that content was kept in the ledger's database, then start Auto Runtime again. ${notMoved}`,
  command: undefined,
};

const namingTheBucketThatKeepsIt: LedgerRemedy = {
  says: 'Set CONTENT_STORE_URL, and the endpoint, region and credentials of its bucket, to the bucket and prefix that keep that content, or restore the bucket from a backup taken at the same time as the ledger, then start Auto Runtime again.',
  command: undefined,
};

const restoringTheLedger: LedgerRemedy = {
  says: "Restore the ledger's database from a backup that holds its records and their content together, then start Auto Runtime again.",
  command: undefined,
};

function remedyFor(content: ContentSettings, { keptElsewhere }: HeldContentFound): LedgerRemedy {
  if (content.store === 'ledger') {
    return keptElsewhere > 0 ? settingTheBucketBack : restoringTheLedger;
  }
  return keptElsewhere > 0 ? removingTheBucket : namingTheBucketThatKeepsIt;
}

export function ledgerOfContentNotFound(
  found: HeldContentFound,
  { ledger, content }: ContentPlaces,
): LedgerOfContentNotFound {
  const happened = `${whereTheLedgerIsKept(ledger)}, and its records name content this server cannot find. Content is kept ${whereContentIsKept(content)}, but ${whatWasFound(content, found)}.`;
  const remedy = remedyFor(content, found);
  return new LedgerOfContentNotFound({ ...found, happened, remedy, message: messageOf(happened, remedy) });
}

function isEveryContentFound({ keptElsewhere, missing }: HeldContentFound): boolean {
  return keptElsewhere === 0 && missing === 0;
}

function unreachableAs(unreachableBy: ((failure: unknown) => Error) | undefined, failure: unknown): unknown {
  return unreachableBy === undefined ? failure : unreachableBy(failure);
}

export function withItsContentFound(
  ledgerLayer: Layer.Layer<LedgerServices>,
  places: ContentPlaces,
  unreachableBy?: (failure: unknown) => Error,
): Layer.Layer<LedgerServices> {
  return Layer.tap(ledgerLayer, (context) =>
    Context.get(context, LedgerChores)
      .heldContentFound(heldContentLookedFor)
      .pipe(
        Effect.catchTag('held_content_unchecked', ({ failure }: { readonly failure: unknown }) =>
          Effect.die(unreachableAs(unreachableBy, failure)),
        ),
        Effect.flatMap((found) =>
          isEveryContentFound(found) ? Effect.void : Effect.die(ledgerOfContentNotFound(found, places)),
        ),
      ),
  );
}
