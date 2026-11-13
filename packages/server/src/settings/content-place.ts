import type { ContentSettings } from './content-settings.ts';

function hostOf(endpoint: string | undefined): string {
  return endpoint === undefined ? 'the S3 endpoint of its region' : new URL(endpoint).host;
}

export function contentPlaceOf(content: ContentSettings): string {
  if (content.store === 'ledger') {
    return "in the ledger's database";
  }
  const { location, endpoint } = content;
  const under = location.prefix === '' ? '' : ` under ${location.prefix}/`;
  return `on object storage, in the bucket ${location.bucket}${under}, on ${hostOf(endpoint)}`;
}
