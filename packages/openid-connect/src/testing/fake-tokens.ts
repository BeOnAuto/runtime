import { randomUUID } from 'node:crypto';

type Claims = Readonly<Record<string, unknown>>;

export interface TokensAnswering {
  readonly userInfo?: Claims;
  readonly refreshTokens?: boolean;
  readonly revocation?: boolean;
}

export interface FakeTokens {
  readonly declared: (base: string) => Claims;
  readonly issued: (subject: string) => Claims;
  readonly userInfo: (request: Readonly<Request>) => Response;
  readonly revoked: (form: Readonly<URLSearchParams>) => Response;
  readonly userInfoReads: () => number;
  readonly refreshTokensIssued: () => readonly string[];
  readonly tokensRevoked: () => readonly string[];
}

function json(body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

function bearerOf(request: Readonly<Request>): string {
  return String(request.headers.get('authorization')).replace(/^Bearer /u, '');
}

export function fakeTokens(answering: TokensAnswering): FakeTokens {
  const subjects = new Map<string, string>();
  const grants = new Map<string, string>();
  const revoked: string[] = [];
  const reads = { userInfo: 0 };
  return {
    declared: (base) => ({
      ...(answering.userInfo === undefined ? {} : { userinfo_endpoint: `${base}/userinfo` }),
      ...(answering.revocation === true ? { revocation_endpoint: `${base}/revoke` } : {}),
    }),
    issued: (subject) => {
      const accessToken = randomUUID();
      subjects.set(accessToken, subject);
      if (answering.refreshTokens !== true) {
        return { access_token: accessToken };
      }
      const refreshToken = randomUUID();
      grants.set(refreshToken, accessToken);
      return { access_token: accessToken, refresh_token: refreshToken };
    },
    userInfo: (request) => {
      reads.userInfo += 1;
      const subject = subjects.get(bearerOf(request));
      return subject === undefined
        ? json({ error: 'invalid_token' }, 401, { 'www-authenticate': 'Bearer error="invalid_token"' })
        : json({ sub: subject, ...answering.userInfo });
    },
    revoked: (form) => {
      const token = String(form.get('token'));
      revoked.push(token);
      for (const [refreshToken, accessToken] of grants) {
        if (refreshToken === token) {
          subjects.delete(accessToken);
        }
      }
      return new Response(null, { status: 200 });
    },
    userInfoReads: () => reads.userInfo,
    refreshTokensIssued: () => [...grants.keys()],
    tokensRevoked: () => [...revoked],
  };
}
