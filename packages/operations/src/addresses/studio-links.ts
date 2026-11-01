import { Context, Effect, Schema } from 'effect';

export type StudioPage =
  | { readonly kind: 'playbook'; readonly playbook: string }
  | { readonly kind: 'definition'; readonly playbook: string; readonly type: string; readonly name: string }
  | { readonly kind: 'run'; readonly playbook: string; readonly run: string };

export type StudioLinkTo = (page?: StudioPage) => string;

export const StudioLinks = Context.Reference<StudioLinkTo | null>('@on.auto/operations/StudioLinks', {
  defaultValue: () => null,
});

export function studioLinkTo(page?: StudioPage): Effect.Effect<string | undefined> {
  return StudioLinks.useSync((linkTo) => (linkTo === null ? undefined : linkTo(page)));
}

export interface LinkedInStudio {
  readonly studio?: string;
}

export function withStudioLink<Output extends object>(
  output: Output,
  page: StudioPage,
): Effect.Effect<Output & LinkedInStudio> {
  return Effect.map(studioLinkTo(page), (studio) => (studio === undefined ? output : { ...output, studio }));
}

export function studioLinkField(done: 'made' | 'saved' | 'run') {
  return Schema.optionalKey(Schema.String.annotate({ description: `The page in Studio of what was ${done}` }));
}
