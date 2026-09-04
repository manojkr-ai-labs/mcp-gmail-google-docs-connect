# Problem Statement: Generic Gmail & Google Docs MCP Server

## 1. Overview

We need to build a **generic Model Context Protocol (MCP) server** that
provides reusable tools for AI agents to interact with:

1.  **Gmail** --- draft and send emails.
2.  **Google Docs** --- append content to an existing Google Doc.

The MCP server must be designed as a **standalone, reusable integration
service**, not as an implementation tightly coupled to one specific AI
agent or application.

Any MCP-compatible AI agent/client should be able to connect to this
server and discover and use the available tools through the standard MCP
protocol.

------------------------------------------------------------------------

## 2. Goals

The primary goals are:

-   Build a standards-based MCP server.
-   Provide Gmail email drafting and sending capabilities.
-   Provide Google Docs content-appending capability.
-   Keep the server generic so multiple AI agents can use it.
-   Use official Google APIs for Gmail and Google Docs.
-   Implement secure authentication and authorization.
-   Expose clear, well-defined MCP tools with strong input validation.
-   Return predictable, machine-readable results to AI agents.
-   Keep provider-specific implementation details behind the MCP tool
    interface.
-   Make the code modular and easy to extend with additional Google
    Workspace tools later.

------------------------------------------------------------------------

## 3. Core Functionalities

### 3.1 Gmail: Draft and Send Email

The MCP server must provide functionality for an AI agent to work with
Gmail.

At minimum, support:

#### A. Create/Draft Email

The AI agent should be able to create a Gmail draft without sending it.

Inputs should include:

-   Recipient (`to`)
-   Optional CC recipients
-   Optional BCC recipients
-   Subject
-   Email body
-   Optional reply/thread information if supported by the implementation

Expected behavior:

-   Validate the email request.
-   Create the draft using the Gmail API.
-   Return a structured result containing enough information for the AI
    agent to understand that the draft was created successfully.
-   Do not send the email when the agent explicitly requests only a
    draft.

#### B. Send Email

The AI agent should be able to send an email through Gmail.

Inputs should include:

-   Recipient (`to`)
-   Optional CC recipients
-   Optional BCC recipients
-   Subject
-   Email body
-   Optional reply/thread information if supported

Expected behavior:

-   Validate the input.
-   Construct a valid Gmail message.
-   Send the message through the Gmail API.
-   Return a structured success response.
-   Return a clear error if sending fails.

### Important Safety Requirement

Sending an email is an external side effect.

The MCP server must **not infer permission to send an email merely
because an AI agent generated email content**.

The tool interface should make the distinction between:

-   `draft_email`
-   `send_email`

very explicit.

The AI agent/client should be able to determine from the tool
description that `send_email` performs an irreversible external action.

------------------------------------------------------------------------

## 4. Google Docs: Append Content

The MCP server must provide a tool that allows an AI agent to append
content to an existing Google Doc.

### Append Content Tool

Inputs should include:

-   Google Doc ID
-   Content to append

Optional inputs may include:

-   Formatting options, if supported
-   Text/newline behavior
-   Content type, if the implementation later supports richer document
    content

Expected behavior:

1.  Validate the Google Doc ID.
2.  Validate the content.
3.  Authenticate with Google.
4.  Retrieve the document metadata/content as required.
5.  Determine the correct insertion location at the end of the document.
6.  Append the requested content using the Google Docs API.
7.  Return a structured success response.

The implementation should avoid overwriting existing document content.

The primary operation is **append**, not replace.

------------------------------------------------------------------------

## 5. MCP Server Requirements

The server must implement the **Model Context Protocol** correctly.

### Tool Discovery

An MCP client should be able to connect to the server and discover the
available tools.

The initial tool set should include:

-   `draft_email`
-   `send_email`
-   `append_to_google_doc`

Each tool must have:

-   A clear name.
-   A clear description.
-   A well-defined input schema.
-   Required and optional parameters.
-   Input validation.
-   Predictable output.
-   Meaningful error responses.

Tool descriptions should be written for AI agents, so the agent can
understand:

-   What the tool does.
-   When to use it.
-   What inputs are required.
-   Whether it causes an external side effect.

------------------------------------------------------------------------

## 6. Generic Architecture

The MCP server must **not be tightly coupled to a single AI agent**.

Recommended logical architecture:

``` text
AI Agent / MCP Client
        |
        | MCP
        v
+-----------------------------+
| Generic MCP Server          |
|                             |
|  MCP Tool Layer             |
|  -------------------------  |
|  draft_email                |
|  send_email                 |
|  append_to_google_doc       |
+-------------+---------------+
              |
              v
+-----------------------------+
| Service / Integration Layer |
|                             |
| Gmail Service               |
| Google Docs Service         |
+-------------+---------------+
              |
              v
+-----------------------------+
| Google APIs                 |
|                             |
| Gmail API                   |
| Google Docs API             |
+-----------------------------+
```

The MCP tool layer should remain independent from the specific AI agent.

The integration/service layer should encapsulate Google API-specific
implementation details.

------------------------------------------------------------------------

## 7. Authentication and Authorization

The implementation must use secure Google authentication.

The server should support the appropriate OAuth 2.0 flow for accessing:

-   Gmail
-   Google Docs

Use the minimum required Google OAuth scopes.

At a conceptual level, the server needs permissions for:

### Gmail

Permissions required for:

-   Creating Gmail drafts.
-   Sending Gmail messages.

### Google Docs

Permissions required for:

-   Reading the required document metadata/content.
-   Updating/appending content to the document.

Do not request broad Google Workspace permissions when narrower scopes
are sufficient.

### Credential Security

Do not:

-   Hard-code credentials.
-   Commit client secrets to source control.
-   Store access tokens in source code.
-   Log OAuth tokens.
-   Log sensitive email contents unnecessarily.

Sensitive configuration must be supplied through environment variables
or an appropriate secure configuration mechanism.

------------------------------------------------------------------------

## 8. Configuration

Configuration should be externalized.

The server should support configuration such as:

``` text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
GOOGLE_TOKEN / credential storage configuration
```

The exact configuration mechanism can be determined during
implementation.

Create a clear `.env.example` if environment variables are required.

Do not commit actual credentials.

------------------------------------------------------------------------

## 9. Input Validation

Every MCP tool must validate its inputs before calling Google APIs.

### `draft_email`

Validate:

-   At least one recipient.
-   Valid email address format.
-   Subject/body types.
-   Optional CC/BCC values.

### `send_email`

Validate:

-   At least one recipient.
-   Valid email address format.
-   Subject/body types.
-   Optional CC/BCC values.

### `append_to_google_doc`

Validate:

-   Google Doc ID is present.
-   Content is present and is a string.
-   Content length is reasonable.
-   Reject malformed input before calling the Google API.

Validation errors should be returned as clear tool errors.

------------------------------------------------------------------------

## 10. Error Handling

The MCP server must provide useful, structured errors.

Handle at least:

-   Authentication failures.
-   Expired/invalid OAuth credentials.
-   Insufficient Google API permissions.
-   Invalid email addresses.
-   Gmail API errors.
-   Google Docs API errors.
-   Invalid document IDs.
-   Document not found.
-   Access denied.
-   Invalid tool parameters.
-   Network/API failures.
-   Rate limiting where applicable.

Errors should not expose:

-   OAuth access tokens.
-   Client secrets.
-   Sensitive credentials.
-   Unnecessary internal stack traces to the MCP client.

Errors should contain enough information for an AI agent to determine
the next appropriate action.

Example conceptual response:

``` json
{
  "success": false,
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "The requested Google Doc could not be found or is not accessible."
  }
}
```

------------------------------------------------------------------------

## 11. Response Format

Tool responses should be consistent and easy for AI agents to interpret.

For successful operations, use a predictable structure such as:

``` json
{
  "success": true,
  "data": {
    "...": "..."
  }
}
```

For failures:

``` json
{
  "success": false,
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

The exact MCP response mechanism should follow the MCP SDK/protocol
conventions used by the implementation language.

Do not unnecessarily expose raw Google API responses.

------------------------------------------------------------------------

## 12. Email Message Construction

The Gmail integration must construct valid email messages compatible
with the Gmail API.

Support:

-   To
-   CC
-   BCC
-   Subject
-   Plain-text body

The architecture should make it possible to add HTML email support later
without requiring a major rewrite.

Do not implement email transmission manually if the official Gmail API
provides the required functionality.

------------------------------------------------------------------------

## 13. Google Docs Append Behavior

Appending content must preserve existing document content.

The implementation should:

1.  Open/inspect the target document as necessary.
2.  Determine the current document end index.
3.  Insert the new content at the appropriate location.
4.  Preserve existing content.
5.  Avoid replacing or deleting existing content unintentionally.

Consider newline handling carefully so appended content does not
unexpectedly merge with the last existing line.

------------------------------------------------------------------------

## 14. Idempotency and Duplicate Actions

The implementation should consider the possibility that an AI agent may
retry a tool call because of a timeout or unclear response.

For `send_email`, duplicate sends can be harmful.

Design the service so that idempotency can be supported or extended in
the future.

At minimum:

-   Document the duplicate-send risk.
-   Avoid automatic retries that could unintentionally send the same
    email multiple times.
-   Clearly distinguish transient API errors from confirmed successful
    sends.

For `append_to_google_doc`, consider that retrying after an uncertain
response may append the same content twice.

The design should make future idempotency support possible.

------------------------------------------------------------------------

## 15. Logging

Implement useful operational logging without exposing sensitive
information.

Log things such as:

-   Tool invocation name.
-   Success/failure.
-   Error category.
-   Request duration.
-   Google API operation type.

Do NOT log:

-   OAuth access tokens.
-   Refresh tokens.
-   Client secrets.
-   Full email bodies unless explicitly required for debugging.
-   Sensitive document contents.

------------------------------------------------------------------------

## 16. Security Requirements

Security is a first-class requirement.

The implementation must:

-   Follow OAuth best practices.
-   Use least-privilege scopes.
-   Keep credentials outside source control.
-   Validate all tool inputs.
-   Avoid leaking credentials through errors/logs.
-   Avoid arbitrary Google API access based solely on uncontrolled
    AI-agent input.
-   Restrict operations to the authenticated user's authorized Google
    resources.
-   Clearly distinguish read/write/send operations.

------------------------------------------------------------------------

## 17. Project Structure

Use a clean modular project structure.

A conceptual structure could be:

``` text
mcp-server/
├── src/
│   ├── server/
│   │   └── ...
│   ├── tools/
│   │   ├── gmail/
│   │   │   ├── draft-email
│   │   │   └── send-email
│   │   └── google-docs/
│   │       └── append-to-doc
│   ├── services/
│   │   ├── gmail-service
│   │   └── google-docs-service
│   ├── auth/
│   │   └── google-auth
│   ├── validation/
│   │   └── ...
│   └── config/
│       └── ...
├── tests/
├── .env.example
├── README.md
└── ...
```

The exact structure may be adapted to the selected programming language
and MCP SDK.

------------------------------------------------------------------------

## 18. Technology Selection

Choose a stable, well-supported programming language and
official/reputable MCP SDK.

Preferred implementation options may include:

-   TypeScript/Node.js
-   Python

Before implementation, evaluate the available MCP SDK and Google API
libraries for the selected language.

Use official Google API client libraries where available.

Avoid unnecessary dependencies.

------------------------------------------------------------------------

## 19. Testing Requirements

Create automated tests for the important business logic.

At minimum, test:

### Gmail

-   Valid draft creation request.
-   Invalid recipient.
-   Missing subject/body where applicable.
-   CC/BCC handling.
-   Successful draft creation.
-   Successful email send.
-   Gmail API failure.
-   Authentication failure.

### Google Docs

-   Valid document ID.
-   Valid content.
-   Empty/invalid content.
-   Successful append.
-   Document not found.
-   Access denied.
-   Google Docs API failure.

### MCP

-   Tool discovery.
-   Tool schemas.
-   Valid tool invocation.
-   Invalid tool invocation.
-   Error response behavior.

Where practical, mock Google APIs so tests do not require a real
Gmail/Google Docs account.

------------------------------------------------------------------------

## 20. README Requirements

Create comprehensive documentation explaining:

1.  What the MCP server does.
2.  Supported MCP tools.
3.  Prerequisites.
4.  Google Cloud project setup.
5.  Required APIs.
6.  OAuth configuration.
7.  Required scopes.
8.  Environment variables.
9.  How to run the server.
10. How to connect an MCP-compatible AI agent.
11. Example tool calls.
12. Security considerations.
13. Troubleshooting.
14. How to extend the server with additional tools.

Include example usage such as:

``` text
AI Agent
   |
   | "Draft an email to john@example.com"
   v
draft_email
   |
   v
Gmail API
```

and:

``` text
AI Agent
   |
   | "Append this summary to Google Doc <ID>"
   v
append_to_google_doc
   |
   v
Google Docs API
```

------------------------------------------------------------------------

## 21. Extensibility

The server should be designed so future Google Workspace capabilities
can be added without rewriting the existing architecture.

Potential future tools could include:

-   Read Gmail messages.
-   Search Gmail.
-   Reply to emails.
-   Create Google Docs.
-   Read Google Docs.
-   Update specific Google Doc sections.
-   Google Sheets operations.
-   Google Drive operations.
-   Calendar operations.

These are **not part of the initial implementation**.

Do not implement unnecessary future functionality now.

------------------------------------------------------------------------

## 22. Non-Goals

The initial version must NOT attempt to become a complete Google
Workspace MCP server.

Do not implement:

-   Gmail inbox management.
-   Gmail search.
-   Email deletion.
-   Google Drive management.
-   Google Calendar.
-   Google Sheets.
-   Full Google Docs editing.
-   File uploads.
-   Admin-level Google Workspace management.

Only implement the required initial capabilities:

1.  Draft email.
2.  Send email.
3.  Append content to Google Doc.

------------------------------------------------------------------------

## 23. Definition of Done

The implementation is considered complete when:

-   [ ] MCP server starts successfully.
-   [ ] MCP client can connect to the server.
-   [ ] MCP tools are discoverable.
-   [ ] `draft_email` is available.
-   [ ] `send_email` is available.
-   [ ] `append_to_google_doc` is available.
-   [ ] Gmail OAuth authentication works.
-   [ ] Google Docs OAuth authentication works.
-   [ ] Draft email can be created successfully.
-   [ ] Email can be sent successfully.
-   [ ] Content can be appended to an existing Google Doc.
-   [ ] Existing Google Doc content is preserved.
-   [ ] Invalid inputs are rejected.
-   [ ] Google API errors are handled cleanly.
-   [ ] Credentials are not exposed in logs/source code.
-   [ ] Automated tests cover the core functionality.
-   [ ] README contains complete setup and usage instructions.
-   [ ] `.env.example` is provided where applicable.
-   [ ] The implementation is generic and not coupled to a single AI
    agent.
-   [ ] No unnecessary functionality has been added.

------------------------------------------------------------------------

## 24. Implementation Instructions for Cursor

When implementing this project:

### Phase 1 --- Analyze

Before writing code:

1.  Inspect the existing project structure.
2.  Determine the programming language and package manager if a project
    already exists.
3.  Check whether an MCP implementation already exists.
4.  Check existing authentication/configuration patterns.
5.  Identify reusable code before creating new modules.

Do not overwrite existing functionality without understanding it.

### Phase 2 --- Design

Define:

-   MCP server architecture.
-   Tool interfaces.
-   Google authentication strategy.
-   Service boundaries.
-   Error-handling strategy.
-   Configuration strategy.
-   Testing strategy.

Prefer simple architecture over unnecessary abstraction.

### Phase 3 --- Implement

Implement only:

1.  `draft_email`
2.  `send_email`
3.  `append_to_google_doc`

Use official Google APIs and a maintained MCP SDK.

### Phase 4 --- Test

Run:

-   Unit tests.
-   Integration-level tests where practical.
-   Type checking/static analysis.
-   Linting.
-   MCP tool discovery verification.

Fix issues before declaring completion.

### Phase 5 --- Documentation

Update/create:

-   README
-   `.env.example`
-   Setup instructions
-   Tool documentation
-   Example usage
-   Troubleshooting

------------------------------------------------------------------------

## 25. Final Requirement

The resulting MCP server must be a **generic Gmail + Google Docs MCP
integration**.

It should not contain logic specific to one AI agent.

The AI agent should decide **when** to use a tool and **what content**
to provide.

The MCP server should be responsible for:

-   Exposing standardized tools.
-   Validating inputs.
-   Authenticating with Google.
-   Calling the correct Google API.
-   Handling errors securely.
-   Returning predictable results.

The final architecture should allow any MCP-compatible AI agent to
connect and use the same Gmail and Google Docs capabilities without
requiring changes to the MCP server for each individual AI agent.
