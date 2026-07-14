let client: any = null;

async function getClient() {
  if (client) return client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 credentials missing. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    );
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export function r2Bucket(): string {
  return process.env.R2_BUCKET || 'goldenstore-apks';
}

export function r2PublicUrl(key: string): string {
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) {
    throw new Error('R2_PUBLIC_URL not configured');
  }
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function r2PresignPut(
  key: string,
  contentType: string,
  expiresInSeconds = 600,
): Promise<string> {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const cmd = new PutObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
    ContentType: contentType,
  });
  return await getSignedUrl(await getClient(), cmd, { expiresIn: expiresInSeconds });
}

export async function r2PresignGet(
  key: string,
  expiresInSeconds = 600,
  responseContentDisposition?: string,
): Promise<string> {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const cmd = new GetObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
    ...(responseContentDisposition ? { ResponseContentDisposition: responseContentDisposition } : {}),
  });
  return await getSignedUrl(await getClient(), cmd, { expiresIn: expiresInSeconds });
}

export async function r2Delete(key: string): Promise<void> {
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  await (await getClient()).send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }));
}

export async function r2Head(key: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await (await getClient()).send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }));
    return {
      size: Number(res.ContentLength || 0),
      contentType: res.ContentType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
}

// --- Multipart upload helpers for large files ---

export async function r2CreateMultipartUpload(
  key: string,
  contentType: string,
): Promise<string> {
  const { CreateMultipartUploadCommand } = await import('@aws-sdk/client-s3');
  const res = await (await getClient()).send(
    new CreateMultipartUploadCommand({
      Bucket: r2Bucket(),
      Key: key,
      ContentType: contentType,
    }),
  );
  return res.UploadId!;
}

export async function r2PresignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresInSeconds = 3600,
): Promise<string> {
  const { UploadPartCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const cmd = new UploadPartCommand({
    Bucket: r2Bucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return await getSignedUrl(await getClient(), cmd, { expiresIn: expiresInSeconds });
}

export async function r2CompleteMultipartUpload(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
): Promise<void> {
  const { CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');
  await (await getClient()).send(
    new CompleteMultipartUploadCommand({
      Bucket: r2Bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
}

export async function r2AbortMultipartUpload(
  key: string,
  uploadId: string,
): Promise<void> {
  try {
    const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await (await getClient()).send(
      new AbortMultipartUploadCommand({
        Bucket: r2Bucket(),
        Key: key,
        UploadId: uploadId,
      }),
    );
  } catch {
    // best-effort cleanup
  }
}
