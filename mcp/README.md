# PRISM MCP server

Lets Claude work with your PRISM help desk: look up and triage tickets, read a
customer's history, add notes, log time, and search the knowledge base. It
speaks the [Model Context Protocol](https://modelcontextprotocol.io) and calls
PRISM's own API with an API key, so **Claude sees and changes exactly what the
key's owner can, and nothing more**. Every change appears in PRISM's audit log
under that user.

There are two ways to connect Claude:

- **claude.ai, the Claude apps, and everyone on a team: built into PRISM.**
  An Owner turns it on in **Settings › Claude**; each person adds
  `https://your-prism/mcp` as a connector, signs in to PRISM and clicks
  Allow. Nothing to install or run; see [Connecting from claude.ai](#connecting-from-claudeai).
- **This program**, for Claude Desktop or Claude Code with an API key: a
  separate program that talks to `https://your-prism/api/v1`. The rest of
  this README is about it.

Both offer the same tools.

## Tools

| Tool | What it does | Changes data |
|---|---|---|
| `prism_whoami` | The user this connection acts as | |
| `prism_search` | Quick search across tickets, projects and contacts | |
| `prism_dashboard` | Open work, attention items, SLA state, workload | |
| `prism_list_tickets` | Tickets by status, priority, company, assignee and more | |
| `prism_get_ticket` | One ticket with its conversation (by id or number, e.g. `AD-T0001`) | |
| `prism_ticket_activity` | Who changed what on a ticket | |
| `prism_list_ticket_statuses` / `prism_list_ticket_categories` | The help desk's statuses and categories | |
| `prism_list_users` | Staff who can be assigned | |
| `prism_list_companies` / `prism_get_company` | Customers and vendors, with an at-a-glance summary | |
| `prism_list_contacts` / `prism_get_contact` | The people you support, with their tickets | |
| `prism_list_projects` / `prism_get_project` | Projects with phases, tasks and budget | |
| `prism_list_assets` / `prism_get_asset` | Equipment, licenses, contracts and agent-managed computers | |
| `prism_search_knowledge` / `prism_get_article` | The knowledge base | |
| `prism_create_ticket` | Raise a ticket for a contact | yes |
| `prism_update_ticket` | Status, priority, assignee, team, due date, category, title, resolution | yes |
| `prism_add_ticket_comment` | A private note (the default), a public comment, or a **reply that is emailed to the customer** | yes |
| `prism_log_ticket_time` | Log time worked | yes |

Set `PRISM_MCP_READ_ONLY=true` to leave out the four tools that change data.

## 1. Make an API key

Use a dedicated PRISM user for Claude so its access is something you chose on
purpose: in **Settings › People & access › Users**, create a local user (for
example "Claude") with a role that has only what you want it to do, such as a
technician role scoped to the companies it should see. Sign in as that user,
then create a key under **Settings › People & access › API keys**. The key is
shown once; give it an expiry date.

Using your own key also works; Claude then acts as you.

## 2. Install

Node 20 or newer:

```bash
cd mcp
npm ci
```

## 3. Connect Claude

### Claude Code

```bash
claude mcp add prism --env PRISM_URL=https://help.example.com --env PRISM_API_KEY=prism_your_key -- node /path/to/PRISM/mcp/src/index.js
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings › Developer › Edit Config),
then restart Claude Desktop:

```json
{
  "mcpServers": {
    "prism": {
      "command": "node",
      "args": ["/path/to/PRISM/mcp/src/index.js"],
      "env": {
        "PRISM_URL": "https://help.example.com",
        "PRISM_API_KEY": "prism_your_key"
      }
    }
  }
}
```

### Over HTTP (one server, many people)

Run it as a small web service, and each person connects with **their own**
PRISM key as a bearer token. The server stores no key, and it refuses a
request without one.

```bash
PRISM_URL=https://help.example.com PRISM_MCP_HOST=127.0.0.1 PRISM_MCP_PORT=8787 npm run start:http
```

```bash
claude mcp add --transport http prism https://mcp.help.example.com/mcp --header "Authorization: Bearer prism_your_key"
```

It listens on `127.0.0.1` unless `PRISM_MCP_HOST` says otherwise. To reach it
from other machines, put it behind your HTTPS reverse proxy (the same one in
front of PRISM), so keys never cross the network in the clear. Requests from a
browser page are refused unless their origin is listed in
`PRISM_MCP_ALLOWED_ORIGINS`. `GET /health` answers without a key for
monitoring.

## Connecting from claude.ai

PRISM serves MCP itself at `https://your-prism/mcp`, with OAuth sign-in, so
claude.ai, the Claude mobile apps, Claude Desktop and Claude Code can connect
by URL with no key:

1. **An Owner turns it on** in **Settings › Claude**. PRISM must be reachable
   at an `https://` address on port 443, set as `PUBLIC_APP_URL` in `.env`
   (Claude connects from Anthropic's cloud). Choose whether Claude may make
   changes (off: it can only look).
2. **In Claude**, Settings › Connectors › **Add custom connector**: name it
   PRISM and paste `https://your-prism/mcp`. Leave the OAuth settings alone.
   On a Team or Enterprise plan an owner adds it once.
3. **Each person clicks Connect**, signs in to PRISM the way they always do
   (local, Active Directory or single sign-on) and clicks **Allow**.

Claude then acts as that person, with exactly their permissions. Access
tokens last an hour and refresh for up to 30 days of use; **Settings ›
Claude** lists every connection and revokes any of them, and turning the
setting off disconnects everyone. The token works only on `/mcp`, never on
the rest of PRISM's API.

The HTTP mode of this program (above) also works with claude.ai, by adding
`Authorization: Bearer prism_…` as a request header on the connector, if you'd
rather use an API key.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PRISM_URL` | (required) | PRISM's address, e.g. `https://help.example.com` (or ending in `/api/v1`) |
| `PRISM_API_KEY` | (required for stdio) | The API key. Ignored in HTTP mode, where each request brings its own |
| `PRISM_MCP_READ_ONLY` | `false` | `true` leaves out the tools that change data |
| `PRISM_MCP_HOST` | `127.0.0.1` | HTTP mode: address to listen on |
| `PRISM_MCP_PORT` | `8787` | HTTP mode: port |
| `PRISM_MCP_ALLOWED_ORIGINS` | (none) | HTTP mode: comma-separated browser origins allowed to call it |

## Good to know

- **Replies are emailed.** Claude is told to show you a reply and get your
  go-ahead before sending one, and comments default to private notes. If you
  never want Claude to email customers, give its PRISM user a role without
  permission to reply, or run read-only.
- Results larger than about 60,000 characters are cut, with a note asking for
  narrower filters.
- PRISM's per-user rate limit applies to the key as it would to a person.

## Tests

```bash
npm test
```

The tests run against a fake PRISM, so they need no database.
