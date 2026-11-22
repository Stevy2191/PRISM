# The Help desk app (agent window → desktop app): design

**Status:** built 2026-11-22 ("dive in"; past tickets decided by the owner the
same day).

## Why

The agent's window was a fixed 460×840 box reached only from the tray icon,
listing open tickets only. People should be able to open PRISM like any
program, create tickets and look back through their tickets.

## What it is

- **The same window, grown into an app.** Resizable (opens at 1080×720,
  never smaller than 440×600). Wide (≥ 820 px) it is two panes: home (notices,
  New ticket, my open tickets) down the side and the ticket, form or a
  placeholder beside it; narrow it is the single column it always was.
- **Opened like any program.** Windows: Start menu **Help desk** (the old
  "Submit a ticket" shortcut, same Id, so upgrades replace it). macOS:
  **/Applications/Help desk.app**, the tray program installed as `help-desk`,
  which opens the window and has a Dock icon. Linux: the **Help desk** app
  entry. The tray's menu says **Open Help desk**.
- **Past tickets behind the person's own sign-in** (owner, 2026-11-22,
  keeping the 2026-11-13 rule: the agent trusts the computer's login, so only
  open tickets are shown that way). Past tickets opens the portal's closed
  tickets (`…/tickets?status=closed&scope=mine`) in its own app window whose
  web profile keeps the portal sign-in (WebView2 profile folder; WKWebView's
  persistent store; on Linux, WebKitGTK cookies set to persist in the
  person's folder). A portal sign-in lasts 24 hours of inactivity
  (`SESSION_MAX_AGE_MS`).

## Approaches considered

1. **Grow the agent's window** (chosen): keeps the no-sign-in connection
   through the agent for open tickets and new ones; one program to ship.
2. **A separate desktop app talking to PRISM directly:** would need its own
   sign-in for everything and a second program to install and update.
3. **Just open the portal:** loses the agent's no-sign-in path, the health
   snapshot and screen capture.

## Not done

- An app icon of its own (the bundles use the system default, as the
  menu-bar app already does).
- Showing closed tickets without a sign-in (decided against).
