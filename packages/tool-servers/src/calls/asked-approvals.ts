import { Option, Schema } from 'effect';

import { metaValueOf, type ToolResult } from '../bounds/tool-results.ts';

export const confirmationNeededKey = 'auto.on/confirmation_needed';

const mostAskedTextBytes = 1024;

export interface AskedApproval {
  readonly request: string | null;
  readonly tool: string;
  readonly digest: string;
  readonly action: string;
  readonly expires_at: string;
  readonly kind?: string;
  readonly site?: string;
  readonly person?: string;
}

const utf8 = new TextEncoder();

const controlCharacter = /\p{Cc}/u;

const AskedTextSchema = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      text.length > 0 && utf8.encode(text).byteLength <= mostAskedTextBytes && !controlCharacter.test(text),
    { expected: `1 to ${mostAskedTextBytes} bytes of text with no control character` },
  ),
);

const MomentSchema = Schema.String.check(
  Schema.makeFilter((text: string) => Number.isFinite(Date.parse(text)), { expected: 'a moment in ISO 8601' }),
);

const ConfirmationNeededSchema = Schema.Struct({
  request: Schema.NullOr(AskedTextSchema),
  tool: AskedTextSchema,
  digest: AskedTextSchema,
  action: AskedTextSchema,
  expires_at: MomentSchema,
  kind: Schema.optionalKey(AskedTextSchema),
  site: Schema.optionalKey(AskedTextSchema),
  person: Schema.optionalKey(AskedTextSchema),
});

const decodeAsked = Schema.decodeUnknownOption(Schema.fromJsonString(ConfirmationNeededSchema));

export function askedApprovalOf(result: ToolResult, scrub: (text: string) => string): AskedApproval | undefined {
  const asked = metaValueOf(result, confirmationNeededKey);
  if (result.isError !== true || asked === undefined) {
    return undefined;
  }
  const decoded = Option.map(decodeAsked(scrub(JSON.stringify(asked))), (approval) => ({
    ...approval,
    expires_at: new Date(Date.parse(approval.expires_at)).toISOString(),
  }));
  return Option.getOrUndefined(decoded);
}
