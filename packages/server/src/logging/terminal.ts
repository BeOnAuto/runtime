import { styleText } from 'node:util';

export type ColorDepth = 1 | 4 | 8 | 24;

export type Style = Parameters<typeof styleText>[0];

export interface ColorStream {
  readonly isTTY?: boolean;
  getColorDepth?(): number;
}

const depths: readonly ColorDepth[] = [24, 8, 4];

export function colorDepthOf(stream: ColorStream): ColorDepth {
  const depth = stream.isTTY === true ? (stream.getColorDepth?.() ?? 1) : 1;
  return depths.find((supported) => depth >= supported) ?? 1;
}

export function painterFor(depth: ColorDepth): (style: Style, text: string) => string {
  return depth === 1 ? (_style, text) => text : (style, text) => styleText(style, text, { validateStream: false });
}

export function linkerFor(depth: ColorDepth): (url: string, text: string) => string {
  return depth === 1 ? (_url, text) => text : (url, text) => `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`;
}
