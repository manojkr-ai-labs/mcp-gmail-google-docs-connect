# Gmail & Google Docs MCP Server

A generic [Model Context Protocol](https://modelcontextprotocol.io) server that lets any MCP-compatible AI agent draft and send Gmail messages and append text to an existing Google Doc.

The server is a standalone integration. It does not contain logic for a specific agent. The agent decides **when** to call a tool and **what content** to pass; this server validates input, authenticates with Google, calls the official APIs, and returns a predictable JSON result.

```
AI Agent / MCP Client
        |
        | MCP (stdio locally, or Streamable HTTP on Railway)
        v
Generic MCP Server
  draft_email | send_email | append_to_google_doc
        |
        v
Gmail API / Google Docs API
```

## Supported tools

| Tool | What it does | Side effect |
|------|----------------|-------------|
| `draft_email` | Creates a Gmail draft | Writes a draft. **Does not send.** |
| `send_email` | Sends an email through Gmail | Irreversible delivery. Duplicate calls can send duplicate mail. |
| `append_to_google_doc` | Inserts text at the end of an existing Google Doc | Mutates the document. Never replaces existing content. |

`draft_email` and `send_email` are separate on purpose. Generating email content is not permission to send it.

## Prerequisites

- Node.js 20 or later
- npm
- A Google Cloud project
- A Google account that can use Gmail and Google Docs
- An MCP-compatible client (Cursor, Claude Desktop, MCP Inspector, or any other MCP host)

## 1. Google Cloud project setup

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or select an existing one).
3. If prompted, configure the OAuth consent screen:
   - User type: **External** is fine for a personal/test app.
   - Add yourself as a **test user** while the app is in Testing. Skipping this often yields `403: access_denied`.
4. Publishing is not required for personal use with test users.

## 2. Enable APIs

In the same project, enable:

- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)

You do **not** need the Drive, Sheets, or Calendar APIs for this server.

## 3. OAuth client

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app** (recommended) or **Web application**.
3. If the console asks for authorized redirect URIs, add exactly:

   `http://127.0.0.1:3000/oauth2callback`

   That value must match `GOOGLE_REDIRECT_URI` in `.env`.
4. Copy the **Client ID** and **Client secret**. Never commit them.

## 4. Required OAuth scopes

The server requests only:

| Scope | Why |
|-------|-----|
| `https://www.googleapis.com/auth/gmail.compose` | Create drafts and send mail |
| `https://www.googleapis.com/auth/documents` | Read document metadata and append text |

Add the same scopes on the OAuth consent screen. Do not add `https://mail.google.com/`, `gmail.modify`, or full Drive access.

Both scopes are **Sensitive**. In Testing mode, only listed test users can authorize.

## 5. Install

```bash
git clone <this-repo>
cd mcp-4
npm install
copy .env.example .env
```

On macOS/Linux use `cp .env.example .env`.

## 6. Environment variables

Edit `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | yes | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | no | Default `http://127.0.0.1:3000/oauth2callback` |
| `GOOGLE_TOKEN_PATH` | no | Default `.tokens/google-token.json` (gitignored) |
| `GOOGLE_REFRESH_TOKEN` | hosted | Refresh token from the local `npm run auth` file. Required on Railway because the container disk is ephemeral. |
| `MCP_AUTH_TOKEN` | hosted | Bearer token that clients must send to `POST /mcp`. Generate with `openssl rand -hex 32`. |
| `PORT` | injected | When set (Railway always sets it), the process serves Streamable HTTP instead of stdio. |
| `MCP_TRANSPORT` | no | `http` or `stdio` to force a transport. |
| `LOG_LEVEL` | no | `debug`, `info`, `warn`, or `error` (default `info`) |

Do not commit `.env`, `.tokens/`, `token.json`, or `credentials.json`.

## 7. Authorize once

```bash
npm run auth
```

This starts a loopback HTTP listener, opens a browser for Google consent, and stores a refresh token at `GOOGLE_TOKEN_PATH`. If the browser does not open, copy the URL printed on stderr.

Re-run `npm run auth` if you see `AUTH_REQUIRED` or `AUTH_EXPIRED`, or after changing scopes.

## 8. Run the server

Local agents (Cursor, Claude Desktop) use **stdio**. Railway uses **Streamable HTTP** when `PORT` is set.

```bash
npm run dev
```

That is stdio unless `PORT` or `MCP_TRANSPORT=http` is set. Production (`npm start`) runs `node dist/index.js` after `npm run build`.

Logs go to **stderr**. On stdio, stdout is reserved for MCP JSON-RPC.

Local HTTP (for Inspector against a TCP port):

```bash
set PORT=3000
set MCP_AUTH_TOKEN=dev-token
npm run dev
```

Then `GET http://127.0.0.1:3000/health` should return `{"ok":true}`.

Typecheck:

```bash
npm run typecheck
```

Tests (mocked Google APIs, no live account):

```bash
npm test
```

## 9. Connect an MCP-compatible client

Point the host at this process. Use the absolute path to this project.

### Cursor (`mcp.json`)

```json
{
  "mcpServers": {
    "gmail-docs": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "D:/path/to/mcp-4",
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

If you already ran `npm run auth` in this directory, you can omit secrets from `env` and keep them in `.env` (the server loads `.env` via dotenv). The token file path is resolved from `cwd`.

### Claude Desktop

Add the same `command` / `args` / `cwd` block under `mcpServers` in the Claude Desktop config file.

### Hosted (Railway) Cursor config

After the service is deployed and Variables include `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `MCP_AUTH_TOKEN`:

```json
{
  "mcpServers": {
    "gmail-docs": {
      "url": "https://mcp-gmail-google-docs-connect-production.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN>"
      }
    }
  }
}
```

Open the Railway URL in a browser and you should see JSON pointing at `/mcp` and `/health`. That is not a website UI. Cursor talks to `/mcp` with the bearer token. `GET /health` needs no auth.

Copy `refresh_token` from the local `.tokens/google-token.json` (created by `npm run auth`) into Railway’s `GOOGLE_REFRESH_TOKEN`. Do not commit that file.

### MCP Inspector

Stdio:

```bash
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

HTTP: start the server with `PORT` and `MCP_AUTH_TOKEN`, then in Inspector choose Streamable HTTP and `http://127.0.0.1:3000/mcp` with `Authorization: Bearer <token>`.

Run it from the project root after `.env` is filled and `npm run auth` has succeeded. Connect, open Tools, and you should see `draft_email`, `send_email`, and `append_to_google_doc`.

## 10. Example tool calls

### Draft an email

```
AI Agent
   |
   | "Draft an email to john@example.com"
   v
draft_email
   |
   v
Gmail API users.drafts.create
```

Arguments:

```json
{
  "to": ["john@example.com"],
  "subject": "Project update",
  "body": "Hi John,\n\nHere is the update.\n"
}
```

Success (tool text JSON):

```json
{
  "success": true,
  "data": {
    "draftId": "...",
    "messageId": "...",
    "threadId": "..."
  }
}
```

### Send an email

Only when the user explicitly asked to send:

```json
{
  "to": ["john@example.com"],
  "subject": "Project update",
  "body": "Hi John,\n\nHere is the update.\n"
}
```

This calls `users.messages.send`. It is not a draft.

### Append to a Google Doc

```
AI Agent
   |
   | "Append this summary to Google Doc <ID>"
   v
append_to_google_doc
   |
   v
Google Docs API documents.batchUpdate
```

The document ID is the `{id}` in `https://docs.google.com/document/d/{id}/edit`.

```json
{
  "documentId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "content": "Summary of today's meeting.",
  "prependNewline": true
}
```

Existing document content is preserved. Text is inserted at the end of the document body.

## 11. Response format

Success:

```json
{
  "success": true,
  "data": {}
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "The requested Google Doc could not be found or is not accessible."
  }
}
```

Failed tool calls also set MCP `isError: true`. Error codes include `INVALID_PARAMS`, `AUTH_REQUIRED`, `AUTH_EXPIRED`, `INSUFFICIENT_SCOPE`, `DOCUMENT_NOT_FOUND`, `ACCESS_DENIED`, `GMAIL_API_ERROR`, `DOCS_API_ERROR`, `RATE_LIMITED`, `NETWORK_ERROR`, and `INTERNAL_ERROR`.

Raw Google API payloads are not returned.

## 12. Security considerations

- Client secrets and tokens stay in environment variables and a gitignored token file.
- Least-privilege scopes only (`gmail.compose` and `documents`).
- All tool inputs are validated before any Google call.
- Logs (stderr JSON) record tool name, outcome, error code, duration, and API operation. They do **not** record access tokens, refresh tokens, client secrets, email bodies, or document contents.
- Tool errors do not include stack traces or credentials.
- `send_email` is an explicit tool. The server never infers send permission from generated text.
- Hosted `/mcp` requires `MCP_AUTH_TOKEN`. `/health` is unauthenticated and does not call Google.
- Operations run as the Google user who completed `npm run auth`. Google still enforces document ACLs.
- Do not retry `send_email` or `append_to_google_doc` automatically after `NETWORK_ERROR` or timeouts. The side effect may already have succeeded.

## 13. Troubleshooting

| Symptom | What to do |
|---------|------------|
| Server exits immediately mentioning `.env.example` | Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. |
| `AUTH_REQUIRED` | Local: run `npm run auth` from the same `cwd` the host uses. Hosted: set `GOOGLE_REFRESH_TOKEN` from that token file. |
| `AUTH_EXPIRED` / `invalid_grant` | Revoke the app at [Google Account permissions](https://myaccount.google.com/permissions), then `npm run auth` again. |
| `403: access_denied` on consent | Add your Google account as an OAuth test user. |
| `INSUFFICIENT_SCOPE` | Confirm both scopes on the consent screen and re-run `npm run auth` with `prompt=consent` (the CLI already requests consent). |
| `DOCUMENT_NOT_FOUND` / `ACCESS_DENIED` | Check the Doc ID and that the authorized account can edit the document. |
| Redirect URI mismatch | `GOOGLE_REDIRECT_URI` must match the URI registered on the OAuth client. Port 3000 must be free during `npm run auth`. |
| Duplicate emails or duplicate appended paragraphs | The agent retried a side-effecting tool. Do not retry send/append on uncertain errors. |
| Railway `Application failed to respond` / 502 | The process must listen on `0.0.0.0:$PORT`. Redeploy this HTTP build (`npm start` → `node dist/index.js`). Set `MCP_AUTH_TOKEN`. Healthcheck path: `/health`. |
| `npx tsx` fails in the host | Run `npm install` in this repo; or use `node` with a compiled `dist/index.js` after `npm run build`. |

### Manual live checks (not run in CI)

1. `draft_email` → draft appears in Gmail Drafts, message is not sent.
2. `send_email` → message arrives in the recipient inbox / Sent folder.
3. `append_to_google_doc` → new text is at the end; previous paragraphs are unchanged.

## 14. Extending the server

v1 only implements draft, send, and append. To add another Google Workspace tool later:

1. Add a module under `src/tools/<area>/`.
2. Add a method on an existing service or a new file in `src/services/`.
3. Register the tool in `src/server/create-server.ts`.
4. Add tests and a README row.

New OAuth scopes require a new consent run (`npm run auth`). Do not request extra scopes until a tool needs them.

## Project layout

```
src/
  index.ts                 # stdio or HTTP (PORT / MCP_TRANSPORT)
  http.ts                  # Streamable HTTP app (/mcp, /health)
  server/create-server.ts  # MCP server factory
  tools/                   # MCP tool layer
  services/                # Gmail + Docs + MIME
  auth/                    # OAuth + `npm run auth`
  validation/
  errors/
  logging/
  config/
```

See [docs/architecture.md](docs/architecture.md) for design details.
