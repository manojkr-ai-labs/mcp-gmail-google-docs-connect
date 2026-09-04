# Architecture: Generic Gmail & Google Docs MCP Server

This document is the design for implementing the MCP server described in [problemStatement.md](./problemStatement.md). It records technology choices, layer boundaries, tool contracts, authentication, error handling, and testing so implementation can proceed without inventing architecture on the fly.

The server is a **standalone, reusable MCP integration**. It is not an agent. Any MCP-compatible client may connect, discover tools, and invoke them. Agent-specific prompts, routing, or hardcoded recipients do not belong in this codebase.

---

## 1. Purpose

The server exposes three MCP tools that call official Google APIs on behalf of an authenticated Google user:

| Tool | Side effect | Google API |
|------|-------------|------------|
| `draft_email` | Creates a Gmail draft. Does **not** send. | Gmail `users.drafts.create` |
| `send_email` | Sends an email. Irreversible external action. | Gmail `users.messages.send` |
| `append_to_google_doc` | Inserts text at the end of an existing Doc. Never replaces existing content. | Docs `documents.get` + `documents.batchUpdate` |

The MCP server is responsible for:

- Exposing standardized tools with agent-oriented descriptions
- Validating inputs before any Google call
- Authenticating with Google using least-privilege OAuth
- Mapping validated requests onto Gmail / Docs APIs
- Returning predictable, machine-readable results
- Handling errors without leaking secrets

The MCP client / AI agent is responsible for:

- Deciding **when** to call a tool
- Supplying **what** content to send or append
- Distinguishing draft vs send from tool descriptions

---

## 2. Design Principles

1. **Generic over agent-specific.** No Cursor-, Claude-, or app-specific logic. Tool names, schemas, and responses follow MCP conventions only.
2. **Thin tools, real services.** MCP handlers validate, call a service, and format the result. Google wire details live in the service layer.
3. **Least privilege.** Request only the OAuth scopes required for draft, send, and append.
4. **Fail closed.** Invalid input never reaches Google. Side-effecting tools never retry automatically.
5. **Explicit side effects.** `draft_email` and `send_email` are separate tools. The server never infers send permission from generated content.
6. **Simple over clever.** No plugin framework, no DI container, no unused Workspace APIs. Extension is adding a tool + service method.
7. **Secrets stay out of the repo.** Credentials and tokens come from environment / a local token file that is gitignored.

---

## 3. Non-Goals (v1)

Do not implement:

- Gmail inbox, search, read, reply, delete, or labels
- Creating, reading, or section-editing Google Docs beyond append
- Drive, Sheets, Calendar, file upload, or admin APIs
- HTML email (schema may allow a later `bodyHtml` without a rewrite)
- Multi-user hosted SaaS / per-request OAuth for remote HTTP clients
- Automatic retries of `send_email` or `append_to_google_doc`

---

## 4. Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | TypeScript on Node.js 20+ | Official MCP SDK, official `googleapis` client, JSON Schema / Zod fit MCP tools naturally |
| Package manager | npm | Default, no extra toolchain |
| MCP SDK | Official TypeScript MCP SDK (`@modelcontextprotocol/sdk`, or `@modelcontextprotocol/server` if the v2 stdio API is the documented path at implementation time) | Standards-based tool discovery and invocation |
| Transport (v1) | **stdio** | How Cursor, Claude Desktop, and most local MCP clients launch a server |
| Google APIs | `googleapis` npm package | Official Gmail + Docs clients |
| Validation | Zod | Runtime schemas that also generate MCP tool input schemas |
| Config | `dotenv` + process environment | Matches the problem statement; `.env` is gitignored |
| Tests | Node.js built-in test runner (`node:test`) + TypeScript | No extra test framework unless one is already present |
| Logging | Structured JSON to stderr | stdout is reserved for MCP stdio framing |

If the existing repo already uses Python when implementation starts, keep Python and the official Python MCP SDK. Do not rewrite a working stack. As of this document the repo contains only the problem statement, so TypeScript is the default.

### 4.1 MCP SDK usage rules

- Register tools with the SDK so clients can **discover** them (`tools/list` or the equivalent discover RPC).
- Do not hand-roll JSON-RPC.
- Keep Google clients **out** of the MCP server constructor. Inject or lazily create them from the auth module so tests can mock services.
- stdout is the MCP byte stream. All logs go to stderr.

### 4.2 Transport

v1 supports **stdio only**.

```
MCP Client (Cursor, Claude Desktop, other)
        │
        │ spawn process, stdin/stdout JSON-RPC
        ▼
   Node.js MCP server
```

HTTP / Streamable HTTP is out of scope. The module layout should not block adding it later (server factory separate from transport wiring).

---

## 5. High-Level Architecture

```
┌─────────────────────────────────────────┐
│  Any MCP-compatible AI agent / client   │
└────────────────────┬────────────────────┘
                     │ MCP (stdio)
                     ▼
┌─────────────────────────────────────────┐
│  MCP Tool Layer                         │
│  draft_email                            │
│  send_email                             │
│  append_to_google_doc                   │
│  (schemas, descriptions, result wrap)   │
└────────────────────┬────────────────────┘
                     │ validated DTOs
                     ▼
┌─────────────────────────────────────────┐
│  Service / Integration Layer            │
│  GmailService                           │
│  GoogleDocsService                      │
│  (MIME, Docs insert, API mapping)       │
└────────────────────┬────────────────────┘
                     │ authenticated clients
                     ▼
┌─────────────────────────────────────────┐
│  Auth + Config                          │
│  OAuth 2.0 desktop flow, token store    │
│  least-privilege scopes                 │
└────────────────────┬────────────────────┘
                     ▼
┌─────────────────────────────────────────┐
│  Google APIs                            │
│  Gmail API    Google Docs API           │
└─────────────────────────────────────────┘
```

Data never flows from an agent into Google without passing validation. Services never import MCP types. Tools never import `googleapis` directly.

---

## 6. Layer Responsibilities

### 6.1 MCP server / transport

- Create the MCP server instance
- Register the three tools
- Connect stdio transport
- Process-level error handling (crash vs tool error)

File: `src/server/create-server.ts`  
Entry: `src/index.ts`

### 6.2 Tool layer

Each tool is a module that exports:

- `name`
- `description` (written for an AI agent: what, when, required inputs, side effects)
- Zod `inputSchema`
- `handler(input) -> ToolResult`

The handler:

1. Relies on Zod for shape validation (SDK should reject bad args before the handler)
2. Runs extra domain rules if needed (email format, doc id, content length)
3. Calls exactly one service method
4. Maps `AppError` / success into the standard result envelope
5. Logs tool name, success/failure, error code, duration — never bodies or tokens

### 6.3 Service layer

- `GmailService.draftEmail(request)` / `GmailService.sendEmail(request)`
- `GoogleDocsService.appendText(request)`

Services own:

- RFC 2822 MIME construction
- `users.drafts.create` / `users.messages.send`
- Docs end-of-body insert via `endOfSegmentLocation`
- Mapping Google HTTP errors to `AppError`

Services do **not** retry `send` or `append`.

### 6.4 Auth layer

- Load OAuth client id/secret from env
- Desktop (installed-app) OAuth 2.0 with local refresh-token storage
- Refresh access tokens; trigger interactive consent only when no valid refresh token exists
- Build authenticated `gmail` and `docs` clients
- Never log tokens or client secrets

### 6.5 Validation layer

Pure functions, no I/O:

- Email address format and non-empty `to`
- Optional CC/BCC arrays
- Document ID (non-empty, reasonable charset/length)
- Append content (non-empty string, max length)

Used by tools (and unit-tested without Google).

### 6.6 Config layer

- Read and validate required env vars at startup
- Resolve token file path
- Export typed `Config`
- Fail fast with a clear message if required config is missing

---

## 7. Project Structure

```
mcp-4/
├── docs/
│   ├── problemStatement.md
│   └── architecture.md
├── src/
│   ├── index.ts                      # stdio entrypoint
│   ├── server/
│   │   └── create-server.ts          # MCP server factory + tool registration
│   ├── tools/
│   │   ├── result.ts                 # success/error envelope helpers
│   │   ├── gmail/
│   │   │   ├── draft-email.ts
│   │   │   └── send-email.ts
│   │   └── google-docs/
│   │       └── append-to-google-doc.ts
│   ├── services/
│   │   ├── gmail-service.ts
│   │   ├── google-docs-service.ts
│   │   └── mime.ts                   # RFC 2822 message builder
│   ├── auth/
│   │   └── google-auth.ts
│   ├── validation/
│   │   ├── email.ts
│   │   └── document.ts
│   ├── errors/
│   │   └── app-error.ts
│   ├── logging/
│   │   └── logger.ts
│   └── config/
│       └── env.ts
├── tests/
│   ├── validation/
│   ├── services/
│   └── tools/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

Keep the tree shallow. Add `src/tools/gmail/` and `src/services/` siblings when a new Workspace API is introduced — do not introduce a plugin registry in v1.

---

## 8. MCP Tool Contracts

All tools return **text content** whose payload is JSON matching the envelope in §11. Do not return raw Gmail/Docs API JSON to the client.

### 8.1 `draft_email`

**When to use:** Create a Gmail draft the user can review. Do not use this tool when the user asked to send.

**Side effect:** Writes a draft in the authenticated user's Gmail. Does not send.

| Field | Required | Type | Notes |
|-------|----------|------|--------|
| `to` | yes | `string[]` (min 1) | Recipients |
| `subject` | yes | `string` | May be empty string only if explicitly allowed; prefer requiring non-empty |
| `body` | yes | `string` | Plain text |
| `cc` | no | `string[]` | |
| `bcc` | no | `string[]` | |
| `threadId` | no | `string` | Gmail thread id if replying in-thread |
| `inReplyTo` | no | `string` | RFC `In-Reply-To` / `References` Message-ID |

**Success `data` (minimum):**

```json
{
  "draftId": "r-...",
  "messageId": "msg-...",
  "threadId": "thread-..."
}
```

### 8.2 `send_email`

**When to use:** Only when the user (or a confirmed workflow) explicitly asked to send. Irreversible.

**Side effect:** Delivers email via Gmail. Duplicate calls can send duplicate messages.

| Field | Required | Type | Notes |
|-------|----------|------|--------|
| `to` | yes | `string[]` (min 1) | Same as draft |
| `subject` | yes | `string` | |
| `body` | yes | `string` | Plain text |
| `cc` | no | `string[]` | |
| `bcc` | no | `string[]` | |
| `threadId` | no | `string` | |
| `inReplyTo` | no | `string` | |

**Description must state** that this sends immediately and is not a draft.

**Success `data` (minimum):**

```json
{
  "messageId": "msg-...",
  "threadId": "thread-...",
  "labelIds": ["SENT"]
}
```

Optional v1 extension (schema only if cheap): `clientRequestId` string, accepted and ignored except for logging. Reserved for future idempotency.

### 8.3 `append_to_google_doc`

**When to use:** Add text to the **end** of a document the user already has. Do not create a new doc. Do not overwrite.

**Side effect:** Mutates the document. A retry after an uncertain response may append twice.

| Field | Required | Type | Notes |
|-------|----------|------|--------|
| `documentId` | yes | `string` | ID from the Docs URL (`/document/d/{id}/`) |
| `content` | yes | `string` | Non-empty; max length enforced |
| `prependNewline` | no | `boolean` | Default `true` so append does not glue onto the last line |

**Success `data` (minimum):**

```json
{
  "documentId": "...",
  "title": "...",
  "appendedCharacterCount": 120
}
```

Do not return document body content.

### 8.4 Tool description rules

Each description must tell an agent:

1. What the tool does
2. When to use it vs the sibling tools
3. Required vs optional inputs
4. Whether it causes an irreversible external side effect

Example distinction:

- `draft_email`: "Creates a draft only. The message is not sent."
- `send_email`: "Sends the email immediately via Gmail. This cannot be undone. Do not use this to create a draft."

---

## 9. Validation Rules

Reject before any Google call.

### Email tools (`draft_email`, `send_email`)

- `to` present, length ≥ 1
- Every address in `to` / `cc` / `bcc` matches a practical email regex (local@domain); trim whitespace
- Reject empty strings inside recipient arrays
- `subject` and `body` are strings
- `subject` max length: 998 characters (RFC 5322 line practicality)
- `body` max length: 1_000_000 characters (reject obviously huge payloads)
- Duplicate addresses across to/cc/bcc are allowed (Gmail handles them); no extra logic required

### `append_to_google_doc`

- `documentId` non-empty after trim; allow typical Docs IDs (`[a-zA-Z0-9_-]+`), length 10–128
- `content` is a string, length 1..100_000 after the optional newline is applied (or enforce on the raw `content` field — pick one and document it in code)
- Reject null/undefined/non-string content

Validation failures use `INVALID_PARAMS` (see §11).

---

## 10. Authentication and Authorization

### 10.1 Flow

Use **OAuth 2.0 installed-app (desktop)** credentials. A local MCP server acts as one Google user (the person who ran the consent flow).

```
First run, no token file
  → open system browser (or print URL)
  → loopback redirect (GOOGLE_REDIRECT_URI)
  → persist refresh token to GOOGLE_TOKEN_PATH

Later runs
  → load refresh token
  → google-auth-library refreshes access token
  → if refresh fails (revoked/expired grant) → AUTH_EXPIRED, do not loop silently
```

Do not use service accounts for v1 (Gmail of a consumer user is not available without domain-wide delegation).

Do not implement a full multi-user OAuth server. One token store per MCP process/user is enough.

### 10.2 Scopes (least privilege)

| Scope | Why |
|-------|-----|
| `https://www.googleapis.com/auth/gmail.compose` | Create drafts **and** send. `gmail.send` cannot create drafts. |
| `https://www.googleapis.com/auth/documents` | Read document structure (end of body) and insert text. |

Do **not** request:

- `https://mail.google.com/` (full mail, delete)
- `gmail.modify` / `gmail.readonly` (inbox read — not needed)
- `drive` / `drive.readonly` (restricted / too broad)
- `documents.readonly` alone (cannot append)

`gmail.compose` is Sensitive; `documents` is Sensitive. README must cover consent-screen setup and test users.

`drive.file` is **not** sufficient for appending to arbitrary existing docs the user did not create through this app. Omit it in v1.

### 10.3 Credential storage

| Item | Location |
|------|----------|
| Client ID / secret | Environment (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) |
| Redirect URI | Environment (`GOOGLE_REDIRECT_URI`, default `http://127.0.0.1:3000/oauth2callback` or the Google Desktop default) |
| Refresh + access tokens | File at `GOOGLE_TOKEN_PATH` (default: user config dir or `./.tokens/google-token.json`) |

`.gitignore` must include `.env`, `.tokens/`, `token.json`, and `credentials.json`.

Never commit client secrets or tokens. Never write them to logs.

### 10.4 Authorization at runtime

Operations run only as the consented user. The server does not accept a Google access token from the MCP client in v1 (that would couple us to a specific host). Document IDs and email addresses in tool arguments are **not** a privilege escalation path: Google still enforces ACL; we map 403/404 to `ACCESS_DENIED` / `DOCUMENT_NOT_FOUND`.

---

## 11. Result Envelope and Errors

### 11.1 Envelope

Success:

```json
{
  "success": true,
  "data": { }
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

MCP-level: return this JSON as the tool's text result. Prefer `isError: true` on the MCP tool result when `success` is false, if the SDK supports it, so clients distinguish failures from successful "error JSON as content".

### 11.2 Error codes

| Code | Typical cause | Agent hint |
|------|----------------|------------|
| `INVALID_PARAMS` | Schema / email / doc id / empty content | Fix arguments; do not retry as-is |
| `AUTH_REQUIRED` | No token file | User must complete OAuth |
| `AUTH_EXPIRED` | Refresh token revoked or invalid | User must re-authorize |
| `INSUFFICIENT_SCOPE` | 403 insufficientPermissions | Re-consent with required scopes |
| `DOCUMENT_NOT_FOUND` | Docs 404 | Check document ID and sharing |
| `ACCESS_DENIED` | 403 on Doc or Gmail | User cannot access that resource |
| `GMAIL_API_ERROR` | Other Gmail 4xx/5xx | Surface Google `message` if safe |
| `DOCS_API_ERROR` | Other Docs 4xx/5xx | Same |
| `RATE_LIMITED` | 429 | Wait; do not immediately retry send/append |
| `NETWORK_ERROR` | DNS, reset, timeout | Transient; retrying **send/append is unsafe** |
| `INTERNAL_ERROR` | Unexpected bug | Do not include stack traces in the tool payload |

`AppError` is a typed error with `code`, `message`, and optional `cause` (logged, not returned).

Google error mapping (conceptual):

- 401 → `AUTH_EXPIRED`
- 403 `insufficientPermissions` → `INSUFFICIENT_SCOPE`
- 403 otherwise → `ACCESS_DENIED`
- 404 on documents → `DOCUMENT_NOT_FOUND`
- 429 → `RATE_LIMITED`
- 5xx → `GMAIL_API_ERROR` / `DOCS_API_ERROR`
- Network failures → `NETWORK_ERROR`

Sanitize messages: strip tokens, `Bearer`, client secrets, and file paths that contain home directories if they appear in library errors.

---

## 12. Gmail Message Construction

Build a valid RFC 2822 **plain-text** message, then base64url-encode it for the Gmail `raw` field.

Required headers:

- `To`, `Subject`
- `Content-Type: text/plain; charset=UTF-8`
- `MIME-Version: 1.0`

Optional:

- `Cc`, `Bcc`
- `In-Reply-To`, `References` when `inReplyTo` is set
- `threadId` is passed to the Gmail API request body, not as a MIME header

Subject: encode non-ASCII with RFC 2047 (`=?UTF-8?B?...?=`).

Do not send mail through SMTP. Use:

- Draft: `gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId? } } })`
- Send: `gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId? } })`

`mime.ts` should stay independent of the Gmail client so HTML multipart can be added later (`bodyHtml`) without rewriting the service.

---

## 13. Google Docs Append Behavior

Goal: **insert at end of document body**, never `deleteContentRange` / replace.

Preferred API (avoids manual endIndex math):

```json
{
  "requests": [
    {
      "insertText": {
        "endOfSegmentLocation": { "segmentId": "" },
        "text": "<optional \\n> + content"
      }
    }
  ]
}
```

Empty `segmentId` means the document body.

Newline policy:

- Default `prependNewline: true` so new text starts on a new paragraph/line
- If the document is empty, a leading newline is acceptable; do not special-case unless tests show a product issue

Optional `documents.get` (fields: `title`, `documentId`) **after** a successful append to populate the success payload. Do not fetch or return the full body.

If `documents.get` is used **before** append (e.g. to confirm the doc exists), it must not be used to compute a replace range.

---

## 14. Idempotency and Retries

| Tool | Duplicate risk | v1 policy |
|------|----------------|-----------|
| `draft_email` | Extra drafts | Acceptable; no auto-retry |
| `send_email` | Duplicate delivery | **Harmful.** No client or server auto-retry |
| `append_to_google_doc` | Duplicate paragraphs | **Harmful.** No auto-retry |

Implementation rules:

- No retry loops in services for send/append
- Timeouts and `NETWORK_ERROR` must be described as **uncertain** — the agent must not assume failure and blindly retry send/append
- Confirmed HTTP 200 from Gmail send is success; do not treat "no parseable body" after 200 as a retry trigger
- Document this in README troubleshooting

Future (not v1): persist `clientRequestId` → Gmail `messageId` and short-circuit duplicates.

---

## 15. Configuration

### 15.1 Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | yes | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | no | Installed-app redirect; document the default |
| `GOOGLE_TOKEN_PATH` | no | Path to stored OAuth tokens |
| `LOG_LEVEL` | no | `debug` \| `info` \| `warn` \| `error` (default `info`) |

Ship `.env.example` with empty placeholders. Load `.env` only in local/dev; production MCP hosts typically inject env.

### 15.2 Startup

`src/config/env.ts` validates required vars. Missing client ID/secret: exit with a stderr message pointing at `.env.example`. Missing token file is **not** a startup crash — the first tool call returns `AUTH_REQUIRED` (or a dedicated `auth` CLI script documented in README).

Recommended DX: `npm run auth` performs the browser consent flow so the MCP server itself does not need to print URLs on the MCP stdout channel.

---

## 16. Logging

Destination: **stderr**, one JSON object per event.

Log:

- Tool name
- Outcome (`success` / `failure`)
- `error.code` when failed
- Duration ms
- Google operation (`drafts.create`, `messages.send`, `documents.batchUpdate`)
- Optional truncated `documentId` / recipient **count** (not addresses, unless `LOG_LEVEL=debug` and even then prefer counts)

Never log:

- Access tokens, refresh tokens, client secrets
- Full email bodies
- Document contents
- Raw Google response bodies that may include message snippets

---

## 17. Security

- OAuth desktop flow + stored refresh token, file permissions as restrictive as the OS allows
- Least-privilege scopes only
- All tool inputs validated
- Tool arguments cannot select arbitrary Google APIs — only the three operations
- Errors and logs scrub secrets
- `send_email` is opt-in by tool choice, not by model prose
- Depend only on official MCP + Google libraries; pin versions in `package.json`
- No eval of agent-supplied code

---

## 18. Testing Strategy

Mock Google API clients. Do not require a live Gmail/Docs account in CI.

### 18.1 Validation (unit)

- Valid / invalid emails, empty `to`, bad CC
- Missing subject/body types
- Doc ID present / malformed
- Empty and overlong content

### 18.2 Gmail service (unit, mocked `googleapis`)

- Draft: `drafts.create` called with `raw` MIME containing To/Subject/body; not `messages.send`
- Send: `messages.send` called; not `drafts.create`
- CC/BCC appear in MIME
- API 403/404/500 map to the correct `AppError` code
- Auth errors map to `AUTH_*`

### 18.3 Docs service (unit, mocked)

- `insertText` + `endOfSegmentLocation`
- Default prepend newline
- 404 → `DOCUMENT_NOT_FOUND`
- 403 → `ACCESS_DENIED`

### 18.4 MIME builder

- Headers and body
- UTF-8 subject encoding
- Round-trip base64url

### 18.5 MCP / tools

- Server registers exactly the three tool names
- Invalid args → `INVALID_PARAMS` (or SDK schema error) without calling services
- Handler success envelope
- Handler failure envelope + `isError` if used

### 18.6 What is out of CI

Live OAuth and live send/append. Document a short **manual** checklist in README (draft visible in Gmail, send arrives, Doc append preserves prior text).

---

## 19. Extensibility

Add a capability by:

1. New file under `src/tools/<area>/`
2. Method on an existing service or a new `src/services/<area>-service.ts`
3. Register the tool in `create-server.ts`
4. Tests + README row

Do not add Sheets, Drive, Calendar, or Gmail read in v1. Auth scopes stay minimal until a new tool truly needs another scope (re-consent required).

---

## 20. Implementation Sequence

Aligns with the problem statement phases. Implement in this order so each step is testable:

1. **Scaffold** — `package.json`, TypeScript, `.gitignore`, `.env.example`, config loader, logger, `AppError`
2. **Auth** — desktop OAuth + `npm run auth` + token file
3. **MIME + GmailService** — draft and send against mocked clients, then optional manual check
4. **GoogleDocsService** — append with `endOfSegmentLocation`
5. **MCP tools** — register three tools, wire validation + envelope
6. **stdio server** — `src/index.ts`, verify tool discovery with an MCP inspector or client
7. **Tests** — validation, services, tool handlers
8. **README** — setup, scopes, env, connecting a generic MCP client, examples, security, troubleshooting

Definition of done is the checklist in problemStatement.md §23. This architecture is complete when those items are implementable without further design invention.

---

## 21. Runtime Flow Examples

### Draft

```
Agent  --draft_email-->  Tool  --DraftEmailRequest-->  GmailService
                                                       MIME + drafts.create
                         Tool  <-- { draftId, ... } --
Agent  <-- success JSON --
```

### Send

```
Agent  --send_email-->  Tool  --SendEmailRequest-->  GmailService
                                                     MIME + messages.send
                                                     (no retry)
Agent  <-- success { messageId } or NETWORK_ERROR (uncertain) --
```

### Append

```
Agent  --append_to_google_doc-->  Tool  -->  GoogleDocsService
                                             batchUpdate insertText at end
Agent  <-- success { documentId, title } --
```

---

## 22. Decisions Log

| Decision | Choice | Alternative rejected |
|----------|--------|----------------------|
| Language | TypeScript / Node 20+ | Python — equally valid; TS chosen because the repo is empty and the TS MCP SDK is the common local-server path |
| Transport | stdio | HTTP — not needed for local agents in v1 |
| Gmail send vs draft | Two tools | One tool with `mode` — too easy for an agent to send by mistake |
| Gmail scope | `gmail.compose` | `gmail.send` + `gmail.compose` redundant; `gmail.modify` too broad |
| Docs insert | `endOfSegmentLocation` | Manual `endIndex - 1` — extra get + off-by-one risk |
| Token model | Single-user desktop OAuth | Per-request tokens from the agent — couples the server to one host |
| Retries | None on send/append | Exponential backoff — unsafe duplicates |
| Result format | `{ success, data \| error }` JSON text | Raw Google payloads — unstable and leaky |

If implementation discovers that the installed MCP SDK's stdio API differs (v1 `StdioServerTransport` vs v2 `serveStdio`), keep these layer boundaries and only change `src/index.ts` / `create-server.ts`.
