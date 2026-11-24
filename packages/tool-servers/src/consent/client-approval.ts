import { Schema } from 'effect';

/**
 * What of a client Auto's consent service lists as still awaiting its vendor's approval: all of it, `true`, or the
 * scopes it names, `{ scopes }`, where the vendor approves each scope of an app on its own. `false` is read as not
 * awaiting, so a listing that ever sends it is still read.
 */
export const AwaitingApprovalSchema = Schema.Union([
  Schema.Boolean,
  Schema.Struct({ scopes: Schema.Array(Schema.String.check(Schema.isMinLength(1))) }),
]);

interface StatingApproval {
  readonly awaiting_approval?: typeof AwaitingApprovalSchema.Type | undefined;
}

interface AskingScopes {
  readonly scope?: string | undefined;
}

/**
 * Whether a client awaits its vendor's approval for what a way asks: as a whole, where it is listed `true`, or for the
 * scopes it is listed with, where the way asks any of them, its `scope` split on spaces as a client's scopes cover it.
 * A fact the service states of the client, set against the scopes the way asks, never read from the way's issuer or
 * its provider.
 */
export function awaitsApprovalFor({ awaiting_approval: awaiting }: StatingApproval, { scope }: AskingScopes): boolean {
  return typeof awaiting === 'object'
    ? (scope?.split(' ') ?? []).some((asked) => awaiting.scopes.includes(asked))
    : awaiting === true;
}
