import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resolveTokenSource } from '../../src/auth/google-auth.js';
import { loadConfig, resetConfigCache } from '../../src/config/env.js';

describe('resolveTokenSource', () => {
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    delete process.env.GOOGLE_TOKEN_PATH;
    resetConfigCache();
  });

  it('uses GOOGLE_REFRESH_TOKEN when set', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'refresh-from-env';
    resetConfigCache();

    const source = resolveTokenSource(loadConfig());
    assert.equal(source.kind, 'env');
    if (source.kind === 'env') {
      assert.equal(source.credentials.refresh_token, 'refresh-from-env');
    }
  });

  it('reports missing when there is no env token and no token file', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_TOKEN_PATH = 'this-file-does-not-exist.json';
    resetConfigCache();

    const source = resolveTokenSource(loadConfig());
    assert.equal(source.kind, 'missing');
  });
});
