interface Sourced {
  readonly kind: string;
  readonly client_source?: string | undefined;
}

interface Placed extends Sourced {
  readonly in?: string | undefined;
}

interface PlacementIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

export const credentialThroughAGateway = 'an authorization credential through a gateway';

export const fieldsThroughAGateway = {
  required: ['issuer', 'in', 'name'],
  optional: ['scope', 'client_id', 'client_source'],
} as const;

export function isThroughAGateway({ kind, client_source: source }: Sourced): boolean {
  return kind === 'authorization' && source === 'gateway';
}

export function gatewayPlacementIssuesOf(credential: Placed): readonly PlacementIssue[] {
  return isThroughAGateway(credential) && credential.in !== undefined && credential.in !== 'security'
    ? [
        {
          path: ['in'],
          issue:
            'Expected in: security, since the key a gateway hands over is sent under a security scheme of the document',
        },
      ]
    : [];
}
