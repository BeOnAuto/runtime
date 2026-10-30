---
search: false
head:
  - - meta
    - name: robots
      content: noindex, follow
---

# Add a tool server

A tool server is a service or program that offers tools for a function to call. Its tools might read files, search the news or look up records in a business system. A tool server comes from one of two places: Auto's settings file, which this page is about, or a connection a person adds to an org through their agent, which [Let people add connections](connections.md) describes. A function names either in the same way.

This page is for whoever runs Auto. You add the server to Auto's settings file, restart Auto and check that Auto lists the server. After that, people give its tools to their functions through their agents, as [Give a function tools](../guides/tools.md) shows.

## Before you start

- Auto Runtime runs on a machine where you can stop it and start it again. You add the server to a settings file in the directory you start it in. The [quick start](../get-started/local.md) sets it up.
- Your agent runs terminal commands, as Claude Code and Codex do, so it can edit the settings file for you. If it cannot, you edit the file yourself.
- For a remote server, you have its address and a key for it.
- You know which playbooks should use the server. People who ask for a server can send the request in [Ask for a tool server](../guides/tools.md#ask-for-a-tool-server), which names them.

## Decide what the server may do

A tool server is added as an entry in Auto's settings, and one entry can serve many playbooks. An entry is one of three kinds:

| Kind                                         | Use it when                                                       | The entry names                       |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| A remote MCP server                          | The service offers an MCP address, as many business systems do    | `url`, and the key in `headers`       |
| An MCP server that Auto starts as a process  | The server is a program you install, such as one that reads files | `command`, with `args` and `env`      |
| An HTTP API described by an OpenAPI document | The service has an API with an OpenAPI document but no MCP server | `document`, and the key in `security` |

A remote server needs nothing installed. A process runs on the machine that runs Auto, so under Docker it must be installed in the image; [Run a server as a process](configuration.md#run-a-server-as-a-process) has the rules. A service Auto knows as a provider needs none of these fields: the entry names the provider, as [Name a provider](#name-a-provider) shows.

Then decide three things for the entry:

- Which tools a function may call, listed in `allowed`. Without `allowed`, a function may name every tool of the server, including any that write, send or delete. When a function's job is to read, allow only tools that read; no function can then change anything through that server, whatever its prompt says. Allow a tool that writes only when a function must write, and name that tool alone. Auto counts a tool as read-only only when its server marks it so.
- Who may use it. `org` is required: one organization (org), a list of orgs, or `'*'` for every org. `playbooks` narrows the entry to some playbooks of each org. Limit it to your org and the playbooks that need the server. The entry has one key, and every playbook it serves calls the server with that key.
- What the history keeps. Every call's arguments and results are kept whole in the playbook's history, scrubbed of secrets, for anyone who may read the playbook. The secrets are the values your references take, a header's credential after its scheme among them, so a key an `Authorization: ${GRAPH_HEADER}` of `Bearer <key>` sends is scrubbed alone too, and the credentials of `auth`, as the [configuration reference](configuration.md#tool-servers) lists them. If those readers should not see what the tools return, set `record_content: false`, and the history keeps only the sizes.

## Find the org and playbook ids {#find-the-org-and-playbook-ids}

An entry names its org and its playbooks by their ids. Your agent can look both up when it writes the entry in step 1, or you can ask it first:

```text
Find the id of my "<playbook name>" playbook in Auto, and the id of the org it
belongs to.
```

Where the ids come from:

- In [local mode](security.md#local-mode), which `npx @on.auto/runtime` runs in until you set `PUBLIC_URL` or `API_KEYS`, the org is `local`. With sign-in on, your org is the organization you signed in to, and its id is that organization's id ([Organizations](security.md#organizations)).
- No tool returns the org id on its own. Every event a playbook records names it: each event's `metadata.stream` begins `playbook/<org>/<playbook>/`.
- Every playbook in your org names the same org, so any of them will do. A new playbook lists no events until something is recorded in it, such as a saved definition. In an org where nothing is recorded yet, neither place shows the org until someone saves a first definition.
- `list_playbooks` returns the id of each playbook.

## 1. Add the server to `auto-runtime.yaml`

Auto Runtime reads its tool servers from a settings file, `auto-runtime.yaml`. Create `auto-runtime.yaml` in the directory you start Auto Runtime in, the one that holds `.env`, or open it if it is already there. Your agent can do this for you.

First find the names of the tools functions need, as the server lists them. A service usually lists its MCP tools in its documentation. If yours does not, leave `allowed` out of the prompt for now. The entry still serves only your playbook, and a function calls only the tools it names. [Step 4](#check-that-auto-lists-the-server) then lists the tools, and you add `allowed`.

Ask your agent:

```text
In the directory I start Auto Runtime in, add a tool server to auto-runtime.yaml
for <the service, such as our news search>, at <the server's address>. Limit it
to my org and my "<playbook name>" playbook, and allow only these tools: <the
tools functions need, such as news_search>. Name the environment variable that
will hold its key; I will put the key in .env myself. Show me the entry before
saving it.
```

The agent looks up your org's id and your playbook's id, as [Find the org and playbook ids](#find-the-org-and-playbook-ids) describes. It adds an entry under `tool_servers`. For example, for a remote news search server that it names `search`, in the org `acme` and the playbook `marketing`:

```yaml
tool_servers:
  search:
    url: https://search.example.com/mcp
    headers:
      Authorization: Bearer ${SEARCH_API_KEY}
    org: acme
    playbooks: [marketing]
    allowed: [news_search]
```

Check the entry:

- `search` is the server's name. A function writes it before the slash when it names a tool, as in `search/news_search`. A name is 1 to 32 lowercase letters, digits and hyphens, starting with a letter.
- `url` is the server's address, in place of the example one.
- The `Authorization` header names the environment variable that holds the key, written `${NAME}`. Auto reads the variable when it starts.
- `org` and `playbooks` hold your own org's id and your playbook's id, in place of `acme` and `marketing`. No other playbook can use the server.
- `allowed` names each tool a function may call, as the server lists it, without the server's name.

::: details Let every org or every playbook use the server

On an Auto only you use, you can let every org use the server with `org: '*'`. Write the quotes, because YAML reads a bare `*` as a reference to another part of the file (an alias). Leave out `playbooks` to let every playbook of those orgs use it. Keep `allowed` either way, so that functions can call only the tools you chose.

:::

A server that runs as a process names a `command` instead of a `url`; [Example: a folder of briefs](#example-a-folder-of-briefs) shows one. [`auto-runtime.example.yaml`](https://github.com/BeOnAuto/runtime/blob/main/auto-runtime.example.yaml) shows every other setting. The [configuration reference](configuration.md#tool-servers) lists every field of an entry, for an HTTP API too.

## 2. Put the key in `.env`

Put the key in `.env` yourself, under the variable the entry names, such as `SEARCH_API_KEY=` followed by the key. Never paste a key into a prompt. The key never goes in `auto-runtime.yaml`; the file only names the variable that holds it. A value in the file that looks like a key stops Auto at start, and so does a `${SEARCH_API_KEY}` whose variable is not set. A server that needs no key skips this step.

::: details If you run Auto Runtime with Docker

The image reads a settings file only when `CONFIG_FILE` names it. Mount `auto-runtime.yaml` into the container read-only, set `CONFIG_FILE` to its path inside, and put the key in the env file you pass with `--env-file`. [Use a configuration file](docker.md#use-a-configuration-file) shows the command.

:::

## 3. Restart Auto

Auto reads `auto-runtime.yaml` when it starts. Stop it with Ctrl+C and start it again in the same directory, the way you started it before:

```bash
npx @on.auto/runtime
```

Check that it starts. If it stops instead, the message names the file, the line, the column and the key at fault; see [If something goes wrong](#if-something-goes-wrong). Started with `npx`, Auto logs only errors. To see which settings it read, start it with `LOG_LEVEL=info npx @on.auto/runtime` instead; its log at start then names the file and `TOOL_SERVERS`.

Auto does not connect to a server, or start its process, until a run or a listing first needs it. So a wrong address or a missing program shows up in the next step, not at start.

## 4. Check that Auto lists the server {#check-that-auto-lists-the-server}

Ask your agent:

```text
Using Auto's search tool, list the tool servers my "<playbook name>" playbook
may use, with their tools. Tell me which tools only read.
```

Check that the agent reports your server with its tools, and which of them have `read_only: true`. A server that cannot be used is shown as unavailable, with a `because` field that says why.

If you left `allowed` out, have the agent add it now with the tools functions need, and restart Auto. `search` then lists only those tools.

Then tell whoever asked for the server that it is ready. They give its tools to a function as [Give a function tools](../guides/tools.md) shows.

## Name a provider {#name-a-provider}

Auto knows some services by name, as providers: those it ships, which [Let people add connections](connections.md#the-providers-auto-ships) lists, and any you add under `connections.providers`, as [Add providers of your own](connections.md#add-providers-of-your-own) shows. An entry may name one in place of its server. The provider gives the server's address and type, its headers and where the key goes, and the entry gives the rest:

```yaml
tool_servers:
  code:
    provider: github
    credential: ${GITHUB_TOKEN}
    org: acme
    playbooks: [marketing]
  accounts:
    provider: crm
    placeholders:
      tenant: acme
    credential: ${CRM_API_TOKEN}
    org: acme
    allowed: [search_accounts]
```

- `provider` is the provider's name.
- `placeholders` gives the values the provider asks for, such as the tenant in its address, each written out as the provider's pattern takes it. A value never holds a reference: `tenant: ${TENANT}` stops Auto at start, at that value.
- `credential` names the environment variable that holds the key, as `${GITHUB_TOKEN}`, and nothing beside it. Auto places it where the provider says, after the provider's scheme, such as `Bearer`, so the variable holds the token alone. A key written out stops Auto at start, whatever header the provider sends it in. For a provider of client credentials, `credential` gives `client_id`, written out, with `client_secret`, or with `private_key` and its `algorithm`, each key a reference, as `credential: { client_id: acme-books, client_secret: ${BOOKS_CLIENT_SECRET} }`; for a provider that takes no credential, leave it out. The entry takes the provider's first way but `authorization`, a consent a person gives on Studio's page, which this file cannot give, so `code` above takes `github`'s token; `kind` names another way the provider offers, as `credential: { kind: none }`. An entry that names `kind: authorization`, or a provider whose only way it is, such as `slack`, stops Auto at start, and a person connects that provider on Studio's page.
- `org`, `playbooks`, `allowed` and `record_content` are the entry's, as for any entry. The entry holds none of the fields of a server: a `url`, `headers` or `document` beside `provider` stops Auto at start.

A problem stops Auto at start at the line and the key you wrote: a placeholder the provider does not ask for, or one it asks for and the entry leaves out, a value its pattern does not take, a way the provider does not offer, or its way `authorization`. `search` lists the server with `provider` set, and no longer offers that provider for a person to connect in the orgs the entry serves; in any other org, a person may still connect it.

## Example: a folder of briefs

The official MCP filesystem server reads and writes files in the folders it is given. It needs no account and no key. Here it gives functions read-only access to a folder of campaign briefs, kept as text files in a folder named `briefs` in the directory you start Auto Runtime in. Ask your agent to install the server there, pinned to one version, and to add the entry below to `auto-runtime.yaml`.

::: details The install command and the entry

```bash
npm install --save-exact @modelcontextprotocol/server-filesystem@1.0.0
```

Auto will start the program you installed. Do not have it start the server with `npx -y` instead, which would run whatever version the package has on the day it starts.

```yaml
tool_servers:
  files:
    command: ./node_modules/.bin/mcp-server-filesystem
    args: [briefs]
    env:
      PATH: ${PATH}
    org: acme
    playbooks: [marketing]
    allowed: [list_directory, read_text_file]
```

In this entry:

- `command` is the program you installed, and `args` gives it the one folder it may use. The server reads and writes nothing outside `briefs`. Both paths are relative to the directory you start Auto Runtime in.
- `env` is the whole environment of the process, which inherits nothing else. `PATH: ${PATH}` passes on your own `PATH`, so the program finds `node`.
- `org` and `playbooks` limit it to one playbook, as in step 1.
- `allowed` names two of the server's 14 tools. Some of the others write, edit or move files. These two only read, so no function can change a file through this entry.

:::

After a restart, `search` lists `files` with these two tools, each with `read_only: true`. Once a run or a listing first needs the server, a log at `LOG_LEVEL=info` shows what it writes, such as `Secure MCP Filesystem Server running on stdio`.

[Example: review a brief from the folder](../guides/tools.md#example-review-a-brief-from-the-folder) gives one of these tools to a function.

## If something goes wrong

- **Auto stops at start.** The message names the file, the line, the column and the key at fault, never a value. A `${NAME}` whose variable is not set stops it too, with a message such as `Refers to the environment variable SEARCH_API_KEY, which is not set`. Check `.env` in the directory you start in.
- **`search` lists no server.** Auto did not read the file, or the entry does not serve the playbook. Check that `auto-runtime.yaml` is in the directory you start Auto Runtime in, and that the entry's `org` and `playbooks` cover your playbook. Started with `LOG_LEVEL=info`, the log names `TOOL_SERVERS` when it read the file.
- **`search` shows a server that runs as a process as unavailable, because `unreachable`.** The program did not start, or stopped at once. Check that it is installed in the directory you start Auto Runtime in, or in the image under Docker, and that `env` holds `PATH`. With `LOG_LEVEL=info`, the log shows what the program wrote, such as `env: node: No such file or directory` when it has no `PATH`.
- **`search` shows a remote server as unavailable.** Its `because` says why. `key_refused` means the server did not accept the key; check the key in `.env` and restart. `scope_lacking` means the credential lacks a scope the server asks for, which its words name; give the entry a credential granted that scope and restart. `unreachable`, `failing` or `rate_limited` may pass; check the address and try again later.
- **A tool is missing.** The entry's `allowed` leaves it out, or the server does not list it.

## Next

- [Give a function tools](../guides/tools.md) is what the people who use the server do next: find a tool, try it and name it in a function.
- The [configuration reference](configuration.md#tool-servers) covers HTTP APIs, OAuth, and how secrets are kept out of the file and scrubbed from what Auto records.
- [Reasoning function format](../reference/reasoning-format.md#tools) has the rules and limits of a function's `tools`.
- [Use Auto with Apollo](../integrations/apollo.md) adds Apollo GraphOS Agent Services as a tool server.
