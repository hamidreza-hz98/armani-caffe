# Dependency policy

Use built-in browser, Node.js, React, and Next.js capabilities before adding a package or service. A new dependency must solve a concrete need, have a maintained release, and be recorded here or in an ADR with its purpose and rejected platform alternative.

Pin runtime and package manager versions with `.nvmrc`, `packageManager`, and `engines`. Keep the npm lockfile committed. Use `npm ci` in CI and deployment. Keep dependency major versions fixed; prefer exact versions for newly added packages. Review security, maintenance, bundle impact, and licenses before upgrades. Upgrade majors deliberately in their own change.

Infrastructure packages and services need an ADR before adoption. Document ownership, secrets, data retention, operational failure modes, and exit path. The local container services are recorded in [ADR 0001](adr/0001-local-infrastructure.md); they are not a production deployment decision. The five folders under `src/server` reserve boundaries for database, secrets, MinIO, queue, and payments. Each source module there must directly import `server-only`, and `npm run check:boundaries` enforces this. Client code must not import these modules. Next.js rejects a client import of a marked module during compilation.

## Current dependencies

| Dependency                          | Purpose                                                       | Platform alternative                              |
| ----------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Next.js                             | App Router, rendering, routing, build                         | Node HTTP server plus custom routing and bundling |
| React and React DOM                 | Component rendering                                           | Direct DOM manipulation                           |
| server-only                         | Build-time protection for private server modules              | Convention alone cannot block client imports      |
| TypeScript and type packages        | Static typing and React/Node declarations                     | JavaScript and runtime checks alone               |
| ESLint and eslint-config-next       | Code quality and Next/React rules                             | Compiler checks alone                             |
| Prettier and eslint-config-prettier | Stable formatting and removal of conflicting lint style rules | Editor-specific formatting                        |
| eslint-plugin-simple-import-sort    | Enforced import/export order                                  | Manual ordering                                   |

Node's built-in test runner powers unit, integration, and production HTTP smoke tests, so no test framework is installed yet.
