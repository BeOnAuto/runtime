export const mostRecordsInAPage = 100;

export const mostBytesLoadedInAPage = 4 * 1024 * 1024;

export const mostExaminedInAPage = 1000;

export interface Examined {
  readonly examined: number;
  readonly wanted: boolean;
  readonly size: number;
}

export interface BoundedPage<Item extends Examined> {
  readonly delivered: readonly Item[];
  readonly resumeAfter: Item | undefined;
  readonly lastExamined: Item | undefined;
}

function overBudget(delivered: readonly Examined[], loaded: number, { size }: Examined): boolean {
  return delivered.length > 0 && loaded + size > mostBytesLoadedInAPage;
}

export function boundedPage<Item extends Examined>(
  examined: readonly Item[],
  limit: number,
  examinedAtMost: number,
): BoundedPage<Item> {
  const delivered: Item[] = [];
  let loaded = 0;
  let lastExamined: Item | undefined;
  for (const item of examined) {
    const full = item.wanted && (delivered.length === limit || overBudget(delivered, loaded, item));
    if (item.examined > examinedAtMost || full) {
      return { delivered, resumeAfter: lastExamined, lastExamined };
    }
    if (item.wanted) {
      delivered.push(item);
      loaded += item.size;
    }
    lastExamined = item;
  }
  return { delivered, resumeAfter: undefined, lastExamined };
}
