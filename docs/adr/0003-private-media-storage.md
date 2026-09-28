# ADR 0003: Private, validated image storage through S3

Status: accepted for local implementation; production storage support requires review.

## Decision

Retain the requested MinIO service behind the `MediaStorage` port. Use exact-pinned AWS SDK v3 packages (`client-s3`, `lib-storage`, `s3-presigned-post`, `s3-request-presigner`) for authenticated S3 operations, managed multipart transfer with abort cleanup, constrained signed POST policies, and short-lived signed downloads. Hand-writing SigV4, XML errors, multipart retry/abort, and upload policies using Node fetch would create unnecessary security and reliability risk. These packages stay server-only. The MinIO-specific JavaScript SDK was evaluated but not retained because npm reported moderate transitive vulnerabilities; the installed production dependency audit is clean at implementation time.

Use exact-pinned sharp for image decoding, pixel limits, EXIF orientation, metadata-free re-encoding, and optimized WebP variants. Node has no built-in image decoder/encoder. No extra MIME-detector dependency is needed: sharp reports the decoded format and must successfully re-encode every accepted file. Only static JPEG, PNG, and WebP are accepted; SVG, documents, arbitrary binaries, and video are out of scope.

## Operations and exit path

Storage credentials are server configuration only. Buckets stay private. Owner-scoped object IDs and content hashes identify immutable image versions, not user-provided filenames. Direct uploads enter a staging prefix and must be validated before they are accessible through the media API. Synchronous variants keep the current workflow deterministic; a later consumer may move processing into a bounded queue behind the same port.

The existing MinIO community repository is archived and official legacy binary downloads are no longer served. Do not treat the pinned local container as a supported production storage choice. Before deployment, select a supported S3 service/distribution, review licensing and security maintenance, and verify compatibility. The S3-based adapter makes switching endpoints possible without changing application contracts. Do not silently switch infrastructure vendors during this task.

References: [MinIO repository](https://github.com/minio/minio), [AWS S3 SDK operations](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html), [sharp constructor limits](https://sharp.pixelplumbing.com/api-constructor/), [sharp output options](https://sharp.pixelplumbing.com/api-output/).
