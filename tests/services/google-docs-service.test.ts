import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../src/errors/app-error.js';
import { GoogleDocsService, type DocsApi } from '../../src/services/google-docs-service.js';

function googleError(status: number, extra?: { reason?: string; message?: string }): Error {
  return Object.assign(new Error(extra?.message ?? 'google error'), {
    response: {
      status,
      data: {
        error: {
          message: extra?.message ?? 'google error',
          errors: extra?.reason ? [{ reason: extra.reason }] : [],
        },
      },
    },
  });
}

function createMockDocs(overrides: {
  batchUpdate?: DocsApi['documents']['batchUpdate'];
  get?: DocsApi['documents']['get'];
} = {}): { api: DocsApi; calls: { batchUpdate: unknown[]; get: number } } {
  const calls = { batchUpdate: [] as unknown[], get: 0 };
  const api: DocsApi = {
    documents: {
      batchUpdate: async (params) => {
        calls.batchUpdate.push(params);
        if (overrides.batchUpdate) {
          return overrides.batchUpdate(params);
        }
        return { data: {} };
      },
      get: async (params) => {
        calls.get += 1;
        if (overrides.get) {
          return overrides.get(params);
        }
        return { data: { documentId: params.documentId, title: 'Notes' } };
      },
    },
  };
  return { api, calls };
}

describe('GoogleDocsService.appendText', () => {
  it('inserts at endOfSegmentLocation and prepends a newline by default', async () => {
    const { api, calls } = createMockDocs();
    const service = new GoogleDocsService(api);
    const result = await service.appendText({
      documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      content: 'New paragraph',
      prependNewline: true,
    });

    const params = calls.batchUpdate[0] as {
      documentId: string;
      requestBody: { requests: Array<{ insertText: { endOfSegmentLocation: { segmentId: string }; text: string } }> };
    };
    assert.equal(params.documentId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    assert.deepEqual(params.requestBody.requests[0]?.insertText.endOfSegmentLocation, { segmentId: '' });
    assert.equal(params.requestBody.requests[0]?.insertText.text, '\nNew paragraph');
    assert.deepEqual(result, {
      documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      title: 'Notes',
      appendedCharacterCount: '\nNew paragraph'.length,
    });
  });

  it('can append without a leading newline', async () => {
    const { api, calls } = createMockDocs();
    await new GoogleDocsService(api).appendText({
      documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      content: 'glue',
      prependNewline: false,
    });
    const params = calls.batchUpdate[0] as {
      requestBody: { requests: Array<{ insertText: { text: string } }> };
    };
    assert.equal(params.requestBody.requests[0]?.insertText.text, 'glue');
  });

  it('maps 404 to DOCUMENT_NOT_FOUND', async () => {
    const { api } = createMockDocs({
      batchUpdate: async () => {
        throw googleError(404, { message: 'not found' });
      },
    });
    await assert.rejects(
      () =>
        new GoogleDocsService(api).appendText({
          documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
          content: 'x',
          prependNewline: true,
        }),
      (err: unknown) => err instanceof AppError && err.code === 'DOCUMENT_NOT_FOUND',
    );
  });

  it('maps 403 to ACCESS_DENIED', async () => {
    const { api } = createMockDocs({
      batchUpdate: async () => {
        throw googleError(403, { message: 'forbidden' });
      },
    });
    await assert.rejects(
      () =>
        new GoogleDocsService(api).appendText({
          documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
          content: 'x',
          prependNewline: true,
        }),
      (err: unknown) => err instanceof AppError && err.code === 'ACCESS_DENIED',
    );
  });

  it('maps other Docs API failures', async () => {
    const { api } = createMockDocs({
      batchUpdate: async () => {
        throw googleError(500, { message: 'backend exploded' });
      },
    });
    await assert.rejects(
      () =>
        new GoogleDocsService(api).appendText({
          documentId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
          content: 'x',
          prependNewline: true,
        }),
      (err: unknown) => err instanceof AppError && err.code === 'DOCS_API_ERROR',
    );
  });
});
