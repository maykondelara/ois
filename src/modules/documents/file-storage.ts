/* eslint-disable no-unused-vars */
/** Private-object boundary. Implementations must never log presigned URLs or credentials. */
export interface FileStorageProvider {
  createUploadUrl(
    input: Readonly<{ bucket: string; objectKey: string; expiresInSeconds: number }>,
  ): Promise<string>;
  inspectObject(
    input: Readonly<{ bucket: string; objectKey: string; maxBytes?: number }>,
  ): Promise<{ content: Uint8Array }>;
  createDownloadUrl(
    input: Readonly<{ bucket: string; objectKey: string; expiresInSeconds: number }>,
  ): Promise<string>;
}

export function opaqueObjectKey(companyId: string, storedFileId: string) {
  return `companies/${companyId}/stored-files/${storedFileId}/${crypto.randomUUID()}`;
}
