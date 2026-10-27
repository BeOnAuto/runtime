---
description: Connect your Zoom account to Auto, use your meetings, recordings and Team Chat in a playbook, and remove the connection when you no longer want it.
---

# Connect Zoom

Connect your Zoom account to Auto, so that the functions in your playbooks can read your meetings, recordings and Team Chat, and create meetings and send chat messages as you. Your agent does the setup. You sign in to Zoom and allow access.

## What you need

- Auto running, with your agent connected to it as you. The [quick start](../get-started/local.md) sets this up on your own computer. On an Auto your team runs, your agent is signed in as you, with permission to change your org; an agent connected with a key cannot add a connection.
- A Zoom account. Auto reaches Zoom at `zoom.us`, so it does not serve a Zoom for Government account.
- For some answers, a paid Zoom plan. Who attended a past meeting, cloud recordings and AI summaries need a Pro plan or higher. Recordings also need cloud recording turned on, and a summary the host's Meeting Summary with AI Companion setting.

You connect as yourself. The connection reaches your own meetings, recordings and Team Chat alone, and each call acts as you: a meeting it creates is yours, and a message it sends is from you. The connection belongs to your org, so a function in a playbook it is for acts in Zoom as you, whoever in your org runs it.

## Add Zoom

1. Ask your agent to connect Zoom:

   ```text
   Connect Zoom to Auto, so that the functions in my "<playbook name>" playbook
   can read my Zoom meetings and recordings.
   ```

   Your agent may ask which playbook the connection is for. Name the playbooks that may use it, or say that every playbook of your org may. A connection that names no playbook is for every playbook of the org.

2. Your agent asks you to open a page of Studio, or gives you its link. The link works for ten minutes. On an Auto that signs people in, only you can use it, signed in as yourself.
3. Check what the page says you are connecting, and press Continue.
4. Zoom asks you to sign in and to allow access. Sign in with your Zoom account and allow it.
5. Zoom sends you back to Studio, which finishes the connection and shows Zoom as connected. Your agent sees it connected too.

If the link runs out before Zoom is connected, ask your agent to reconnect it, for a new link.

### What you see when you allow access

The Zoom app you allow depends on how your Auto is set up:

| How your Auto is set up                                                                                  | What you see                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whoever runs your Auto registered a Zoom app of their own                                                | Zoom asks you to allow their app, and then sends you back to Studio. Their app comes first, even where consent through Auto is on                                                                          |
| They registered none, and [consent through Auto](../self-host/connections.md#consent-through-auto) is on | Zoom asks you to allow Auto, under Auto's name. It then sends you to the hosted Studio, `https://studio.on.auto`, where you sign in to Auto if you have not already, and on to the Studio you started from |
| Neither                                                                                                  | Your agent cannot add Zoom, and says that Zoom takes a client whoever runs Auto registers, which is not set up here. Ask whoever runs your Auto to set one up                                              |

## Use Zoom in a playbook

Once Zoom is connected, ask your agent to give a function in your playbook the Zoom tools it needs, as [Give a function tools](../guides/tools.md) shows. Say what you want done, in your own words:

| A playbook can                                                    | You might ask                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| List your upcoming and past meetings, and who attended a past one | "List last week's client calls and who joined each."                         |
| Read a meeting's details and its AI summary                       | "Summarize the decisions in yesterday's planning meeting, from its summary." |
| List your cloud recordings, and read a transcript's details       | "List the meetings I recorded this month, and say which have a transcript."  |
| Read your Team Chat channels, their messages and threads          | "What did the launch channel agree on today?"                                |
| Create and update meetings                                        | "Set up a 30-minute review next Tuesday at 10, and give me its link."        |
| Send a chat message                                               | "Post the weekly summary in the launch channel."                             |

The `zoom` row of [the providers Auto ships](../self-host/connections.md#the-providers-auto-ships) is the full list of what a function may do with Zoom.

- A function reads a recording's or a transcript's details, not its file: Auto does not fetch the recording or the transcript itself.
- What Zoom answers each call is kept in the playbook's history, for anyone who may read the playbook, as [the connections page](../self-host/connections.md#the-providers-auto-ships-that-take-consent) says. A meeting's answer holds its start link, with which anyone who has it signs in to Zoom as the meeting's host, and its passwords. If you would rather the history keep only the size of each answer, ask your agent to add Zoom that way.

## Remove Zoom

You can remove Zoom in Auto or at Zoom.

### In Auto

In Studio, find Zoom among your org's connections, press Remove and confirm. Or ask your agent:

```text
Remove my Zoom connection from Auto.
```

Auto then asks Zoom to revoke the connection's tokens and forgets them, and no playbook may use the connection any more. If Zoom does not answer, Auto removes the connection all the same, and its tokens end on their own.

### At Zoom

Sign in to the [Zoom App Marketplace](https://marketplace.zoom.us), open Manage, then Added Apps, and remove the app you allowed. Zoom then refuses the connection's tokens, and the next time Auto uses them the connection breaks: Studio shows it as needing attention, with why. To use Zoom again, reconnect it there, or ask your agent to, and sign in to Zoom and allow access again; otherwise remove it.

### What remains

Removing Zoom does not remove what Zoom answered before. The playbook's history keeps what earlier calls answered, for anyone who may read the playbook, for as long as whoever runs your Auto keeps it. Where you allowed Auto's own app, Auto's consent service keeps a line for each time you allowed access, each renewal and each revocation, naming you, Zoom and the Studio you went back to, and no token. It also keeps a line for each notice Zoom sends it that you removed the app, naming your Zoom user and account, the app and the time Zoom gives.

## Get help

- For help with Zoom in Auto, use Auto's [support page](https://on.auto/contact-us).
- Read Auto's [privacy policy](https://on.auto/privacy) and [terms](https://on.auto/terms).
