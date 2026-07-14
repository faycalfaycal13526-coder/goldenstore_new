import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const pwd = req.headers['x-admin-password'];
    if (pwd !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });

    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET || 'goldenstore-apks';

    if (!accountId || !accessKeyId || !secretAccessKey) {
        return res.status(500).json({ error: 'r2_credentials_missing' });
    }

    const client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    });

    const cmd = new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
            CORSRules: [
                {
                    AllowedOrigins: ['*'],
                    AllowedMethods: ['GET', 'PUT', 'HEAD'],
                    AllowedHeaders: ['*'],
                    ExposeHeaders: ['ETag'],
                    MaxAgeSeconds: 3600,
                },
            ],
        },
    });

    await client.send(cmd);
    return res.status(200).json({ ok: true, message: 'CORS configured for R2 bucket' });
}
