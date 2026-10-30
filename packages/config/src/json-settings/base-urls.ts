export function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (url.charAt(end - 1) === '/') {
    end -= 1;
  }
  return url.slice(0, end);
}
