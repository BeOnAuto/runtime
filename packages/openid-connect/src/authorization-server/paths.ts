export const authorizationServerRoutes = {
  authorization: '/oauth/authorize',
  token: '/oauth/token',
  registration: '/oauth/register',
  revocation: '/oauth/revoke',
  jwks: '/.well-known/jwks.json',
  userinfo: '/me',
  end_session: '/session/end',
} as const;

export const interactionPath = '/interaction';

export const confirmedStep = 'confirm';

export const abortedStep = 'abort';

export const federatedStep = 'federated';

export const invitationPath = '/invitations';

const metadataPaths = ['/.well-known/openid-configuration', '/.well-known/oauth-authorization-server'];

const { authorization, registration, end_session: endSession } = authorizationServerRoutes;

function exactPathsOf(signInCallbackPath: string): ReadonlySet<string> {
  return new Set([
    ...Object.values(authorizationServerRoutes),
    ...metadataPaths,
    `${endSession}/confirm`,
    `${endSession}/success`,
    signInCallbackPath,
  ]);
}

const oneSegment = '[^/]+';

const steps = [confirmedStep, abortedStep, federatedStep].join('|');

const pathsWithAnId = new RegExp(
  `^(?:${authorization}/${oneSegment}|${registration}/${oneSegment}|${invitationPath}/${oneSegment}|${interactionPath}/${oneSegment}(?:/(?:${steps}))?)$`,
  'u',
);

export function answeredPathsOf(signInCallbackPath: string): (path: string) => boolean {
  const exactPaths = exactPathsOf(signInCallbackPath);
  return (path) => exactPaths.has(path) || pathsWithAnId.test(path);
}

export function interactionAddressOf(uid: string, step?: string): string {
  return [interactionPath, uid, ...(step === undefined ? [] : [step])].join('/');
}
