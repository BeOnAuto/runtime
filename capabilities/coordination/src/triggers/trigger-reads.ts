import { parsedTemplate } from '@on.auto/definitions/template';
import {
  pointerIssues,
  sampleMoment,
  templateIssues,
  templatesIssues,
  toolBlockEngine,
  type TemplateSet,
} from '@on.auto/definitions/tool-blocks';
import { TriggerReadSchema, type TriggerRead } from '@on.auto/definitions/trigger-reads';
import { listed } from '@on.auto/phrasing';
import {
  field,
  isConnectionSource,
  isObject,
  objectField,
  pointerTo,
  rejection,
  type Json,
  type JsonObject,
  type Rejection,
} from '@on.auto/workflow-engine';
import { Result, Schema, SchemaIssue } from 'effect';

interface OfferedTool {
  readonly name: string;
  readonly mark: 'reads' | 'acts' | 'unmarked';
  readonly input_schema: Schema.JsonObject;
}

export interface ToolsListed {
  readonly kind: 'listed';
  readonly tools: readonly OfferedTool[];
}

export type ToolsOffered = ToolsListed | { readonly kind: 'unavailable'; readonly detail: string };

interface ReadWritten {
  readonly read?: TriggerRead;
  readonly rejections: readonly Rejection[];
}

interface ReadAsked {
  readonly connection: string;
  readonly reference: string;
  readonly type: string;
  readonly read: TriggerRead;
}

interface EventListed {
  readonly type: string;
  readonly title: string;
}

const readKey = 'read';

const sinceName = 'since';

const readCallTemplates: TemplateSet = {
  names: [sinceName, 'page_token'],
  what: 'a template of the call that lists what is new',
  sample: { since: sampleMoment, page_token: 'page-2' },
  structured: sinceName,
};

const readStartTemplates: TemplateSet = {
  names: ['now'],
  what: 'a template of the start of a read',
  sample: { now: sampleMoment },
  structured: 'now',
};

const noLines: ReadonlyMap<string, number> = new Map();

const checkedOn = () => performance.now();

const ownTypeShape = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u;

const readTakenWords =
  'Remove `read` from this filter: only a filter whose `source` names a connection takes `read`, which names a tool of that connection for Auto to check';

const idWords =
  'Add `id` to `read`, pointing at what tells one item from another, so that the workflow starts once for each';

const ownTypeWords =
  'Write `type` as a name of your own for what happens, in lowercase words joined by dots, such as `booking.created` or `invoice.received`';

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const decodeRead = Schema.decodeUnknownResult(TriggerReadSchema, { onExcessProperty: 'error' });

function pointerOfIssue(path: readonly unknown[]): string {
  return path.map((segment) => `/${String(segment)}`).join('');
}

function detailOfIssue(message: string, path: readonly unknown[]): string {
  return message === 'Missing key' ? `${String(path.at(-1))} is required` : message;
}

function shapeRejections(written: Json, pointer: string): ReadWritten {
  return Result.match(decodeRead(written), {
    onSuccess: (read) => ({ read, rejections: [] }),
    onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) => ({
      rejections: formatIssues(issue).issues.map(({ message, path = [] }) => {
        const keys = path.filter((segment) => typeof segment !== 'object');
        return rejection(`${pointer}${pointerOfIssue(keys)}`, detailOfIssue(message, keys));
      }),
    }),
  });
}

function placedRejections(issues: readonly { readonly pointer: string; readonly detail: string }[]) {
  return issues.map(({ pointer, detail }) => rejection(pointer, detail));
}

function pointerRejections(read: TriggerRead, pointer: string): readonly Rejection[] {
  const intoTheAnswer: readonly (readonly [string, string | undefined])[] = [
    [`${pointer}/list`, read.list === '' ? undefined : read.list],
    ...read.id.map((each, index): readonly [string, string] => [`${pointer}/id/${index}`, each]),
    [`${pointer}/cursor`, read.cursor],
    [`${pointer}/next_page_token`, read.next_page_token],
    [`${pointer}/time`, read.time],
  ];
  return placedRejections(pointerIssues(noLines, intoTheAnswer));
}

function templateRejections(read: TriggerRead, pointer: string): readonly Rejection[] {
  const place = { lines: noLines, inputSchema: undefined, clock: checkedOn };
  return [
    ...(read.with === undefined
      ? []
      : placedRejections(templatesIssues(readCallTemplates, read.with, { ...place, pointer: `${pointer}/with` }))),
    ...(read.start === undefined
      ? []
      : placedRejections(templateIssues(readStartTemplates, read.start, { ...place, pointer: `${pointer}/start` }))),
  ];
}

function namesAConnection(filter: JsonObject): boolean {
  const source = field(objectField(filter, 'with') ?? {}, 'source');
  return typeof source === 'string' && isConnectionSource(source);
}

export function filterWithoutRead(filter: Json): Json {
  return isObject(filter)
    ? Object.fromEntries(Object.entries(filter).filter(([key]: readonly [string, Json]) => key !== readKey))
    : filter;
}

export function readWrittenIn(filter: Json, pointer: string): ReadWritten {
  const written = isObject(filter) ? field(filter, readKey) : undefined;
  if (written === undefined || !isObject(filter)) {
    return { rejections: [] };
  }
  const at = `${pointer}/${readKey}`;
  if (!namesAConnection(filter)) {
    return { rejections: [rejection(at, readTakenWords)] };
  }
  if (isObject(written) && field(written, 'id') === undefined) {
    return { rejections: [rejection(at, idWords)] };
  }
  const shaped = shapeRejections(written, at);
  if (shaped.read === undefined) {
    return shaped;
  }
  const rejections = [...pointerRejections(shaped.read, at), ...templateRejections(shaped.read, at)];
  return rejections.length === 0 ? shaped : { rejections };
}

function listedEventsWords(connection: string, types: readonly EventListed[]): string {
  return `Remove \`read\` from this filter: the connection ${connection} lists its own events. Name one of them as \`type\`: ${listed(types.map(({ type, title }) => `${type} (${title})`))}`;
}

function notOfferedWords(connection: string, tool: string): string {
  return `The connection ${connection} has no tool named ${tool}. \`list_connection_tools\` lists its tools`;
}

function notReadingWords(tool: string): string {
  return `Auto checks an app only through a tool that only reads, and ${tool} is not marked as one. Choose a tool that \`list_connection_tools\` marks as \`reads\`. If none lists what the person wants, tell them that, and ask whether the workflow should start at a set time each day instead`;
}

function argumentWords(tool: string, argument: string, declared: readonly string[]): string {
  const takes = declared.length === 0 ? 'It takes no arguments' : `It takes ${listed(declared)}`;
  return `${tool} takes no argument named ${argument}. ${takes}`;
}

function notNewWords(tool: string): string {
  return `With these arguments Auto cannot ask ${tool} for what is new. Pass \`{{ since }}\` to the argument that lists what came after a point, or, where the tool has none and lists the newest first, set \`order\` to \`newest_first\` and \`cursor\` to the place in each item that holds when it was created or changed. If the tool can do neither, tell the person the app cannot list what is new, and ask whether the workflow should start at a set time each day instead`;
}

export function toolsUnavailableWords(connection: string, detail: string): string {
  return `${detail} A trigger that checks a tool is saved once Auto has seen that the tool only reads, so save the workflow again once ${connection} can be asked.`;
}

function argumentsDeclaredBy({ input_schema: inputSchema }: OfferedTool): readonly string[] {
  const properties = field(inputSchema, 'properties');
  return isObject(properties) ? Object.keys(properties) : [];
}

function readsTheName(value: Json, name: string): boolean {
  if (typeof value === 'string') {
    const parsed = parsedTemplate(toolBlockEngine, value, 1);
    return Result.isSuccess(parsed) && parsed.success.variables.some(({ path }) => path[0] === name);
  }
  if (Array.isArray(value)) {
    return value.some((item: Json) => readsTheName(item, name));
  }
  return isObject(value) && Object.values(value).some((item) => readsTheName(item, name));
}

function asksForWhatIsNew({ with: written = {}, order, cursor }: TriggerRead): boolean {
  return readsTheName(written, sinceName) || (order === 'newest_first' && cursor !== undefined);
}

function toolRejections({ reference, read }: ReadAsked, offered: OfferedTool): readonly Rejection[] {
  const declared = argumentsDeclaredBy(offered);
  return [
    ...(offered.mark === 'reads' ? [] : [rejection(`${reference}/read/tool`, notReadingWords(read.tool))]),
    ...Object.keys(read.with ?? {})
      .filter((argument) => !declared.includes(argument))
      .map((argument) =>
        rejection(pointerTo(`${reference}/read/with`, argument), argumentWords(read.tool, argument, declared)),
      ),
  ];
}

export function listedEventsRejections(asked: ReadAsked, types: readonly EventListed[]): readonly Rejection[] {
  return types.length === 0 ? [] : [rejection(`${asked.reference}/read`, listedEventsWords(asked.connection, types))];
}

export function readRejectionsOf(asked: ReadAsked, tools: ToolsListed): readonly Rejection[] {
  const { connection, reference, type, read } = asked;
  const named = tools.tools.find(({ name }) => name === read.tool);
  return [
    ...(ownTypeShape.test(type) ? [] : [rejection(`${reference}/with/type`, ownTypeWords)]),
    ...(named === undefined
      ? [rejection(`${reference}/read/tool`, notOfferedWords(connection, read.tool))]
      : toolRejections(asked, named)),
    ...(asksForWhatIsNew(read) ? [] : [rejection(`${reference}/read`, notNewWords(read.tool))]),
  ];
}
