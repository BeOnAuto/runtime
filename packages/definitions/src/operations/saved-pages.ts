import type { Schema } from 'effect';

interface PageViewsShown {
  readonly lately?: string;
  readonly standing?: Schema.JsonObject;
}

export function viewsShownOf(lately: string | undefined, standing: Schema.JsonObject | undefined): PageViewsShown {
  return { ...(lately === undefined ? {} : { lately }), ...(standing === undefined ? {} : { standing }) };
}
