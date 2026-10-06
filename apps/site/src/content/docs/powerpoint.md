---
title: Use OpenRoom in PowerPoint
description: Embed OpenRoom slides, connect the task pane, rehearse, and run participation alongside a presentation.
section: Desktop and PowerPoint
order: 220
related: [deck-editor, present, live-session, troubleshooting]
---

## Requirements and availability

The current PowerPoint integration is a **local preview build**. Use the supplied manifests with a supported PowerPoint installation and the matching OpenRoom server. Native sign-in, cross-window communication, slide-show activation, and save/reopen behavior require verification on the PowerPoint installation used for the event.

Allow time for a rehearsal on that computer. Keep the OpenRoom task pane available as the manual control surface.

## Install the local Mac preview

With the repository and its dependencies installed, run this command from the repository root:

```sh
bun run office:install
```

The installer sets up Microsoft's localhost development certificate, builds and serves the apps at `https://localhost:3443`, and installs the two local manifests. Restart PowerPoint, open a presentation, and choose **Home → Add-ins**. Open **OpenRoom for PowerPoint** for the task pane and **OpenRoom Slide** for an embedded slide. The task pane is also available from **Home → OpenRoom**.

Keep the server command running. On later runs, use:

```sh
bun run dev:office
```

This local server is reachable only on the Mac. Use a reachable deployment for participants on other devices. The local sign-in option is **Sign in with demo account**, with username `alice` and password `demo`. These credentials apply only to that local preview.

The development certificate lasts 30 days. Rerun the installer to renew it. To remove the preview, delete `openroom-taskpane.xml` and `openroom-display.xml` from `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef`, then restart PowerPoint. Presentations and local data remain in their own locations.

## Connect the task pane

Open **OpenRoom for PowerPoint**, select the sign-in action, complete sign-in in the opened browser, and approve the connection for the intended account. Return to PowerPoint after the connection succeeds.

Use the same server address throughout sign-in and presentation. If the pane reloads and asks to reconnect, reconnect before resuming the existing session. Revoke an old connection in OpenRoom **Settings → Connected apps** when needed.

## Insert an OpenRoom slide

Choose a space, deck, and slide in the embedded picker. Alternatively:

1. Open a cloud deck in OpenRoom's editor.
2. Select the slide.
3. Select **Home → Copy embed code**. Wait for pending changes to save.
4. Paste the code into the PowerPoint add-in's embed-code field.

For a local `.openroom` file, [save it to a workspace](/docs/desktop/#save-a-file-to-a-workspace) first.

The code identifies a particular deck version and slide. The preview uses that content, including slide design, questions, media, freeform objects, and detail slides. Choosing a slide in the task pane also prepares it for the next **OpenRoom Slide** insertion.

Size and position the content add-in on the native PowerPoint slide, then preview it in Slide Show. Keep essential content clear of PowerPoint overlays.

## Rehearse an activity

Use the selected-slide rehearsal controls to try opening, closing, revealing, reopening, and resetting a question. Rehearsal uses local sample answers. Check result labels, reveals, timers, and the fit of the embedded display.

Rehearse the complete presentation in Slide Show as well. Test the connection and the manual **Show selected slide** action on the actual computer.

## Start one audience session

Select **Start session** in the connected task pane. The session gathers embedded OpenRoom slides in native presentation order. The selected slides must belong to one space and use compatible context and identity settings.

The session captures that composition. Finish selecting and arranging activities before starting. To include later additions, replacements, or reordered activities, end the current audience session and start a new one.

Share the resulting join link or code. Keep the signed-in task pane open. In supported Slide Show operation, activating an embedded OpenRoom slide presents it to the audience and opens its activity. Repeated activation of the current slide preserves a deliberately closed question. Returning to another previously asked question reopens it with the existing answers.

## Use the companion controls

If automatic activation is unavailable, select the relevant PowerPoint slide and use **Show selected slide** in the task pane. Run the audience **Stage** in a browser when a separate projected display is needed.

Use the task pane's question and session controls to close, reveal, and end participation. After a temporary connection failure, reconnect and resume the existing session. Check the session code before starting another audience.
