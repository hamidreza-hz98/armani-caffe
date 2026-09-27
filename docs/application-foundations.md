# Shared application foundations

## Errors and requests

Use `ApplicationError` for expected failures and `serializeError` at a transport boundary. The original error message, stack, and details are never sent to the browser; clients receive a stable code, a safe Persian message, and a correlation ID. Unexpected exceptions become `INTERNAL`. `runSafeAction` returns a serializable `Result` and logs failures, but callers must authenticate, authorize, validate input, and protect against CSRF as appropriate before executing mutations.

`timedRequest` establishes request-scoped correlation IDs, measures durations, and emits structured logs. A valid incoming `X-Request-ID` may be continued; malformed values are replaced. Logs redact sensitive property names, connection credentials, bearer tokens, and all configured secrets, including strings embedded in library errors. Do not log whole request bodies, headers, or payment payloads. Audit events are separate append-only business records, defined by the `audit` module's public `AuditEvent`/`AuditEventWriter` types; metadata must be allowlisted and non-sensitive.

## Health and shutdown

- `GET /api/health/live` confirms the process can answer HTTP; it does not contact dependencies.
- `GET /api/health/ready` probes MongoDB ping, Redis PING, and MinIO's ready endpoint concurrently. Each probe is bounded to about 2.5 seconds. HTTP 503 means at least one dependency is down. The JSON contains only `up`/`down`, never exception details or credentials. Both routes disable caching and return `X-Request-ID`.
- `SIGINT`/`SIGTERM` triggers a bounded close of MongoDB, queue, and realtime resources. The queue/realtime boundaries currently have no active connections; when adapters are introduced they must register a close callback with `registerResource` and avoid opening resources during static analysis. A failed close produces an operator log and a nonzero exit code.

For local diagnostics, start the stack per [local infrastructure](local-infrastructure.md), then request both endpoints. Liveness should stay 200 if a dependency is stopped, while readiness becomes 503.

## UI and security

The global error, not-found, and loading states use safe Persian text. `FeedbackProvider` exposes `useFeedback().notify(...)` and an awaited confirmation dialog; destructive actions still require server-side authorization and validation. `parseListQuery` accepts explicit sort/filter allowlists with bounded page size and filter values.

All routes receive a baseline CSP and browser security headers from `next.config.ts`. The CSP currently permits inline scripts/styles because Next.js streaming and Emotion emit them; this is a baseline, not a strict nonce-based policy. Before handling untrusted rich media or payment provider scripts, review and tighten the specific directives. The current policy intentionally denies frames and third-party connections; future map/payment integrations need narrowly scoped changes. HTTPS/HSTS should be configured at the production ingress, not assumed for local HTTP.
