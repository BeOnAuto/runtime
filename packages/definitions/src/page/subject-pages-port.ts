import type {
  Caller,
  Conflict,
  InvalidInput,
  PlaybookContext,
  PlaybookReader,
  PlaybookWriter,
  Unavailable,
} from '@on.auto/operations';
import type { Effect, Schema } from 'effect';

import type { PayloadAsRead } from '../payloads/run-payloads.ts';
import type { RunDetailAsRecorded } from '../runs/run.ts';
import type { PageContent, PageStanding, SubjectPage } from './page-facts.ts';

export const playbookSubject = 'playbook';

export type PageOf = 'definition' | 'playbook';

export type PageWrittenIn = 'workflow' | 'function' | 'playbook';

export interface DefinitionSubject {
  readonly type: string;
  readonly name: string;
}

export type PageSubject = DefinitionSubject | typeof playbookSubject;

export type ResultOver =
  | { readonly run: RunDetailAsRecorded; readonly read?: PayloadAsRead }
  | { readonly sample: Schema.Json }
  | { readonly latest: true };

export type PageCheck = (
  text: string,
  writtenIn: PageWrittenIn,
) => Effect.Effect<PageContent | null | undefined, InvalidInput | Unavailable>;

interface PageViewsShown {
  readonly runs?: string;
  readonly standing?: Schema.JsonObject;
  readonly glance?: Schema.JsonObject;
}

export interface PlaybookPageSave {
  readonly source: string;
  readonly content: PageContent;
}

type Read<A, E = never> = Effect.Effect<A, E, PlaybookReader>;

type ReadInPlace<A, E = never> = Effect.Effect<A, E, PlaybookReader | PlaybookContext>;

export interface SubjectPages {
  readonly check: PageCheck;
  readonly withoutThePage: (source: string, writtenIn: Exclude<PageWrittenIn, 'playbook'>) => string;
  readonly pageOf: (type: string, name: string) => Read<PageStanding | undefined>;
  readonly playbookPageOf: () => Read<SubjectPage | undefined>;
  readonly resultOf: (type: string, name: string, over: ResultOver) => ReadInPlace<string | undefined, InvalidInput>;
  readonly viewsOf: (subject: PageSubject) => ReadInPlace<PageViewsShown>;
  readonly asOfRun: (subject: DefinitionSubject, run: string) => ReadInPlace<PageViewsShown>;
  readonly savePlaybookPage: (
    saved: PlaybookPageSave | null,
  ) => Effect.Effect<SubjectPage | undefined, Conflict, PlaybookReader | PlaybookWriter | Caller>;
}
