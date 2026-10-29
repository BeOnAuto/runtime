---
description: Connect your Slack account to Auto, use your messages, channels and threads in a playbook, and remove the connection when you no longer want it.
---

# Connect Slack

Connect your Slack account to Auto, so that the functions in your playbooks can search and read your messages, channels and threads, and send messages and add reactions as you. Your agent does the setup. You sign in to Slack and allow access.

## What you need

- Your agent connected to Auto and signed in as you, with permission to change your org. Follow the [quick start](../get-started/cloud.md) if you have not connected yet. An agent connected with an API key cannot add a connection.
- A Slack account in the workspace you want to connect. Auto reaches Slack at `slack.com` and `mcp.slack.com`.
- If your workspace takes only the apps its owners approve, Slack asks you to request the app, and you allow access once a workspace owner or app manager approves it.

You connect as yourself, through Slack's MCP server. The connection has your access to the workspace: it reads the channels, conversations and people you can see, and a message it sends is from you. The connection belongs to your org, so a function in a playbook it is for acts in Slack as you, whoever in your org runs it.

This page is about the `slack` provider, which acts as you, the person who connects. The `slack-bot` provider acts instead as the bot of a Slack app installed in your workspace, and connects with that app's bot token, as [the providers Auto ships](../self-host/connections.md#the-providers-auto-ships) lists.

## Add Slack

1. Ask your agent to connect Slack as you:

   ```text
   Connect my own Slack account to Auto, so that the functions in my
   "<playbook name>" playbook can search and read my Slack messages.
   ```

   Your agent may ask which playbook the connection is for. Name the playbooks that may use it, or say that every playbook of your org may. A connection that names no playbook is for every playbook of the org.

2. Your agent asks you to open a page of Studio, or gives you its link. The link works for 24 hours. On an Auto that signs people in, only you can use it, signed in as yourself.
3. Check what the page says you are connecting, and press Continue.
4. Slack asks you to sign in, if you are not signed in already, and shows the workspace you are connecting; you can switch to another there. Check that it is the workspace you mean, and allow access.
5. Slack sends you back to Studio, which finishes the connection and shows Slack as connected. Your agent sees it connected too.

If the link runs out before Slack is connected, ask your agent to reconnect it, for a new link.

### What you see when you allow access

The Slack app you allow depends on how your Auto is set up:

| How your Auto is set up                                                                                  | What you see                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whoever runs your Auto registered a Slack app of their own                                               | Slack asks you to allow their app, and then sends you back to Studio. Their app comes first, even where consent through Auto is on                                                                          |
| They registered none, and [consent through Auto](../self-host/connections.md#consent-through-auto) is on | Slack asks you to allow Auto, under Auto's name. It then sends you to the hosted Studio, `https://studio.on.auto`, where you sign in to Auto if you have not already, and on to the Studio you started from |
| Neither                                                                                                  | Your agent cannot add Slack, and says that Slack takes a client whoever runs Auto registers, which is not set up here. Ask whoever runs your Auto to set one up                                             |

## Use Slack in a playbook

Once Slack is connected, ask your agent to give a function in your playbook the Slack tools it needs, as [Give a function tools](../guides/tools.md) shows. Say what you want done, in your own words:

| A playbook can                                                                            | You might ask                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Search messages in public and private channels, direct messages and group direct messages | "Find what the team said about the spring price change this month."                       |
| Read a channel's history and a thread                                                     | "Summarize yesterday's thread in the support channel about the delayed order."            |
| Look up people and channels                                                               | "Find the channel about the trade show, and the job titles of the people who post there." |
| Send a message                                                                            | "Post the weekly summary in the marketing channel."                                       |
| Add a reaction                                                                            | "Add a check mark to each question in the support channel we answered today."             |

The `slack` row of [the providers Auto ships](../self-host/connections.md#the-providers-auto-ships) is the full list of what a function may do with Slack.

What Slack answers each call, the messages a function reads among it, is kept in the playbook's history, for anyone who may read the playbook, as [the configuration reference](../self-host/configuration.md#fields-of-an-entry) says of every tool server. Someone who may read the playbook can then read messages from your private channels and direct messages that Slack would not show them. If you would rather the history keep only the size of each answer, ask your agent to add Slack that way.

## Remove Slack

You can remove Slack in Auto or at Slack.

### In Auto

In Studio, find Slack among your org's connections, press Remove and confirm. Or ask your agent:

```text
Remove my Slack connection from Auto.
```

Auto then forgets the connection's tokens, and no playbook may use the connection any more. What Slack publishes for signing in to its MCP server names no address that revokes a token, so Auto does not ask Slack to revoke them, and your authorization of the app stands at Slack until you revoke it there, as below.

### At Slack

To revoke your own authorization, in Slack on your desktop:

1. Click your workspace name in the sidebar.
2. Select Tools & settings, then Manage apps.
3. Select Installed apps, find the app you allowed and click App details.
4. Open the Configuration tab. Under Authorizations, find Authorized members, click See all and Revoke.

To remove the app for the whole workspace instead, choose Remove app on the same Configuration tab. Where app approval is on, only workspace owners and app managers can remove apps. Slack's help on [removing apps](https://slack.com/help/articles/360003125231-Remove-apps-and-custom-integrations-from-your-workspace) has the steps.

Either way, Slack then refuses the connection's tokens, and the functions that use the connection can no longer reach Slack. A connection cannot be mended, so remove it in Auto too, as above, and add Slack again to use it again.

### What remains

Removing Slack does not remove what Slack answered before. The playbook's history keeps what earlier calls answered, for anyone who may read the playbook, for as long as whoever runs your Auto keeps it. Where you allowed Auto's own app, Auto's consent service keeps a line for each time you allowed access, each renewal and each removal, naming you, Slack and the Studio you went back to, and no token. It also keeps a line for each notice Slack sends it that the app was removed or its tokens revoked, naming the workspace, the Slack members and the time Slack gives.

## Get help

- For help with Slack in Auto, use Auto's [support page](https://on.auto/contact-us).
- Read Auto's [privacy policy](https://on.auto/privacy) and [terms](https://on.auto/terms).
