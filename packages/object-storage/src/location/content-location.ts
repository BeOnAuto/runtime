export interface ContentLocation {
  readonly bucket: string;
  readonly prefix: string;
}

const bucketName = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;

function prefixOf(pathname: string): string | undefined {
  try {
    return pathname
      .split('/')
      .filter((segment) => segment !== '')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return undefined;
  }
}

interface BucketUrl {
  readonly bucket: string;
  readonly pathname: string;
}

function bucketUrlOf(url: string): BucketUrl | undefined {
  const parsed = URL.parse(url.trim());
  if (parsed?.protocol !== 's3:') {
    return undefined;
  }
  const { hostname, username, password, port, search, hash, pathname } = parsed;
  const namesMore = [username, password, port, search, hash].some((part) => part !== '');
  return bucketName.test(hostname) && !namesMore ? { bucket: hostname, pathname } : undefined;
}

export function contentLocationOf(url: string): ContentLocation | undefined {
  const parsed = bucketUrlOf(url);
  const prefix = parsed === undefined ? undefined : prefixOf(parsed.pathname);
  return parsed === undefined || prefix === undefined ? undefined : { bucket: parsed.bucket, prefix };
}
