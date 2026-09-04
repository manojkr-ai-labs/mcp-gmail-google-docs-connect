import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { resetConfigCache } from '../../src/config/env.js';

const TEST_TOKEN = 'test-mcp-auth-token-32chars-min';

describe('HTTP app', () => {
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.MCP_AUTH_TOKEN;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    resetConfigCache();
  });

  it('rejects createHttpApp when MCP_AUTH_TOKEN is missing', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    resetConfigCache();
    const { createHttpApp } = await import('../../src/http.js');
    assert.throws(() => createHttpApp(), /MCP_AUTH_TOKEN/);
  });

  it('serves /health without auth and /mcp with bearer', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.MCP_AUTH_TOKEN = TEST_TOKEN;
    resetConfigCache();

    const { createHttpApp } = await import('../../src/http.js');
    const app = createHttpApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });

      const root = await fetch(`${base}/`);
      assert.equal(root.status, 200);
      const body = (await root.json()) as { mcp: string };
      assert.equal(body.mcp, '/mcp');

      const unauth = await fetch(`${base}/mcp`, { method: 'POST' });
      assert.equal(unauth.status, 401);

      const wrong = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
      });
      assert.equal(wrong.status, 401);

      const authorized = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'http-test', version: '0.0.1' },
          },
        }),
      });
      assert.notEqual(authorized.status, 401);
      assert.notEqual(authorized.status, 502);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
