import { Option, Schema } from 'effect';

export type Point = readonly string[];

const beforeAnything = '';

const decodePoint = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)));

export function pointText(point: Point | undefined): string {
  return point === undefined ? beforeAnything : JSON.stringify(point);
}

export function pointIn(text: string): Point | undefined {
  return text === beforeAnything ? undefined : Option.getOrUndefined(decodePoint(text));
}

function comparePart(first: string, second: string): number {
  const apart = BigInt(first) - BigInt(second);
  return apart === 0n ? 0 : Number(apart > 0n) - Number(apart < 0n);
}

export function comparePoints(first: Point | undefined, second: Point | undefined): number {
  if (first === undefined || second === undefined) {
    return Number(first !== undefined) - Number(second !== undefined);
  }
  const unequal = first.map((part, index) => comparePart(part, second[index] ?? '0')).find((order) => order !== 0);
  return unequal ?? 0;
}

export function isAfter(point: Point, checkpoint: Point | undefined): boolean {
  return comparePoints(point, checkpoint) > 0;
}

export function earliestOf(points: readonly (Point | undefined)[]): Point | undefined {
  return points.reduce<Point | undefined>(
    (earliest, point) => (comparePoints(point, earliest) < 0 ? point : earliest),
    points[0],
  );
}
