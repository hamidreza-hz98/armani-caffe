# Dashboard admin management

`/dashboard/admins` is an owner-only management page. Cashiers see no navigation entry and both the page and `/api/admins` enforce `admins.read` or `admins.manage` server-side.

The list supports bounded `q`, `role`, `status`, and `page` query parameters. Search covers username, display name, and phone. Statistics are unfiltered active-owner, active-cashier, disabled, and total counts so the UI can identify the last active owner. The data transfer object excludes password hashes, session versions, and other internal fields. Only `OWNER` and `CASHIER` can be assigned.

Creation requires a new password. Editing never returns or displays one. Password reset accepts a new password only and revokes the target's sessions. Deactivation and deletion require confirmation and also revoke sessions. Revision checks reject concurrent edits. The UI disables self-deactivation, self-deletion, self-reset, and changes to one's own role/status/username; it also disables deactivation, deletion, and demotion of the final active owner. The backend's final-owner transaction guard remains authoritative against forged requests and races.

Run `npm run test:e2e:admins` for the isolated production-build browser suite. It exercises responsive/accessibility behavior, owner and cashier access, filters, lifecycle mutations, validation, duplicate username, failed network requests, last-owner protection, and password non-exposure. The separate `admin-security` integration suite covers transaction and session invariants.
