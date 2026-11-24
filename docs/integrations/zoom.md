---
description: Connect Zoom to Auto as yourself or for your company's whole Zoom account, use meetings, recordings and Team Chat through your agent, fix what goes wrong, and remove the connection.
---

# Connect Zoom

Connect Zoom to Auto, so that the functions in your playbooks can read meetings, recordings and Team Chat, and create meetings and send chat messages. You add Zoom from Studio, or ask your agent to. You connect your own Zoom account, or your company's whole Zoom account through an app, as [Choose how to connect](#choose-how-to-connect) sets out.

## What you need

- An Auto account in an organization. On Auto Cloud, Studio asks you to sign in or create an account when you open the link under [Add Zoom](#add-zoom). It also asks you to create an organization if you belong to none.
- On Auto Cloud, Zoom offered to you in Studio. Studio offers Zoom to everyone once Zoom has reviewed the app Auto. Until then, the Connections page may show you no Zoom tile, and the link under [Add Zoom](#add-zoom) opens Connections without Zoom.
- A Zoom account. Auto reaches Zoom at `zoom.us`, so it does not serve a Zoom for Government account.
- To use Zoom through your agent, your agent connected to Auto and signed in as you. Follow the [quick start](../get-started/cloud.md) if you have not connected yet. An agent connected with an API key cannot add a connection.

## Choose how to connect

Studio's dialog Connect Zoom offers up to three choices. Your agent's link offers the same ones.

| Choice                 | Who sets it up                                                                                                                              | What the connection reaches                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Auto's Zoom app        | A Zoom admin of your company signs in once and allows the app Auto for Admins                                                               | The meetings, recordings and Team Chat of every user on your company's Zoom account |
| Your company's own app | A Zoom admin, then someone who builds apps in Zoom's developer area: they make a Server-to-Server OAuth app and enter its details in Studio | The same as Auto's Zoom app                                                         |
| My own account         | You sign in to Zoom and allow the app Auto                                                                                                  | Your own meetings, recordings and Team Chat alone                                   |

With My own account, you connect as yourself, and each call acts as you: a meeting it creates is yours, and a message it sends is from you. A function in a playbook the connection is for acts in Zoom as you, whoever in your organization runs it.

With Auto's Zoom app or your company's own app, each playbook step names whose meetings or chat it means, by the user's email address or Zoom user ID: a meeting it creates is that user's, and a message it sends is from that user. Auto's Zoom app works for as long as it stays allowed on your Zoom account.

Studio offers Auto's Zoom app on Auto Cloud, and on an Auto you run yourself where [consent through Auto](../self-host/connections.md#consent-through-auto) is on, or where whoever runs it registered an admin-managed Zoom app of their own. Whichever you choose, the connection belongs to your organization.

## Add Zoom

On Auto Cloud, open [Add Zoom to Auto](https://studio.on.auto/?settings=connections&connect=zoom). This link opens Studio's Connections page, with Zoom ready to add if Studio offers it to you, as [What you need](#what-you-need) says.

1. If you are signed out, sign in to Auto, or create an account, on the page Studio shows. Studio then brings you back to Connections.
2. Studio shows the dialog Connect Zoom. Choose My own account and press Continue to Zoom. Leave the name `zoom`, under More options, unless you connect Zoom a second time.
3. Zoom asks you to sign in, if you are not signed in already, and to allow Auto access. Check the permissions it lists and allow it.
4. Zoom sends you back to Studio, which finishes the connection and says that `zoom` is connected. Press Open Connections to see it among your connections.

If you belong to several organizations, Studio opens your current one. To add Zoom to another, close the dialog, switch organization in Settings, and press Connect on the Zoom tile.

On an Auto that serves its own Studio, open Studio, go to Settings, Connections, and press Connect on the Zoom tile. Then follow steps 2 to 4.

### With Auto's Zoom app

1. Open [Add Zoom to Auto](https://studio.on.auto/?settings=connections&connect=zoom), as above.
2. In the dialog Connect Zoom, choose Auto's Zoom app and press Continue to Zoom.
3. Zoom asks you to sign in. Sign in as an admin of your company's Zoom account, or ask your Zoom admin to do this step, and allow Auto for Admins. Zoom lists what it may do on the whole account.
4. Zoom sends you back to Studio, which says that `zoom` is connected.

### With your company's own app

This needs a Zoom admin and someone who builds apps in Zoom's developer area.

1. In the dialog Connect Zoom, choose Your company's own app and press Continue.
2. Studio's page shows the steps at Zoom. First, a Zoom admin lets you build a Server-to-Server OAuth app, under User Management, Roles, Role Settings, Advanced features. Then, in the Zoom App Marketplace, you build the app, add the fifteen scopes the page lists, each ending in `:admin`, and activate it. If someone else builds the app, press Copy setup link and send them the link.
3. Enter the Account ID, Client ID and Client secret Zoom shows under App credentials on the app's page.

The app keeps the permissions of the person who built it: if their role at Zoom changes, transfer the app to another owner in Zoom.

### Through your agent

1. Ask your agent to connect Zoom:

   ```text
   Connect Zoom to Auto, so that the functions in my "<playbook name>" playbook
   can read my Zoom meetings and recordings.
   ```

   Your agent may ask which playbook the connection is for. Name the playbooks that may use it, or say that every playbook of your organization may. A connection that names no playbook is for every playbook of the organization.

2. Your agent asks you to open a page of Studio, or gives you its link. The link works until the connection is connected or removed, or until a newer link replaces it. On an Auto that signs people in, only you can use it, signed in as yourself.
3. Check what the page says you are connecting, choose how to connect, as in the dialog, and press Continue to Zoom, or Continue for your company's own app.
4. Sign in to Zoom and allow access, as in step 3 of Add Zoom or of [With Auto's Zoom app](#with-auto-s-zoom-app), or enter the details of your company's own app. Studio then shows Zoom as connected. Your agent sees it connected too.

If you no longer have the link before Zoom is connected, ask your agent to reconnect it, for a new link.

## What you see

After you press Continue to Zoom in the dialog, or on the page your agent gives you, Studio shows Taking you to Zoom… while it sends you there. Zoom's page names the app you allow and what it may do. With Auto's Zoom app, the app is Auto for Admins. With My own account, the app depends on how your Auto is set up:

| How your Auto is set up                                                                                  | What you see                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto Cloud                                                                                               | Zoom asks you to allow Auto, under Auto's name, and sends you back to Studio at `https://studio.on.auto`                                                                                          |
| Whoever runs your Auto registered a Zoom app of their own                                                | Zoom asks you to allow their app, and then sends you back to Studio. Their app comes first, even where consent through Auto is on                                                                 |
| They registered none, and [consent through Auto](../self-host/connections.md#consent-through-auto) is on | Zoom asks you to allow Auto, under Auto's name. It then sends you to Studio at `https://studio.on.auto`, where you sign in to Auto if you have not already, and on to the Studio you started from |
| Neither                                                                                                  | The Zoom tile says why in place of Connect, and your agent cannot add Zoom: Zoom takes a client whoever runs Auto registers, which is not set up here. Ask whoever runs your Auto to set one up   |

Once Zoom is connected, its row in Settings, Connections, reads Connected. Open the row to see who connected it and when, and which playbooks may use it.

## What Auto does with each permission

Zoom asks you to allow fifteen permissions, which its page lists in its own words. Each one covers a single thing a function may do:

| Zoom lets Auto                     | What Auto does with it                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| See your profile                   | Reads your Zoom name, email address, time zone and account type, so a function knows whose account it is |
| List your meetings                 | Lists your scheduled, upcoming and previous meetings                                                     |
| See a meeting                      | Reads one meeting's topic, time, agenda, join link and settings                                          |
| Create a meeting                   | Schedules a meeting under your account, as you                                                           |
| Update a meeting                   | Changes the topic, time, agenda or settings of one of your meetings                                      |
| See a past meeting                 | Reads a meeting that has ended: its topic, when it started and ended, its host and how many joined       |
| List a past meeting's participants | Lists who joined a meeting that has ended, and when each joined and left                                 |
| See a meeting's summary            | Reads AI Companion's summary of a meeting                                                                |
| List your cloud recordings         | Lists the meetings you recorded with Zoom's cloud recording                                              |
| List a recording's files           | Lists the files of one meeting's recording: their kind, size and when they were made, not their content  |
| See a meeting's transcript         | Reads a meeting's transcript details, such as when it was made, not the transcript's text                |
| List your Team Chat channels       | Lists the channels you are a member of                                                                   |
| List your chat messages            | Reads the messages of a channel you are in, or of a conversation with one of your contacts               |
| See a thread                       | Reads the replies under one message                                                                      |
| Send a chat message                | Sends a message as you, to a channel you are in or to one of your contacts                               |

The `zoom` row of [the providers Auto ships](../self-host/connections.md#the-providers-auto-ships) is the full list of what a function may do with Zoom. With My own account, Auto asks for none of the permissions that reach other people's own meetings, recordings or chats on your Zoom account.

Auto's Zoom app and your company's own app take the same fifteen permissions for every user on your Zoom account, each named with `:admin` at its end, such as `meeting:read:list_meetings:admin`. Auto uses each one for the user a playbook step names: it reads that user's profile, meetings, recordings and chats, creates and updates meetings for that user, and sends chat messages as that user, to a channel they are in or to one of their contacts.

Zoom's answers to each call stay in the playbook's history, where anyone who may read the playbook can read them. A meeting's answer holds its start link, with which anyone who has it signs in to Zoom as the meeting's host, and its passwords. If you would rather the history keep only the size of each answer, ask your agent to add Zoom that way.

## Use Zoom through your agent

Once Zoom is connected, ask your agent to give a function in your playbook the Zoom tools it needs, as [Give a function tools](../guides/tools.md) shows. Your agent can also try a Zoom tool once by hand, live, before a function uses it. Say what you want done, in your own words:

| A playbook can                                                    | You might ask                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| List your upcoming and past meetings, and who attended a past one | "List last week's client calls and who joined each."                         |
| Read a meeting's details and its AI summary                       | "Summarize the decisions in yesterday's planning meeting, from its summary." |
| List your cloud recordings, and read a transcript's details       | "List the meetings I recorded this month, and say which have a transcript."  |
| Read your Team Chat channels, their messages and threads          | "What did the launch channel agree on today?"                                |
| Create and update meetings                                        | "Set up a 30-minute review next Tuesday at 10, and give me its link."        |
| Send a chat message                                               | "Post the weekly summary in the launch channel."                             |

With Auto's Zoom app or your company's own app, say whose meetings or chat you mean, by email address or Zoom user ID, such as "List last week's meetings of jane@example.com and who joined each." Each call a function makes to Zoom then names that user.

## What your Zoom plan needs

Some of what Auto reads exists only on some Zoom plans, or once a setting is on. Zoom's API documents these conditions:

| What Auto reads or does                                     | What your Zoom account needs                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your profile, your meetings, and creating and updating them | Any Zoom account, Basic included. The list holds scheduled meetings that have not expired, not instant meetings. Zoom takes at most 100 updates of one meeting a day                           |
| A past meeting's details                                    | A meeting that has ended, within the past year                                                                                                                                                 |
| Who attended a past meeting                                 | A Pro plan or higher, and a meeting within the past 15 months. A meeting with one participant shows only where your account shows one-person meetings on its Dashboard and in its Reports      |
| Cloud recordings and their files                            | A Pro plan or higher, with cloud recording turned on                                                                                                                                           |
| A meeting's transcript                                      | A transcript Zoom made of the meeting: of a cloud recording, with audio transcripts turned on, or of AI Companion, where your account lets hosts view and manage transcripts after the meeting |
| A meeting's AI summary                                      | The host on a Pro, Business or higher plan, with Meeting Summary with AI Companion turned on. An end-to-end encrypted meeting has no summary                                                   |
| Team Chat channels, messages, threads and sending           | Team Chat turned on for your account. Auto reads the channels you are a member of, and sends to such a channel or to a contact in your contact list                                            |

## What your Zoom admin may have to allow

The app Auto, which you allow with My own account, is user-managed: each person adds it for themselves, for their own data, and needs no admin role at Zoom to do so. Auto for Admins, behind Auto's Zoom app, is admin-managed: only a Zoom admin adds it, once for the whole account. Two things are still up to whoever manages your Zoom account:

- **Approving the app.** A Zoom account can require that an admin of its App Marketplace pre-approve an app before anyone on the account adds it. Zoom then offers to send the admin a request. Ask your admin to pre-approve Auto, and add Zoom again once they have.
- **The settings above.** An admin can turn off, or lock, cloud recording, audio transcripts, AI Companion's meeting summaries and Team Chat for the whole account. Auto then finds nothing of that kind. Ask your admin to turn on the ones you need.

## If something goes wrong

| What you see                                                                                                                 | What it means and what to do                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connections shows no Zoom tile, and the link under Add Zoom opens no dialog                                                  | Studio does not offer Zoom to you yet, as [What you need](#what-you-need) says. Add Zoom once Connections shows its tile                                                                                                                |
| Studio says Zoom denied access                                                                                               | You did not allow access at Zoom, or Zoom refused it. Press Start again to go back to Zoom, or Open Connections to leave it. The connection waits, pending, until you allow access or remove it                                         |
| Zoom says the app needs your admin's approval                                                                                | Your Zoom account requires pre-approval. Request it at Zoom, or ask your admin to pre-approve Auto, as [What your Zoom admin may have to allow](#what-your-zoom-admin-may-have-to-allow) says, then press Start again or add Zoom again |
| The `zoom` row says Needs attention, with Zoom asks for access this connection was not granted                               | A call needs a permission the connection was not granted. Open the row and press Connect again, then allow access at Zoom. If your admin has turned the feature off, ask them first                                                     |
| The `zoom` row says Broken, with Zoom no longer accepts this connection, or the access Zoom gave it was revoked or has ended | Zoom refused the connection's tokens, as after you removed the app at Zoom, or the access ended. Open the row and press Sign in again, then sign in to Zoom and allow access. Or ask your agent to reconnect Zoom, for a new link       |
| A function finds no cloud recordings, attendees or summaries                                                                 | Your Zoom plan or settings do not have them, as [What your Zoom plan needs](#what-your-zoom-plan-needs) says. A Basic account has no cloud recordings. Turn on the setting, or ask your admin to                                        |
| A function finds no messages in a channel, or Zoom refuses a message to it                                                   | You are not a member of that channel. Auto reaches only the channels you are in. Join the channel in Zoom, then try again                                                                                                               |
| Zoom answers that the user does not exist, with Auto's Zoom app or your company's own app                                    | Each call names a user of your company's Zoom account, by email address or Zoom user ID. Check the user the playbook step names, or name one who is on the account                                                                      |
| Zoom does not accept your company's own app                                                                                  | Check the Account ID, Client ID and Client secret against App credentials on the app's page at Zoom, and that the app is activated. Then remove the connection and add it again with the right details                                  |

## Remove Zoom

You can remove Zoom in Auto or at Zoom.

### In Auto

In Studio, go to Settings, Connections, open the `zoom` row, press Remove and confirm. Or ask your agent:

```text
Remove my Zoom connection from Auto.
```

No playbook may use the connection any more. With My own account or Auto's Zoom app, Auto asks Zoom to revoke the connection's tokens and deletes them. If Zoom does not answer, Auto removes the connection all the same, and its tokens end on their own. With your company's own app, Auto deletes the app's details and its token, and the app keeps working at Zoom until you deactivate or delete it there.

### At Zoom

Sign in to the [Zoom App Marketplace](https://marketplace.zoom.us), open Manage, then Added Apps, and remove Auto, or the app you allowed. Zoom then refuses the connection's tokens. A Zoom admin removes Auto for Admins from the whole account in the same marketplace.

To stop your company's own app, deactivate it in the Zoom App Marketplace, under Activation on the app's page, or delete it. Zoom then refuses the app's tokens, and the connection breaks the next time a function uses it. Remove it in Auto too.

Where you allowed the app Auto on Auto Cloud, Zoom also tells Auto that you removed it, and the connection disappears from Auto: Auto removes it as Remove does in Auto, deletes its tokens, and no playbook may use it any more. If Auto cannot act on Zoom's notice at once, Zoom sends it again, three times over the next hour and a half; a connection Auto could not remove by then stays, and breaks the next time a function uses it, as below.

Where a Zoom admin removed Auto for Admins, or on a runtime you run yourself, the connection stays, and the next time a function uses it, it breaks, and Studio shows it as Broken, with why. Remove it in Auto too, as above, so that Auto deletes its tokens. To use Zoom again, open the row and press Sign in again, or ask your agent to reconnect it, and allow access again.

### What remains

Removing Zoom does not remove what Zoom answered before. The playbook's history keeps what earlier calls answered, for anyone who may read the playbook, for as long as whoever runs your Auto keeps it. On Auto Cloud, Auto's [privacy policy](https://on.auto/privacy) says how long that is.

Where you allowed Auto's own app, Auto also keeps a line for each time you allowed access, each renewal and each revocation, naming you, Zoom and the Studio you went back to, and no token. It keeps a line for each notice Zoom sends that you removed the app, naming your Zoom user and account, the app and the time Zoom gives. So that the notice finds your connection, Auto Cloud keeps, for each connection to Zoom made with Auto's own app, a keyed hash of your Zoom user and account, never the identifiers themselves, and deletes it when the connection is removed in Auto, when Zoom tells Auto that you removed the app, or when your organization is deleted.

## Get help

- For help with Zoom in Auto, use Auto's [support page](https://on.auto/support), which says when we answer.
- Read Auto's [privacy policy](https://on.auto/privacy) and [terms](https://on.auto/terms).
