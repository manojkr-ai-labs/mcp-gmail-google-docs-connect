import { mapGoogleError } from '../errors/google-errors.js';

export interface AppendTextRequest {
  documentId: string;
  content: string;
  prependNewline: boolean;
}

export interface AppendTextResult {
  documentId: string;
  title: string;
  appendedCharacterCount: number;
}

export interface DocsApi {
  documents: {
    batchUpdate: (params: {
      documentId: string;
      requestBody: {
        requests: Array<{
          insertText: {
            endOfSegmentLocation: { segmentId: string };
            text: string;
          };
        }>;
      };
    }) => Promise<{ data: unknown }>;
    get: (params: {
      documentId: string;
      fields?: string;
    }) => Promise<{ data: { documentId?: string | null; title?: string | null } }>;
  };
}

export class GoogleDocsService {
  constructor(private readonly client: DocsApi) {}

  async appendText(request: AppendTextRequest): Promise<AppendTextResult> {
    const text = request.prependNewline ? `\n${request.content}` : request.content;

    try {
      await this.client.documents.batchUpdate({
        documentId: request.documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                endOfSegmentLocation: { segmentId: '' },
                text,
              },
            },
          ],
        },
      });
    } catch (err) {
      throw mapGoogleError(err, 'docs');
    }

    let title = '';
    try {
      const meta = await this.client.documents.get({
        documentId: request.documentId,
        fields: 'title,documentId',
      });
      title = meta.data.title ?? '';
    } catch {
      // Append already succeeded; title is optional in the success payload.
    }

    return {
      documentId: request.documentId,
      title,
      appendedCharacterCount: text.length,
    };
  }
}
