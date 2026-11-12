import { placeholdersIn } from '@on.auto/config';
import { isPinnableUrl } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const gatewayClaims = ['name', 'playbook_name'] as const;

export const GatewaySchema = Schema.Struct({
  url: Schema.String.annotate({
    description: 'The https URL where the start, the hand-off and the end of a connection made through it are asked',
  }),
  audiences: Schema.Struct({
    connections: NamedSchema.annotate({
      description: 'The aud of the note the gateway takes with the start, the hand-off and the end of a connection',
    }),
    calls: NamedSchema.annotate({ description: 'The aud of the note the gateway takes with a call' }),
  }),
  claims: Schema.optionalKey(
    Schema.Array(Schema.Literals(gatewayClaims)).annotate({
      description:
        "The display names the note may carry beside the ids: name, the person's, and playbook_name, the playbook's; ids alone where it is left out",
    }),
  ),
}).annotate({
  description:
    "For authorization, the gateway a connection is made through: it makes the consent with its own client, keeps the vendor's tokens, and hands the runtime a key of the connection's own, sent under the security scheme name names",
});

type Gateway = typeof GatewaySchema.Type;

export const PermissionsSchema = Schema.Literals(['application', 'delegated']).annotate({
  description:
    'For authorization, whether a connection made this way acts as the app, application, or as the person who connects, delegated; delegated where it is left out',
});

export const wayThroughAGateway = 'an authorization way through a gateway';

interface WayIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

interface ThroughAGateway {
  readonly gateway?: Gateway | undefined;
  readonly in?: string | undefined;
}

const securitySchemePlacement = 'security';

function gatewayUrlIssuesOf({ url }: Gateway): readonly WayIssue[] {
  return isPinnableUrl(url) && placeholdersIn(url).length === 0
    ? []
    : [
        {
          path: ['gateway', 'url'],
          issue: 'Expected the https URL of the gateway, or an http URL on a loopback address, with no placeholder',
        },
      ];
}

function audienceIssuesOf({ audiences }: Gateway): readonly WayIssue[] {
  return audiences.connections === audiences.calls
    ? [
        {
          path: ['gateway', 'audiences', 'calls'],
          issue:
            "Expected an audience for calls other than the connections', so that a note signed for a connection's steps never stands for a call",
        },
      ]
    : [];
}

function claimIssuesOf({ claims = [] }: Gateway): readonly WayIssue[] {
  return claims.flatMap((claim, index) =>
    claims.indexOf(claim) < index
      ? [{ path: ['gateway', 'claims', String(index)], issue: `Expected ${claim} once in claims` }]
      : [],
  );
}

function placementIssuesOf(way: ThroughAGateway): readonly WayIssue[] {
  return way.in === undefined || way.in === securitySchemePlacement
    ? []
    : [
        {
          path: ['in'],
          issue:
            'Expected in: security, since the key a gateway hands over is sent under a security scheme of the document, in a header of its own',
        },
      ];
}

export function gatewayIssuesOf(way: ThroughAGateway): readonly WayIssue[] {
  const { gateway } = way;
  return gateway === undefined
    ? []
    : [
        ...gatewayUrlIssuesOf(gateway),
        ...audienceIssuesOf(gateway),
        ...claimIssuesOf(gateway),
        ...placementIssuesOf(way),
      ];
}
