import { Conflict, Unavailable, type PlaybookContext, type PlaybookReader } from '@on.auto/operations';
import type { Payload } from '@on.auto/operations/payloads';
import { capitalized } from '@on.auto/phrasing';
import { Effect } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { DefinitionTexts, TextName, TextsAsRecorded } from '../payloads/definition-texts.ts';
import { textRead, textsRead, type DefinitionTextUnread } from '../payloads/kept-texts.ts';

export type Change = 'created' | 'saved' | 'paused' | 'resumed' | 'retired' | 'restored';

interface VersionNamed {
  readonly name: string;
  readonly version: number;
}

type Unread = Pick<DefinitionTextUnread, 'name' | 'because'>;

type Refused = Unavailable | Conflict;

type ReadInTheCall<A> = Effect.Effect<A, Refused, PlaybookReader | PlaybookContext>;

const textWords: Readonly<Record<TextName, string>> = { source: 'document', overview: 'overview', diagram: 'diagram' };

const lostWords = { missing: "is missing from the playbook's content", erased: 'was erased' } as const;

function versionCalled({ version }: VersionNamed): string {
  return `version ${version}`;
}

export function refusedToRunFor(type: string, named: VersionNamed) {
  const { name } = named;
  return ({ because }: Unread): Refused => {
    const label = definitionResourceLabel(type);
    return because === 'unavailable'
      ? new Unavailable({
          detail: `The document of the ${label} ${name}, which the playbook keeps outside its record, could not be read just now, so no run started; ask again in a moment`,
          kind: 'content_unavailable',
        })
      : new Conflict({
          detail: `The ${label} ${name} at ${versionCalled(named)} cannot run: its document ${lostWords[because]}; update it`,
          kind: 'unworkable',
        });
  };
}

function unreadNow(label: string, name: string, text: string, change: Change | undefined): Unavailable {
  return new Unavailable({
    kind: 'content_unavailable',
    detail:
      change === undefined
        ? `The ${text} of the ${label} ${name}, which the playbook keeps outside its record, could not be read just now; ask again in a moment`
        : `The ${label} ${name} was ${change}, but its ${text}, which the playbook keeps outside its record, could not be read just now to answer with it; get_definition reads it again in a moment`,
  });
}

interface LostText extends VersionNamed {
  readonly label: string;
  readonly text: string;
  readonly because: keyof typeof lostWords;
}

function lost({ label, text, because, ...named }: LostText): string {
  return `the ${text} of ${versionCalled(named)} of the ${label} ${named.name} ${lostWords[because]}; update_definition saves the ${label} again with one`;
}

export function refusedToAnswerFor(type: string, named: VersionNamed, change?: Change) {
  return ({ name: text, because }: Unread): Refused => {
    const label = definitionResourceLabel(type);
    if (because === 'unavailable') {
      return unreadNow(label, named.name, textWords[text], change);
    }
    const why = lost({ ...named, label, text: textWords[text], because });
    return new Conflict({
      detail: change === undefined ? capitalized(why) : `The ${label} ${named.name} was ${change}, but ${why}`,
      kind: 'unworkable',
    });
  };
}

export function documentToRun(
  type: string,
  version: VersionNamed & { readonly source: Payload<string> },
): ReadInTheCall<string> {
  return textRead('source', version.source).pipe(Effect.mapError(refusedToRunFor(type, version)));
}

export function textsToAnswer(
  type: string,
  stored: VersionNamed & TextsAsRecorded,
  change?: Change,
): ReadInTheCall<DefinitionTexts<string>> {
  return textsRead(stored).pipe(Effect.mapError(refusedToAnswerFor(type, stored, change)));
}
