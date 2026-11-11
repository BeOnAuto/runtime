import { everyDocumentCarriesItsPage, inSteps, modelsOfAServer, sentences, type Built } from './built-recipes.ts';
import { serves, where, type Carried } from './start-guide.ts';

function reasoningTools(carried: Carried): readonly string[] {
  const otherwise = serves(carried, 'lookup') || serves(carried, 'interaction');
  return where(
    serves(carried, 'reasoning'),
    otherwise
      ? 'A reasoning function names tools in `tools` only where its model must choose among them while it runs, because which to call, or how often, depends on what they answer.'
      : 'A reasoning function names in `tools` the tools its model may call while it runs.',
  );
}

function opening(carried: Carried): string {
  return sentences(
    [
      'A tool of a connected service is put to work by the function type its use needs, and the tool itself says which: search gives each tool a `mark`.',
    ],
    where(
      serves(carried, 'lookup'),
      'A read the job always makes, by a tool marked reads, is a lookup function: one call and no model.',
    ),
    where(
      serves(carried, 'interaction'),
      'An act, by a tool marked acts or unmarked, is an interaction function, which calls it with `call`: it answers at once and spends no model call.',
    ),
    reasoningTools(carried),
    ["Read a type's guide with get_guide before you write a function of that type."],
    where(carried.pages, everyDocumentCarriesItsPage),
    where(serves(carried, 'reasoning'), modelsOfAServer),
  );
}

const searching =
  'Call search to see the tool servers this playbook may use and their tools, each with its `mark`; when the person named a server, give its name as `server`, and give `terms`, a few words of what the person wants done, to find the tools that fit among many. Call introspect for the input_schema of a tool before writing its arguments.';

const connecting =
  "When no server is listed, or not the one the person wants, or search says a server's connection is `connection_broken`, follow the connect-a-service recipe: it connects the service, or reconnects it, and sets it up for what the playbook will do there; then call search again. When a server says it cannot be asked just now, tell the person why, in its words; whoever runs the server can look into it.";

const learning =
  "To learn what a tool answers, call it yourself with the arguments its input_schema takes and read its `text`: that is what a run of a function will get. Never save a function only to see what a tool answers. Call a tool whose `mark` is reads with query_connection. A tool whose `mark` is acts or unmarked may change something, so call it with execute_connection, and only once the person agrees. When a function needs an id, such as a channel's, call the tool that lists them and take the id from its answer, confirming the choice with the person.";

function usesOf(carried: Carried): readonly string[] {
  return [
    ...where(
      serves(carried, 'lookup'),
      "a read the job always makes, by a tool marked reads: a lookup function, whose `call` names the `server` and the `tool`, with its arguments in `with`, written from the run's input. One lookup function for each read.",
    ),
    ...where(
      serves(carried, 'interaction'),
      'an act on a system, or a read by a tool that is not marked reads: an interaction function that calls the tool with `call`, written from the answer execute_connection gave.',
      "a question to a person: an interaction function too. Ask once where they want to be asked, then name in `deliver` the connection's tool that sends the request and in `replies` the one that reads the replies, or write `deliver: agent`.",
    ),
    ...where(
      serves(carried, 'reasoning'),
      sentences(
        [
          'a choice among tools that the model must make while it runs: a reasoning function whose `tools` name only those tools.',
        ],
        where(
          serves(carried, 'lookup'),
          'Hand it as input what lookup functions already read, so that it calls a tool only for what it could not be handed.',
        ),
      ),
    ),
  ];
}

function givingEachUse(carried: Carried): string {
  return [
    'Ask the person what the playbook should do with the tools, and give each use its function:',
    ...usesOf(carried).map((use) => `   - ${use}`),
  ].join('\n');
}

function writingEach({ pages }: Carried): string {
  return `Write each function in the format of its type's guide${pages ? ', with its `page` in the same document' : ''}, show it to the person, and save it with create_definition, with its \`type\`, once they agree.`;
}

const runningEach =
  'Run each with run_definition. A function that has a service act really acts when it runs, so run it only once the person agrees. A run that called tools and did not succeed is not run again under its id, since a tool may have changed something: read what it called with list_playbook_events, given its `run_id`, and start a new run only if the person still wants one.';

const telling =
  'Tell the person what each run did with the tools, and that a function can call only the tools it names.';

function writingTheWorkflow({ pages }: Carried): string {
  return `Then, with the workflow guide, write or change the workflow that owns the job the person wants done again, whose steps are the functions${pages ? ', with its `page` in the same document' : ''}: the steps that read come first, and each later step is handed what the steps before it answered. Save it once they agree, run it, and tell the person what it answered and what they can do next.`;
}

function giveToolsText(carried: Carried): string {
  const steps = [
    searching,
    connecting,
    learning,
    givingEachUse(carried),
    writingEach(carried),
    runningEach,
    telling,
    ...where(serves(carried, 'workflow'), writingTheWorkflow(carried)),
  ];
  return ['# Give the playbook tools', '', opening(carried), '', ...inSteps(steps), ''].join('\n');
}

export const giveTools: Built = {
  servedWhere: (carried) => ['reasoning', 'lookup', 'interaction'].some((type) => serves(carried, type)),
  text: giveToolsText,
};
