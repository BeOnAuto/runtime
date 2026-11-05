export interface SignInOptions {
  readonly ifSignedOut?: 'ask' | 'fail' | null;
  readonly server?: string;
  readonly site?: string;
  readonly expires?: string | null;
  readonly deliver?: readonly string[];
  readonly front?: readonly string[];
  readonly body?: string;
}

export const signInMessage =
  "The weekly stock check reads your open orders on the supplier portal, and you're not signed in there.";

export const supplierPortal = 'portal.supplier.example';

export const chatSignInDelivery: readonly string[] = [
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  '    channel: D07Q2KX9B',
  "    text: '{{ message }}'",
];

function answeredLines(ifSignedOut: 'ask' | 'fail' | null): readonly string[] {
  return ifSignedOut === null ? [] : [`  if_signed_out: ${ifSignedOut}`];
}

function expiresLines(expires: string | null): readonly string[] {
  return expires === null ? [] : [`expires: ${expires}`];
}

export function signInDocument({
  ifSignedOut = 'ask',
  server = 'browser',
  site = supplierPortal,
  expires = 'P1D',
  deliver = ['deliver: agent'],
  front = [],
  body = signInMessage,
}: SignInOptions = {}): string {
  return [
    '---',
    'description: Makes sure the person the stock check runs for is signed in to the supplier portal',
    'sign_in:',
    `  server: ${server}`,
    `  site: ${site}`,
    ...answeredLines(ifSignedOut),
    ...expiresLines(expires),
    ...deliver,
    ...front,
    '---',
    body,
  ].join('\n');
}

export function failingSignInDocument(): string {
  return signInDocument({ ifSignedOut: 'fail', expires: null, deliver: [], body: '' });
}
