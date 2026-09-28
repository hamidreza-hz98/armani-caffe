import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import { getServerConfig } from "../secrets/config.ts";

export function createMinioClient(config: {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
}): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    forcePathStyle: true,
    maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function configuredMinioClient(): S3Client {
  return createMinioClient(getServerConfig().minio);
}
