# Signing in during a run

This is the design of how a run asks a person to sign in to a site, and waits for them. It was agreed before the code. Every part of it is built: the sign-in function, its request, how it is answered, its endings, the activity's `waits_on` by id, and `acts_for` on a triggered run. Every part this page marks **new** was new when it was agreed. The public reference pages describe what the runtime does today, and each part changes them as it ships; [Reference pages each part changes](#reference-pages-each-part-changes) lists them.

## What it is for

A function can use a site in a browser through a connection whose server offers browser tools, such as hosted Auto's browser connection. Some sites need the person to sign in. Three rules hold for every sign-in:

- The person signs in, never the agent. The browser is handed to the person, and the agent, the runtime and the playbook's history never see a password.
- A sign-in belongs to the person who signed in. A run uses the sign-ins of the person it acts for and nobody else's.
- A run that needs a sign-in asks the person it acts for and waits, as an interaction function asks a person today.

So a playbook that uses a site behind a sign-in has a step that asks for it: a sign-in function, a new shape of interaction function. The step comes before the steps that use the site. When the person is already signed in, it ends at once. When they are not, it asks them, waits, and lets the workflow go on once they have signed in.

## What exists today and what is new

| Concept                                 | Today                                                                                                            | This design                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The shapes of an interaction function   | Asks a system, asks a person through a connection, asks an agent                                                 | **New**: asks the person a run acts for to sign in, with `sign_in`                                                                    |
| Whom a request waits on                 | A member by email address, when its party holds an `@`, or any member                                            | **New**: a person by id, when its party is a person's id such as `person:user_7kLm2`                                                  |
| Who may answer a request                | Any caller who may write to the playbook                                                                         | **New** for a sign-in request: only the person it waits on, and `signed_in: true` only from their own session, never through an agent |
| Whom a triggered run acts for           | It acts as the playbook itself, and never for a person                                                           | It still acts as the playbook. **New**: it records `acts_for`, the person whose sign-ins it uses, which grants nothing                |
| How a request reaches its party         | `deliver`: a connection's sending tool, or `agent`                                                               | The same `deliver`, unchanged                                                                                                         |
| How long a request waits                | `expires`, one minute to 30 days                                                                                 | The same `expires`, unchanged                                                                                                         |
| A request nobody answers                | `rejected` as `unanswered`, kind `expired`, status 410                                                           | The same. **New** kinds of `unanswered` for the other ways a sign-in does not come: `declined`, `signed_out`, `no_person`             |
| A tool that signs a person in to a site | None                                                                                                             | **New**: `browser_sign_in` of a browser connection, whose contract is [below](#the-browser-connection-s-browser-sign-in)              |
| The run's history                       | `tool_call_started`, `tool_call_answered`, `interaction_requested`, the delivery attempts and `request_answered` | The same facts. Nothing new is recorded, and nothing of the sign-in itself                                                            |

The existing concepts this design leans on are set out in [Interaction function format](../../reference/interaction-format.md), [Workflow format](../../reference/workflow-format.md#triggers), [The organization's activity](../../reference/http.md#the-organization-s-activity) and [Addresses](../../reference/addresses.md).

## Whom a run acts for

The person a run acts for is the one it asks to sign in, and the one whose sign-ins its browser restores:

| The run                                                                     | The person it acts for                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Started by a signed-in person, in Studio or through their agent             | That person, its `started_by`, as today                                            |
| Started in local mode                                                       | The local developer, as today                                                      |
| Started by a step of a workflow                                             | The person the workflow's run acts for                                             |
| Started by a trigger                                                        | **New**: its `acts_for`, the person who saved or restored the version the run runs |
| Started by an API key, or by a trigger of a version a key saved or restored | No person                                                                          |
| Started by a trigger, whose `acts_for` person has left the organization     | **New**: no person                                                                 |

A person is a signed-in caller, whose id is `person:` and the id the identity service gives them, as `started_by` and the activity's `by` name them today, or the local developer in local mode. An agent's token acts for its person, so a run an agent starts acts for the person who connected it.

### `acts_for` on a triggered run (new)

A triggered run acts as the playbook itself: its `started_by` is `playbook:` and the playbook's id, each step reads and writes that playbook alone, and no person's or key's permissions affect it. That stays as it is. The run also records `acts_for`, which names a person for one purpose: whose sign-ins it uses, and so whom it asks to sign in.

- **Who.** The caller of the record that put the version the run runs in place, where that caller is a person: the `definition_created` or `definition_updated` that saved it, or the `definition_restored` that brought it back. Those are the records that set a workflow's triggers going. A version an API key saved or restored gives no `acts_for`, so its triggered runs act for no person.
- **When.** As the trigger starts the run. A trigger the next version leaves unchanged starts that version from then on, so its runs act for whoever saved that version. Pausing and resuming a definition change nothing. Restoring one counts as saving it: whoever restores a version becomes the person its triggered runs act for, since a restore puts that version in place.
- **A person who has left.** A person who has left the organization is no person to act for, and their saved sign-ins are gone. So a triggered run whose saver has left records no `acts_for` and acts for no person, and a sign-in function that finds its person has left since ends `no_person`. The runtime learns who is still a member from its host (**new**): hosted Auto answers from the organization's members, and a runtime whose host keeps no list of members takes every signed-in person as one.
- **Where.** In the run's context, beside its `trigger`, so that every fact of the run carries it. A run a step of the workflow calls carries the workflow's `acts_for` in its own context. `get_run` and the `run_started` event show it as `acts_for`, the person's id, such as `person:user_7kLm2`.
- **What it grants.** Nothing. The run's permissions are the playbook's, as today. `acts_for` is read for two things alone: the party of a sign-in request, and the person a host signs into the run's tool calls.
- **How a host reads it.** A host that signs each tool call for its organization and person, as hosted Auto does for its browser connection, takes the person from the run's context: its caller where that is a person, and its `acts_for` otherwise. The runtime never puts the person in a tool call's arguments or metadata, and a browser connection never takes a person from them: a model or an agent writes the arguments, and only what the host signs names a person.

For example, Priya saves version 4 of `weekly-stock-check`, which runs at 09:00 every weekday and calls a sign-in function. Its runs act for Priya, use Priya's sign-ins and ask Priya to sign in. Sam then saves version 5 to change a prompt. From then on its runs act for Sam.

## The sign-in function (new)

A sign-in function is an interaction function whose document has `sign_in`. It is a fourth shape beside the three [Interaction function format](../../reference/interaction-format.md) sets out: it asks the person a run acts for to sign in. Its run asks the browser connection named in `sign_in` whether that person is signed in to the site. When they are not, it asks them, and waits until they have.

This document asks the person in Studio and through their agent, and waits up to a day:

```markdown
---
description: Makes sure the person the stock check runs for is signed in to the supplier portal
sign_in:
  server: browser
  site: portal.supplier.example
  if_signed_out: ask
expires: P1D
deliver: agent
---

The weekly stock check reads your open orders on the supplier portal, and you're not signed in there.
```

The same function, asking in the person's own direct messages of a chat in place of `deliver: agent`:

```yaml
deliver:
  server: chat
  tool: post_message
  with:
    channel: D07Q2KX9B
    text: '{{ message }}'
```

And one that never waits, for a run that should stop at once when the person is not signed in:

```markdown
---
description: Stops the nightly reconciliation when nobody is signed in to the bank portal
sign_in:
  server: browser
  site: online.bank.example
  if_signed_out: fail
---
```

### Its fields

| Field                   | Purpose                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sign_in.server`        | Required. The browser connection, as `search` names it, whose server offers `browser_sign_in`                                                                                                                                         |
| `sign_in.site`          | Required. The site's host name, such as `portal.supplier.example`, written as text and never as a template: lower case, without a scheme, a path or a port, at most 253 bytes. The person signs in at `https://` followed by it       |
| `sign_in.if_signed_out` | Required. `ask`: ask the person and wait for them. `fail`: end the run at once when they are not signed in                                                                                                                            |
| `expires`               | With `ask`, required; with `fail`, refused. How long a run waits for the person, an ISO 8601 duration from one minute to thirty days, as for every request                                                                            |
| `deliver`               | With `ask`, required; with `fail`, refused. How the request reaches the person: `agent`, or the sending tool of a connection, as for every request. A sign-in reads no replies, so any connection with a tool that sends can carry it |
| The body                | With `ask`, required; with `fail`, refused. The message, a template that reads `input`, `today` and `now`, as for every request. The run adds the link where the person signs in, on a line of its own after it                       |
| `input.schema`          | Optional, as for every function                                                                                                                                                                                                       |
| `description`, `page`   | Optional, as for every function                                                                                                                                                                                                       |

`to`, `from`, `replies`, `reply`, `call` and `output.schema` are refused beside `sign_in`, with their line:

- The party is always the person the run acts for, so `to` and `from` would name someone else.
- The answer comes from the person signing in, never from a reply, so `replies` and `reply` have nothing to read.
- The output is always `{ "signed_in": true }`, so the function publishes that as its `output_schema` and takes none of its own.

`deliver.with` reads what it reads for every request. Its `to` is the person's id, which no chat knows, so a delivery through a connection names the person's own conversation as written, such as `channel: D07Q2KX9B` above. The agent asks the person for it while it builds the function. When someone else saves the workflow later, its runs act for them, and the conversation still names the person before. The link in the message opens only for the person the request waits on, so nobody else can sign in from it, and the request is listed for the right person in Studio and in the activity. So an agent that saves such a workflow for another person asks them where to reach them, and saves the sign-in function again with their answer.

## A run of it

A run of a sign-in function, in order:

1. It checks its input against `input.schema`, as every run does.
2. It finds the person it acts for. With none, or one who has left the organization, it ends at once `rejected` as `unanswered`, kind `no_person`, and sends nothing.
3. It checks that the server serves the playbook and lists `browser_sign_in`, and that the operator allows it and, with `ask`, the tool of `deliver`. Otherwise it ends `unavailable`, kind `tool_not_offered`, and sends nothing, as a function with `call` does.
4. With `ask`, it renders the message and the arguments of `deliver`, and works out when the request expires. A message or an argument that does not render ends it as it ends any request, before anything is sent.
5. It calls `browser_sign_in` once, recorded as `tool_call_started` and `tool_call_answered`, as a function's call is. With `ask` the call gives the site, the address of the request and when it expires. With `fail` it gives the site and `ask: false`.
6. When the answer is `{ "signed_in": true }`, the run succeeds at once with the output `{ "signed_in": true }`. Nothing is asked.
7. When the answer is `{ "signed_in": false }` and the document says `fail`, the run ends `rejected` as `unanswered`, kind `signed_out`.
8. When the answer is `{ "signed_in": false, "link": ... }`, the run makes its request and waits, as the next section sets out.

A call that does not finish ends the run as a function's call does, with one difference. A failure before the call is sent is `tool_server_failed` or `tool_not_offered`. A failure after it is sent is `unavailable`, kind `tools_unfinished`, whatever the tool's mark, since a second call for the same person and site changes nothing (**new**: the mark alone decides this for every other call). An answer that is neither shape ends the run `conflict`, kind `unworkable`.

## While the run waits

The run defers with its request, in the one shape every request has, with these values:

| Field of the request | Value                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `to` and `answerer`  | The person the run acts for, by id, such as `person:user_7kLm2`                              |
| `message`            | The rendered body, then a blank line, then the link `browser_sign_in` answered               |
| `answer_schema`      | `{ signed_in: boolean, reason?: string }`, `reason` at most 500 characters, and nothing else |
| `expires_at`         | The moment the call gave as `until`                                                          |
| `deliver`            | As the document writes it                                                                    |
| `sign_in`            | **New**: `{ server, site, link }`                                                            |

While it waits:

- The run is `started`, and waits without using server resources or holding a browser. The call of `browser_sign_in` has ended, and no browser is open for the request. The browser connection opens one only when the person opens the link.
- A request delivered through a connection is attempted as every request is. One held for an agent is held.
- `list_interactions` lists the request, and the organization's activity lists it as a `needs_you` row that waits on the person ([The activity](#the-activity-and-the-listing)).
- A workflow's step that called the function waits for it up to its `expires` and one minute more, across a restart, as it waits for any request.
- `cancel_run` cancels it, and so does the workflow that waited for it running out of time or ending first, as for any request. The link then has nothing left to answer, and a sign-in the person finishes after that is still kept for them.

### When the person opens the link

On hosted Auto, the link leads to Studio, where the browser connection opens a fresh browser at the site and hands it to the person in a live view. The person signs in there, with whatever the site asks, such as a code or a check that they are not a bot. The agent and the runtime see none of it.

When the person has signed in, the browser connection keeps the sign-in for that person alone, sealed, and closes the browser. Studio then answers the request `{ "signed_in": true }` with `answer_interaction`, as the person, from their own session. That is the only way a sign-in request is answered `signed_in: true`.

When the person says they could not sign in, Studio answers `{ "signed_in": false, "reason": ... }`, with the reason the person writes on Studio's page, if any.

A hand-off has a limit of its own once it is open: 30 minutes on hosted Auto. A hand-off that reaches it without an answer answers nothing. The person can open the link again for a fresh browser while the request is open, so the playbook's `expires`, not the hand-off's limit, decides how long a run can wait.

### How the run goes on

The run takes the answer within about a second, as it takes any answer:

- `{ "signed_in": true }`: it succeeds with the output `{ "signed_in": true }`. A workflow's next step runs, and when its function calls the browser, the browser connection opens a new browser for that run and restores the person's sign-in to the site.
- `{ "signed_in": false }`: it ends `rejected` as `unanswered`, kind `declined`, its detail naming the site and the person's reason. This is **new**: an answer settles the run of every other request as `succeeded`.

## How it is answered

`answer_interaction` answers a sign-in request as it answers any request, with two rules more (**new**):

- Only the person the request waits on may answer it. Any other caller is refused `forbidden`, in words that say a sign-in is answered by the person it asks. So a colleague, a key or a playbook cannot say that someone else signed in.
- `{ "signed_in": true }` is taken only from that person's own session, the token Studio signs in with, which names no client. Through an agent's token, which names the agent's client, it is refused `forbidden`, in words that say the person signs in through the link. The runtime tells the two apart by the caller's `client`, as it reads a token today: an access token issued to a client names that client, and a session names none (`clientOf`, `packages/identity/src/tokens/token-verification.ts`). A host that signs callers in for the runtime passes the client the same way.

So Studio answers `{ "signed_in": true }` once the sign-in in the live view has completed, and nothing else can. The person's own agent may answer `{ "signed_in": false }`, with a reason, when the person tells it they will not sign in. In local mode every caller is the local developer and no token names a client, so the runtime cannot tell Studio from an agent there, and takes either answer from the local developer.

Every other rule of an answer holds: the same answer again returns the fact the run took, a different one is `conflict`, and so is an answer to a request that has ended.

## What the function and the workflow see

| How the run of a sign-in function ends                                                                  | When                                                                              | In a workflow                                        |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `succeeded`, output `{ "signed_in": true }`                                                             | The person was signed in already, or signed in while it waited                    | The step's output                                    |
| `rejected` as `unanswered`, kind `expired`                                                              | Nobody answered before the request expired, as for every request                  | `https://on.auto/problems/unanswered`, status 410    |
| `rejected` as `unanswered`, kind `declined`                                                             | **New**: the person answered that they did not sign in                            | The same type and status, with the kind `declined`   |
| `rejected` as `unanswered`, kind `signed_out`                                                           | **New**: the person is not signed in, and the document says `if_signed_out: fail` | The same type and status, with the kind `signed_out` |
| `rejected` as `unanswered`, kind `no_person`                                                            | **New**: the run acts for no person, or its person has left the organization      | The same type and status, with the kind `no_person`  |
| `rejected` as `cancelled`                                                                               | The run was cancelled, as for every request                                       | `https://on.auto/problems/cancelled`, status 409     |
| `unavailable`, `tool_not_offered`, `tools_unfinished` or `tool_server_failed`; `conflict`, `unworkable` | The browser connection could not be asked, as for a function's call               | As for a function's call                             |

Every way of not being signed in is the one type a workflow already knows for a request that gets no answer, `unanswered`. So the playbook decides, as it decides for any request:

- A workflow that does not catch it fails: it ends `rejected` as `unanswered`, with the kind that says why, and the steps that use the site never run.
- A workflow that catches it carries on without the sign-in. A step that then uses the site meets it signed out, and the workflow can tell that step so through its input.

This workflow carries on without the sign-in and tells the next step:

```yaml
do:
  - sign-in:
      try:
        - ask:
            call: run_definition
            with:
              type: interaction
              name: supplier-portal-sign-in
      catch:
        errors:
          with: { type: https://on.auto/problems/unanswered }
        do:
          - signed-out: { set: { signed_in: false } }
  - check-orders:
      call: run_definition
      with:
        type: reasoning
        name: check-open-orders
        input: { signed_in: '${ $data.signed_in }' }
```

## The browser connection's `browser_sign_in`

The runtime asks the browser connection through one tool, `browser_sign_in`. Any server that offers it with this contract can carry a sign-in function. Hosted Auto's browser connection offers it, marked `acts`. A server that does not offer it, such as a browser an operator runs with no sign-in tool, serves no sign-in function: its runs end `tool_not_offered`.

Its arguments:

| Argument  | Given by                       | Holds                                                                                                                                                                  |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site`    | Every call                     | The site's host name, as `sign_in.site` writes it                                                                                                                      |
| `request` | A run of a sign-in function    | The address of the request, `<playbook>/<run_id>`, as [Addresses](../../reference/addresses.md) gives it, so that the request can be answered once the person signs in |
| `until`   | A run of a sign-in function    | When the request expires, in ISO 8601 UTC. The link lasts until then, and is refused after                                                                             |
| `ask`     | Optional, `true` when left out | `false` asks only whether the person is signed in, and makes no link                                                                                                   |

Its answer, as structured content:

| Answer                                                    | When                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `{ "signed_in": true }`                                   | A sign-in to the site is kept for the person the call acts for                            |
| `{ "signed_in": false }`                                  | None is kept, and the call gave `ask: false`                                              |
| `{ "signed_in": false, "link": "https://…", "until": … }` | None is kept: the person signs in at `link`, until `until`                                |
| A tool error                                              | The call acts for no person, and so may not sign anyone in. A run never makes such a call |

What the connection holds to:

- The person is the one the host signed into the call, never one the arguments name.
- `link` opens the hand-off only for the person it was made for, signed in as themselves, and refuses anyone else. So it is not a secret, and the runtime records it and shows it as it shows any message.
- A second call for the same person and site, while a link is open, answers the same link and adds its `request` to it. So two runs that need the same site wait on one sign-in, and a call made again after a failure starts nothing new.
- The connection keeps the `request` of each call with the hand-off. Once the person signs in, each of those requests still open is answered `{ "signed_in": true }`, as the person, from their own session: on hosted Auto, by Studio's page. Once they say they could not, each is answered `{ "signed_in": false }`, with their reason.
- Nothing of the hand-off is ever answered to a call: not the live view, not what the person typed, not the page while the person had it, and not the cookies or the storage it keeps. Those are restored only into a later browser that acts for the same person.

An agent's own call of `browser_sign_in`, through `execute_connection`, gives `site` alone. It answers at once, and the agent gives the person the link. No request waits on it, so the agent calls it again to see that the person has signed in.

## The activity and the listing

A sign-in request is a request, so it is listed where every request is, with these changes:

- **`waits_on` (new).** A request whose party is a person's id, `person:` and an id, waits on that person: its `needs_you` row holds that id in `waits_on`. A sign-in request's party is always one. The rule for a party that holds an `@`, and for any other party, is unchanged.
- **Counted for the caller (new).** A request waits on the caller when its `waits_on` is `any_member` or the caller's own id. So `needs_you` counts a sign-in request for the person it asks, and for nobody else. In local mode every request still waits on the local developer.
- **`sign_in` (new).** `list_interactions` and the `needs_you` row give a sign-in request's `{ server, site, link }` as `sign_in`, and `null` for every other request. Studio shows a Sign in control there in place of the answer controls, for the person it waits on.
- **`acts_for` (new).** `get_run` gives a triggered run's `acts_for`. The activity's `by` stays who started the run, `playbook:` and its id for a triggered run.

## What the history records

The run's history holds the facts every request's run holds, and no new ones:

1. `tool_call_started` and `tool_call_answered` for the call of `browser_sign_in`, with the site, the request's address and its expiry, and the answer: whether the person is signed in, and the link. The arguments and the answer are kept as every call's are, unless the operator turns `record_content` off.
2. `interaction_requested`, with the party, the delivery, the size of the message and the expiry.
3. The delivery attempts, for a request delivered through a connection.
4. `request_answered`, with `{ "signed_in": true }`, `answered_by`, the person, and `answered_at`. That is the record that the person signed in to the site, and when.
5. The run's end.

Nothing from the hand-off reaches the history, because nothing from it reaches the runtime: the browser connection answers none of it, and Studio's answer holds `signed_in` and, at most, the reason the person wrote on Studio's page.

## Agreed while building

When the agent builds a playbook that uses a site behind a sign-in, it asks the person three things, and writes each answer into the sign-in function:

| The agent asks                                                           | Written as                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Wait for the person to sign in, or stop at once?                         | `sign_in.if_signed_out`: `ask` or `fail`                                             |
| Where to reach them: Studio, their agent, or a connection such as a chat | `deliver`: `agent`, or a connection's sending tool and the person's own conversation |
| How long a run waits                                                     | `expires`                                                                            |

`deliver: agent` reaches the person in both Studio and their agent: Studio lists every request, and their agent reads it with `list_interactions`.

`create_definition` and `update_definition` refuse a sign-in function that leaves out an answer, as they refuse a request with no `deliver` today, with the line of the field and words that say what to ask. To a client that answers forms, the server asks the person first, one question at a time, and the agent writes the answer. The questions for `if_signed_out` and `expires` are **new**: today a request without `expires` is refused without one.

| Missing         | The question                                                    | Choices                                                                                 |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `if_signed_out` | When you're not signed in to {site}, should a run wait for you? | Wait for me to sign in (`ask`), Stop at once (`fail`)                                   |
| `deliver`       | Where should a run ask you to sign in to {site}?                | Each connection with a tool that sends, by its name, and Studio or your agent (`agent`) |
| `expires`       | How long should a run wait for you to sign in to {site}?        | An hour (`PT1H`), A day (`P1D`), A week (`P7D`)                                         |

The words are planned copy, to be checked by the voice review when they ship.

The agent also tells the person that the workflow's scheduled and event-started runs act for whoever saves it, so saving it makes those runs use that person's sign-ins.

### Sign in ahead

Once the function is saved, the agent offers to sign the person in there and then, so the first scheduled run starts signed in. It calls the browser connection's `browser_sign_in` with `execute_connection` and the site, once the person agrees. The answer is `{ "signed_in": true }`, or a link the agent gives the person, who then signs in through Studio as for a run's request. The sign-in is the person's, so a triggered run uses it when it acts for them.

## A function that meets a sign-in on its own

A reasoning function whose `tools` name `browser_sign_in`, such as through `browser/*`, may call it as an agent does. It answers at once. A reasoning run never waits for a person, so the model gets the link and nothing more, and the run cannot take an answer. So a playbook asks for a sign-in in a sign-in function before the step, and keeps the reasoning function for using the site.

A saved sign-in the site has since ended reads as signed in to `browser_sign_in`, since the connection learns that a site ended a sign-in only when a page shows it. The function using the site then meets the site's sign-in page.

## Bounds

| Bound                                 | Value                                                                 | When it is reached       |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------ |
| `sign_in.site`                        | A host name of at most 253 bytes, lower case, no scheme, path or port | Refused when saved       |
| Calls of `browser_sign_in` in one run | 1, within 70 seconds, as for a function's call                        | Not applicable           |
| `expires`                             | 1 minute to 30 days, as for every request                             | Refused when saved       |
| `reason` of an answer                 | 500 characters                                                        | `invalid_input`          |
| The rendered message, with the link   | 8 KiB, as for every request                                           | `conflict`, `unworkable` |

## Decided

Four questions this design raised were decided before the code, and the sections above follow them:

- **Not being signed in is `unanswered`.** Every way a sign-in does not come is a kind of `unanswered`, status 410: `expired`, `declined`, `signed_out` or `no_person`. One `catch` covers them all, and an expiry is settled as every request's is. There is no new reason.
- **Only the hand-off answers `signed_in: true`.** Studio answers each open request, as the person, when the sign-in in the live view has completed. The person's agent may answer `signed_in: false`, never `true`.
- **A person who has left acts for nobody.** A triggered run whose `acts_for` person has left the organization acts for no person, since their saved sign-ins are gone with them. Its sign-in request ends `no_person`, so the function is told it is not signed in, and the workflow fails or carries on as the playbook says.
- **A restore counts as a save.** Whoever restores a version becomes the person its triggered runs act for, since a restore puts that version in place.

## Where each part is built

| Part                                                                                                                             | Where                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acts_for` on a triggered run, carried by the runs its steps call                                                                | `@on.auto/workflow-host`, whose trigger rows keep the record that set them going; `@on.auto/server`, which starts a triggered run as the playbook (`src/workflows/reaction-dependencies.ts`); and the run context of `@on.auto/operations` and `@on.auto/definitions` |
| The sign-in function: its document, its run, its request, the settling of `declined`                                             | `@on.auto/interaction`                                                                                                                                                                                                                                                |
| `waits_on` by id, the count for the caller, `sign_in` on the rows                                                                | `@on.auto/activity`                                                                                                                                                                                                                                                   |
| Only the person answers a sign-in request, and `signed_in: true` only from their session; the refusals and the questions at save | `@on.auto/interaction` and `@on.auto/api`                                                                                                                                                                                                                             |
| Whether a person is still a member of the organization                                                                           | A port the host fills (**new**): hosted Auto from the organization's members; a runtime that keeps no list of members takes every signed-in person as one                                                                                                             |
| `browser_sign_in`, the hand-off and the kept sign-ins                                                                            | Hosted Auto's browser connection, outside this repository                                                                                                                                                                                                             |
| The sign-in page, the Sign in control and answering for the person                                                               | Studio, outside this repository                                                                                                                                                                                                                                       |
| The person a host signs into a run's tool calls                                                                                  | Hosted Auto, which reads `acts_for` from the run's context                                                                                                                                                                                                            |

A change to a fact's shape or to a table ships with the reader or the layout step for the shape before, pinned by a fixture, as [the ledger's rule](../../../packages/ledger/README.md#the-layout-of-the-ledger) requires: the run context's `acts_for` and the request's `sign_in` are each optional, so a fact recorded before them reads as having none.

## Reference pages each part changes

| Page                                                                 | What it will say                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Interaction function format](../../reference/interaction-format.md) | The fourth shape, its fields, its run, its endings and its history                                               |
| [Workflow format](../../reference/workflow-format.md)                | A triggered run's `acts_for`, and the sign-in step before the steps that use a site                              |
| [HTTP API](../../reference/http.md)                                  | `waits_on` by id, `sign_in` on a request and an activity row, `acts_for` on a run, and the new kinds and refusal |
| [MCP reference](../../reference/mcp.md)                              | The three questions at save, the forms that ask them, and signing in ahead                                       |
| [Terminology](../../concepts/terminology.md)                         | The sign-in request, and whom a run acts for                                                                     |
| [Functions](../../concepts/functions.md#availability)                | Signing in during a run leaves the planned list once the last part ships                                         |

The interaction function format, the workflow format, the HTTP API, the MCP reference and the terminology describe it as it is built, and [Functions](../../concepts/functions.md#availability) no longer lists it among the planned features. The workflow format has none: the runtime serves it to agents as a guide, and a guide holds at most 64 KiB (`mostGuideBytes` of `@on.auto/api`). Measured on 4 November 2026, the workflow guide had 262 bytes left and the interaction guide about 11 KiB, so the part that changes the workflow format makes room in it first.
