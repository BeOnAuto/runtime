import { templateEngine, type TagDefinition } from '@on.auto/definitions/template';

export const instructionsBegin = Symbol('instructions begin');

export const instructionsEnd = Symbol('instructions end');

function marker(name: string, sentinel: symbol): TagDefinition {
  return {
    parse() {
      if (this.token.args.trim() !== '') {
        throw new Error(`{% ${name} %} takes no arguments`);
      }
    },
    render: () => sentinel,
  };
}

export const engine = templateEngine(() => ({
  tags: { system: marker('system', instructionsBegin), endsystem: marker('endsystem', instructionsEnd) },
}));
