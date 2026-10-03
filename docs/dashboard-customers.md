# Customer management dashboard

`/dashboard/customers` is readable by OWNER and CASHIER. Only OWNER can create, edit, block/unblock, or anonymize a customer. Every mutation checks the capability again in the MongoDB transaction and writes an audit event plus outbox event. Customer passwords are accepted only on creation, hashed, and never returned to the browser.

Search, status, and page are URL parameters. Mobile search normalizes Iranian digits and formats before exact lookup on `customer_phone_unique`; name search uses `customer_name_search`. Status counts use the `customer_status_created` index. The page is limited to 20 customers. Last-order and lifetime/recent paid-order queries use customer order indexes, have response limits/timeouts, and exclude pending and cancelled orders. An order's immutable financial snapshot is not edited when a profile changes.

Apply declared indexes intentionally with `npm run db:indexes:plan` and `npm run db:indexes:apply -- --apply` during rollout; normal requests do not synchronize indexes.

Birth date is entered as `YYYY-MM-DD` in the Jalali calendar using Latin digits. The UI adapter converts it to a Gregorian calendar date; storage is midnight UTC and the same canonical date round-trips back to Jalali. Mobile numbers are stored in normalized `+98` form and displayed as spaced national numbers.

Anonymization is irreversible. It clears the customer profile name and birth date, replaces the unique mobile with a non-dialable tombstone, invalidates the password, increments the auth version, and revokes customer sessions in one transaction. The customer's identifier and historical paid orders remain for accounting; those immutable order/invoice snapshots may still contain identity details captured at purchase. This is profile anonymization, not erasure of legally retained financial records. UI copy warns the operator of that distinction.

Run `npm run test:e2e:customers` for isolated production-build browser tests. They cover empty/no-order states, search indexes, Jalali round-trip, duplicate mobile, edit conflicts, paid-versus-pending metrics, retained orders, anonymization, cashier permissions, responsive layout, and accessibility.
