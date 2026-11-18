import { PlaybookReader, type PlaybookContext, type ProjectedKeyedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';

export const lately = { minutes: 5, millis: 5 * 60 * 1000 } as const;

export const mostDismissedLatelyRead = 10;

export interface DismissedLately {
  readonly id: string;
  readonly per?: string;
}

function dismissedLatelyOf({ key, row }: ProjectedKeyedRow): DismissedLately {
  const per = row['per_id'];
  return typeof per === 'string' ? { id: key, per } : { id: key };
}

interface ThisDismissal {
  readonly id: string;
  readonly by: string;
  readonly at: number;
}

export const dismissedLatelyBefore = ({
  id,
  by,
  at,
}: ThisDismissal): Effect.Effect<readonly DismissedLately[], never, PlaybookReader | PlaybookContext> =>
  Effect.map(
    Effect.flatMap(PlaybookReader, (reader) =>
      reader.readProjectedRows(assessmentsName, {
        where: [
          { column: 'dismissed', equals: true },
          { column: 'dismissed_at', after: at - lately.millis },
          { column: 'dismissed_by', equals: by },
        ],
        orderBy: ['dismissed_at'],
        order: 'desc',
        limit: mostDismissedLatelyRead + 1,
      }),
    ),
    (rows) =>
      rows
        .filter(({ key }) => key !== id)
        .slice(0, mostDismissedLatelyRead)
        .map((row) => dismissedLatelyOf(row)),
  );
