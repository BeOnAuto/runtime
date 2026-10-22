import type { ShippedFiles } from '@on.auto/operations';

const monoFile = new URL('./fonts/dm-mono-latin-500.woff2', import.meta.url);

const sansFile = new URL('./fonts/dm-sans-latin-variable.woff2', import.meta.url);

function embedded(font: Readonly<Uint8Array>): string {
  return `url(data:font/woff2;base64,${Buffer.from(font).toString('base64')}) format('woff2')`;
}

export async function fontFacesOf(shippedFiles: ShippedFiles): Promise<string> {
  const [mono, sans] = await Promise.all([shippedFiles.bytes(monoFile), shippedFiles.bytes(sansFile)]);
  return `
@font-face {
  font-family: 'DM Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: ${embedded(mono)};
}
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 100 1000;
  font-display: swap;
  src: ${embedded(sans)};
}
`;
}
