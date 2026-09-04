import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServer, REGISTERED_TOOL_NAMES, SERVER_NAME } from '../../src/server/create-server.js';
import type { GmailService } from '../../src/services/gmail-service.js';
import type { GoogleDocsService } from '../../src/services/google-docs-service.js';

describe('createServer', () => {
  it('constructs a server with the three required tools', () => {
    const gmail = {} as GmailService;
    const docs = {} as GoogleDocsService;
    const server = createServer({
      getGmailService: async () => gmail,
      getDocsService: async () => docs,
    });

    assert.equal(SERVER_NAME, 'gmail-docs-mcp');
    assert.deepEqual([...REGISTERED_TOOL_NAMES], [
      'draft_email',
      'send_email',
      'append_to_google_doc',
    ]);

    const registered = (server as unknown as { _registeredTools: Record<string, { enabled?: boolean }> })
      ._registeredTools;
    assert.deepEqual(Object.keys(registered).sort(), [...REGISTERED_TOOL_NAMES].sort());
    for (const name of REGISTERED_TOOL_NAMES) {
      assert.equal(registered[name]?.enabled, true);
    }
  });
});
