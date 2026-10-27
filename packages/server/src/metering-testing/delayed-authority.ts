import type { LicenseFetch } from '@on.auto/meter';

export function delayedAuthority() {
  const heard = Promise.withResolvers<true>();
  const resume = Promise.withResolvers<true>();
  return {
    heard: heard.promise,
    release: () => {
      resume.resolve(true);
    },
    fetchOver:
      (fetch: LicenseFetch): LicenseFetch =>
      async (request) => {
        heard.resolve(true);
        await resume.promise;
        return fetch(request);
      },
  };
}
