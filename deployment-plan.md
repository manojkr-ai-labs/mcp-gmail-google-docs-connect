# Railway deployment plan: Gmail & Google Docs MCP server

This plan is for hosting **this repo** (`gmail-docs-mcp`) on [Railway](https://railway.com) as a **remote MCP server**. It is written against the current codebase (stdio-only Node 20 TypeScript server, `@modelcontextprotocol/server` 2.0, desktop Google OAuth + file-backed refresh token).

Do **not** run `railway up` against `npm start` as it exists today. That command starts a stdio process that waits on stdin, binds no HTTP port, and will be marked crashed by Railway.

---

## 1. Goal

Ship a publicly reachable HTTPS MCP endpoint:

```
https://<service>.up.railway.app/mcp
```

Any MCP client that supports **Streamable HTTP** (Cursor, Claude Code, Claude connectors, MCP Inspector) can call the existing tools:

| Tool | Side effect |
|------|-------------|
| `draft_email` | Creates a Gmail draft |
| `send_email` | Sends mail (irreversible) |
| `append_to_google_doc` | Appends text to an existing Doc |

Local Cursor/Claude Desktop **stdio** usage stays supported. Railway is an additional transport, not a replacement.

Auth model stays **single Google user** (the account that completed OAuth). This is not a multi-tenant Google SaaS.

---

## 2. Current state vs Railway requirements

| Area | This repo today | Railway needs |
|------|-----------------|---------------|
| Transport | `serveStdio` in `src/index.ts` | Streamable HTTP on `POST /mcp` |
| Listen address | none (stdin/stdout) | `0.0.0.0` + `process.env.PORT` |
| Process | `tsx src/index.ts` (`tsx` is a **devDependency**) | Compiled `node dist/...` (production install omits `tsx`) |
| Health | none | `GET /health` returning 2xx |
| Google OAuth | Loopback `http://127.0.0.1:3000/oauth2callback` + `npm run auth` | Consent **offline**; runtime only needs a refresh token |
| Token store | File at `GOOGLE_TOKEN_PATH` (default `.tokens/google-token.json`) | Ephemeral container disk; tokens must live in **env** or a **volume** |
| MCP endpoint auth | none (local process) | **Required** — a public URL can send Gmail as the authorized user |
| Config | `.env` via dotenv | Railway Variables (no `.env` in the image) |

Architecture already separates the server factory (`src/server/create-server.ts`) from transport (`src/index.ts`). HTTP hosting only adds a new entrypoint and secret/token handling.

Official Railway MCP guide: [Build and Deploy Your Own MCP Server](https://docs.railway.com/guides/mcp-server). It matches the SDK this project already uses (`@modelcontextprotocol/server` plus Express/Node adapters).

---

## 3. Target architecture

```
MCP client (Cursor / Claude / Inspector)
        |
        | HTTPS  POST /mcp
        | Authorization: Bearer <MCP_AUTH_TOKEN>
        v
Railway service (Node 20)
  GET  /health          # Railway healthcheck only
  POST /mcp             # Streamable HTTP, stateless
        |
        v
createServer()          # same tools as local stdio
        |
        v
Gmail API / Docs API    # OAuth refresh token from env or volume
```

Keep stdio:

```
npm start          → src/index.ts    (local agents)
npm run start:http → src/http.ts     (Railway / Inspector over HTTP)
```

Use **stateless** Streamable HTTP (`sessionIdGenerator: undefined`) so any replica can handle any request. MCP 2026-07-28 no longer requires sticky sessions. Still start with **one replica** until token persistence is proven.

---

## 4. Work that must land in this repo before deploy

Implement these in order. None of them change tool contracts.

### 4.1 HTTP entrypoint

Add `src/http.ts` (name can vary) that:

1. Loads config via existing `loadConfig()`.
2. Builds the MCP server with existing `createServer()`.
3. Serves Streamable HTTP with the official adapters (same stack as Railway’s guide):

   - `@modelcontextprotocol/express` — `createMcpExpressApp({ host: "0.0.0.0" })`
   - `@modelcontextprotocol/node` — `NodeStreamableHTTPServerTransport`

4. Registers:

   - `GET /health` → `{ "ok": true }` (no secrets, no Google calls)
   - `POST /mcp` → MCP handler
   - Optional `GET /mcp` if a client you care about still uses SSE on GET (new clients use POST only)

5. Listens on `Number(process.env.PORT) || 3000` and host `0.0.0.0`.

   Binding `127.0.0.1` (SDK default on some helpers) makes Railway’s proxy look like a DNS-rebinding attack and requests fail. Always pass `host: "0.0.0.0"`.

6. Logs to **stderr** only (same rule as stdio). Do not write MCP JSON-RPC to stdout.

Do **not** replace `src/index.ts`. Local `npm start` stays stdio.

### 4.2 Production start scripts

`tsx` will not exist after a production `npm ci`. Change scripts to:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "tsx src/index.ts",
    "start:http": "node dist/http.js",
    "auth": "tsx src/auth/cli.ts"
  }
}
```

Railway start command: `npm run start:http` (after `npm run build`).

Move runtime HTTP deps to `dependencies` (`express`, `@modelcontextprotocol/express`, `@modelcontextprotocol/node`, `@types/express` as needed). Keep `tsx` as a local/dev convenience.

Confirm `tsc` emits `dist/http.js` (`rootDir` is `src`, `outDir` is `dist`).

### 4.3 Protect `/mcp`

A public Railway domain plus `send_email` is a mail-sending backdoor if unauthenticated.

Required:

- Env `MCP_AUTH_TOKEN` (long random string, 32+ bytes).
- Middleware on `/mcp` only: `Authorization: Bearer <token>`.
- `401` if missing/wrong. Do **not** protect `/health` (Railway healthchecks send no bearer).

Cursor / Claude config must send the same header. Document that the token is **not** a Google token.

Optional later: MCP OAuth resource-server helpers (`requireBearerAuth` in `@modelcontextprotocol/express`). Bearer shared-secret is enough for a personal/team server.

### 4.4 Google tokens that survive deploys

Container filesystem is wiped on every deploy. `.tokens/google-token.json` will vanish.

**Recommended (no volume):** store the refresh token in Railway Variables and teach auth to use it.

| Variable | Role |
|----------|------|
| `GOOGLE_CLIENT_ID` | Existing |
| `GOOGLE_CLIENT_SECRET` | Existing |
| `GOOGLE_REFRESH_TOKEN` | New. Value from local `npm run auth` token file |
| `GOOGLE_TOKEN_PATH` | Optional fallback for local/dev file store |

Behavior:

1. If `GOOGLE_REFRESH_TOKEN` is set, build the OAuth client from env (no file required).
2. Else if the token file exists, keep today’s file path (local stdio).
3. Else tool calls return `AUTH_REQUIRED` (same as now).

Do **not** persist refreshed access tokens back to a file on Railway unless a volume is mounted. Access tokens can live in memory; `googleapis` will refresh using the env refresh token.

**Alternative:** Railway volume mounted at `/data`, `GOOGLE_TOKEN_PATH=/data/google-token.json`. Use this only if you insist on file-shaped tokens. Volumes add brief downtime on redeploy and are easy to mis-mount.

Do **not** commit `token.json`, `credential.json`, `.tokens/`, or `.env`. They are already gitignored.

### 4.5 Config / env updates

Extend `src/config/env.ts` and `.env.example`:

| Variable | Required on Railway | Notes |
|----------|---------------------|--------|
| `GOOGLE_CLIENT_ID` | yes | Same OAuth client as local |
| `GOOGLE_CLIENT_SECRET` | yes | |
| `GOOGLE_REFRESH_TOKEN` | yes (hosted) | From local auth |
| `GOOGLE_REDIRECT_URI` | no | Unused at runtime if you never re-consent on Railway |
| `GOOGLE_TOKEN_PATH` | no | Local only |
| `MCP_AUTH_TOKEN` | yes (hosted) | Bearer for `/mcp` |
| `LOG_LEVEL` | no | Default `info` |
| `PORT` | injected | Never hardcode in code |
| `NODE_ENV` | set `production` | |

`GOOGLE_CLIENT_ID` / `SECRET` remain required at process start (`loadConfig()`). Missing refresh token should not crash boot; first tool call returns `AUTH_REQUIRED`.

### 4.6 Tests

Add focused tests (mocked, no live Google):

- HTTP: `/health` is 200 without auth.
- HTTP: `/mcp` without bearer is 401.
- Auth: `GOOGLE_REFRESH_TOKEN` produces a client without a token file.

Existing tool/service tests stay as they are.

---

## 5. Google Cloud (one-time, mostly already done)

No new APIs. Keep:

- Gmail API
- Google Docs API
- Scopes: `gmail.compose` and `documents` only

### 5.1 How to get a refresh token (do this on your laptop)

Railway cannot complete the current loopback OAuth flow (`127.0.0.1:3000` + opening a browser on the container).

1. Locally: `.env` with client id/secret, then `npm run auth`.
2. Open `.tokens/google-token.json` (gitignored). Copy `refresh_token`.
3. Paste it into Railway as `GOOGLE_REFRESH_TOKEN`.
4. Confirm the JSON includes `"refresh_token"`. If Google omitted it, revoke the app at [Google Account permissions](https://myaccount.google.com/permissions) and run `npm run auth` again (`prompt=consent` is already in `runAuthFlow`).

Desktop OAuth client credentials **can** refresh from Railway. The loopback URI is only for the first consent. You do not need a Web client unless you add an in-cluster re-auth page later.

### 5.2 Later: re-auth without a laptop (optional)

If you want `https://<railway-domain>/oauth2callback`:

1. Create (or convert to) a **Web application** OAuth client.
2. Add that exact HTTPS callback to Authorized redirect URIs.
3. Set `GOOGLE_REDIRECT_URI` on Railway to the same URL.
4. Implement a small HTTP auth route (today `listenForAuthorizationCode` binds loopback only and is not production-safe as-is).

Out of scope for the first Railway ship. Prefer “auth locally, paste refresh token.”

### 5.3 OAuth app in Testing

Sensitive scopes + Testing mode: only listed test users can use the token. That is fine for a personal deploy. Publishing the Google app is a separate Google review, not a Railway step.

---

## 6. Railway project setup

### 6.1 Repo

1. Push this project to GitHub (without `.env`, tokens, `credential.json`).
2. Confirm `.gitignore` still lists `.env`, `.tokens/`, `token.json`, `credentials.json`, `credential.json`.

### 6.2 Create the service

1. [railway.com](https://railway.com) → New project → Deploy from GitHub repo.
2. Select this repository and the branch you want (usually `main`).
3. Railway detects Node via `package.json` and builds with **Railpack**.
4. Set **Start command** to `npm run start:http` if it does not pick it up.
5. **Settings → Networking → Generate domain** (public HTTPS).
6. **Settings → Health check path:** `/health`.
7. Replicas: **1** for v1.
8. Restart policy: on failure (dashboard default is fine).

CLI alternative (same result):

```bash
railway login
railway init
railway up
railway domain
```

### 6.3 Config as code

`railway.toml` / `railway.json` still work for services that already use them, but Railway is moving new projects to dashboard / IaC (`.railway/railway.ts`), and file-based config-as-code is being sunset for **new** services (hard cutoff 2026-12-01). Prefer **dashboard** for a first deploy:

- Builder: Railpack (default)
- Build: `npm ci` + `npm run build` (Railpack runs `build` when present)
- Start: `npm run start:http`
- Healthcheck path: `/health`
- Healthcheck timeout: 30–100 seconds is enough for Node boot

If you add a Dockerfile later, Railway will use it instead of Railpack. Not required for Node 20.

`package.json` already has `"engines": { "node": ">=20" }`. Leave that so the image is Node 20+.

### 6.4 Variables (service → Variables)

Set these in the Railway UI (or `railway variables`). Never commit them.

```
NODE_ENV=production
LOG_LEVEL=info
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
MCP_AUTH_TOKEN=...   # openssl rand -hex 32
```

`PORT` is injected. Do not set it unless you know you need to.

After the first successful deploy, rotate `MCP_AUTH_TOKEN` if it was ever pasted into chat or screenshots.

### 6.5 Volume (only if you skipped `GOOGLE_REFRESH_TOKEN`)

1. Service → Volumes → add volume.
2. Mount path: `/data`.
3. `GOOGLE_TOKEN_PATH=/data/google-token.json`.
4. Seed the file once (one-off shell, or copy from local). Redeploys keep the volume; **code deploys still briefly disconnect** the old replica.

Prefer env refresh token over a volume.

---

## 7. Client connection (after the service is healthy)

Public MCP URL:

```
https://<service>.up.railway.app/mcp
```

### Cursor (`.cursor/mcp.json` or user MCP config)

```json
{
  "mcpServers": {
    "gmail-docs": {
      "url": "https://<service>.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN>"
      }
    }
  }
}
```

Do not put Google client secrets in MCP client config. The Railway service already has them.

### Claude Code

```bash
claude mcp add --transport http gmail-docs https://<service>.up.railway.app/mcp
```

Add the bearer header in the client’s HTTP auth settings if the CLI prompt does not ask for it.

### Claude (web / desktop connectors)

Settings → Connectors → custom connector → same `/mcp` URL and bearer token.

### MCP Inspector (smoke test)

```bash
npx @modelcontextprotocol/inspector
```

Transport: Streamable HTTP. URL: the Railway `/mcp` URL. Header: `Authorization: Bearer <MCP_AUTH_TOKEN>`.

You should see `draft_email`, `send_email`, `append_to_google_doc`.

Local stdio config in the README stays valid for development.

---

## 8. Verification checklist

Do this before calling the deploy done.

### 8.1 Local HTTP (before Railway)

```bash
npm run build
set PORT=3000
set MCP_AUTH_TOKEN=dev-token
npm run start:http
```

- `curl http://127.0.0.1:3000/health` → 200
- `curl http://127.0.0.1:3000/mcp` → 401
- Inspector against `http://127.0.0.1:3000/mcp` with bearer → tools list

### 8.2 Railway deploy

- Build log: `tsc` succeeds; start is `node dist/http.js` (or `npm run start:http`).
- Deploy log: listening on the injected `PORT`, not a crash loop.
- `curl https://<domain>/health` → 200
- `curl https://<domain>/mcp` → 401
- Inspector / Cursor: tools list over HTTPS

### 8.3 Live Google (same as README manual checks)

Use a throwaway recipient and a test Doc:

1. `draft_email` → draft in Gmail, not sent.
2. `send_email` → only with an explicit test; message in Sent.
3. `append_to_google_doc` → text at end; prior content unchanged.

If tools return `AUTH_REQUIRED` / `AUTH_EXPIRED`, the refresh token is missing, truncated, or revoked — fix Variables, do not retry `send_email`.

### 8.4 What success looks like

- Railway service **Active**, healthcheck green.
- Cursor lists the three tools from the **url** server (not the local `command` server), unless you intentionally keep both.
- No tokens or mail bodies in Railway logs (existing logger rules).

---

## 9. Operations

| Topic | Practice |
|-------|----------|
| Logs | Railway → service → Logs. Existing JSON on stderr. Never log tokens or bodies. |
| Redeploy | Git push (if connected) or `railway up`. Env vars persist; container files do not. |
| Token expiry | Refresh tokens last until revoked. `invalid_grant` → local `npm run auth`, update `GOOGLE_REFRESH_TOKEN`. |
| Sleep / hobby | If the plan sleeps the service, first MCP call hits a cold start and may time out. Keep the service awake or accept a retry on **list tools** only — never auto-retry `send_email` / `append_to_google_doc`. |
| Scaling | Stateless HTTP can scale out, but one Google user + in-memory access token is simplest on **one replica**. |
| Rollback | Railway → Deployments → redeploy previous. |
| Domain | Default `*.up.railway.app` is enough. Custom domain is optional (Settings → Networking). |

---

## 10. Security (hosted)

Treat this service as **production credentials for your Gmail**.

- Bearer `MCP_AUTH_TOKEN` on every `/mcp` request.
- Do not screenshot Railway Variables or paste tokens into tickets.
- Least-privilege Google scopes only (already true).
- Public `/health` must not call Google or echo env.
- Railway provides HTTPS; do not disable TLS.
- Optional: skip public domain and use Railway private networking (`http://<service>.railway.internal:PORT/mcp`) if only other Railway services are clients.
- Do not enable unauthenticated MCP “for testing” on a generated public domain.

---

## 11. Implementation sequence

| Phase | Work | Exit criteria |
|-------|------|----------------|
| A | `src/http.ts` + packages + `start:http` + `/health` | Local listen on `PORT`; Inspector lists tools |
| B | Bearer middleware + `MCP_AUTH_TOKEN` | Unauthenticated `/mcp` is 401 |
| C | `GOOGLE_REFRESH_TOKEN` in `google-auth` / config | Tools work with no token file |
| D | Tests for health, 401, env token | `npm test` green |
| E | GitHub + Railway service + Variables + domain | `/health` 200 on HTTPS |
| F | Cursor/Claude remote MCP config | Tools appear; one draft/append smoke test |
| G | Docs: short “Hosted (Railway)” section in README linking here | Operators can repeat the deploy |

Phase A–D are **code**. Phase E–G are **ops**. This document is the plan; it does not by itself change runtime behavior.

---

## 12. Risks and non-goals

**Risks**

- Deploying current `npm start` → crash (no HTTP server).
- Production install without `tsc` output / without moving HTTP deps to `dependencies`.
- Binding `127.0.0.1` → Railway proxy cannot reach the app.
- Healthcheck on `/mcp` → fails (needs JSON-RPC + auth).
- Ephemeral disk → silent `AUTH_REQUIRED` after first redeploy if tokens stay file-only.
- Public unauthenticated `/mcp` → anyone can send mail as you.
- Auto-retry of send/append after timeouts → duplicates (same rule as local).

**Non-goals for the first Railway ship**

- Multi-user Google OAuth / per-request Google tokens
- HTTP+SSE legacy `/sse` transport
- In-cluster interactive `npm run auth`
- Postgres or any DB (tools are Google APIs, not app state)
- Changing tool schemas or adding Workspace APIs
- Replacing local stdio

---

## 13. Decision summary

| Decision | Choice |
|----------|--------|
| Platform | Railway, one Node service, public HTTPS domain |
| MCP transport | Streamable HTTP `POST /mcp`, stateless |
| Local transport | Keep stdio `src/index.ts` |
| Process | `node dist/http.js` after `tsc` |
| Port | `process.env.PORT`, bind `0.0.0.0` |
| Google identity | Same single-user refresh token as local auth |
| Token persistence | `GOOGLE_REFRESH_TOKEN` env (volume optional) |
| MCP access control | Shared bearer `MCP_AUTH_TOKEN` |
| Google re-consent | Laptop `npm run auth`, then update Railway variable |

When phases A–C are implemented, this plan is executable as a Railway deploy without further design.
