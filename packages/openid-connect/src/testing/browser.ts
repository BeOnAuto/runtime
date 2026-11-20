export interface Asking {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface Browser {
  readonly cookies: ReadonlyMap<string, string>;
  readonly setCookies: readonly string[];
  readonly at: (address: string, asking?: Asking) => Promise<Response>;
  readonly cookieSet: (name: string, value: string) => void;
}

function cookieHeaderOf(cookies: ReadonlyMap<string, string>): string {
  return [...cookies.entries()].map((entry: readonly [string, string]) => entry.join('=')).join('; ');
}

function cookiesSetBy(answer: Readonly<Response>): readonly (readonly [string, string])[] {
  return answer.headers.getSetCookie().map((cookie) => {
    const [pair = ''] = cookie.split(';');
    const [name = '', value = ''] = pair.split('=');
    return [name, value];
  });
}

export function browserAt(at: string, publicUrl: string): Browser {
  const cookies = new Map<string, string>();
  const setCookies: string[] = [];
  return {
    cookies,
    setCookies,
    cookieSet: (name, value) => {
      cookies.set(name, value);
    },
    at: async (address, { method = 'GET', headers = {}, body } = {}) => {
      const local = `${at}${address.startsWith(publicUrl) ? address.slice(publicUrl.length) : address}`;
      const sent = { ...headers, cookie: cookieHeaderOf(cookies) };
      const answer = await fetch(local, {
        redirect: 'manual',
        method,
        headers: sent,
        ...(body === undefined ? {} : { body }),
      });
      setCookies.push(...answer.headers.getSetCookie());
      for (const [name, value] of cookiesSetBy(answer)) {
        cookies.set(name, value);
        if (value === '') {
          cookies.delete(name);
        }
      }
      return answer;
    },
  };
}
