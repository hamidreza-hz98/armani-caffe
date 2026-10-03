# Shared states and accessibility

Task 45 consolidates the interaction patterns represented by Stitch Prompt 23 into `src/theme/shared-states.tsx`, `feedback-provider.tsx`, and `unsaved-changes.ts`. These are presentation components only; permissions and transitions remain enforced by application services.

## Vocabulary and semantics

| Situation                 | Persian term                 | Semantic behavior                                           |
| ------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Successful mutation       | موفق / ذخیره شد              | `role=status`, text plus symbol                             |
| Recoverable warning       | هشدار                        | `role=status`, text plus symbol                             |
| Stale cached data         | داده‌ها ممکن است قدیمی باشند | `role=status`, retry context, never color-only              |
| Offline realtime          | ارتباط زنده قطع است          | `role=status`, last-data explanation                        |
| Blocking error            | خطا / انجام نشد              | `role=alert`, associated field description where applicable |
| Empty new collection      | هنوز … ثبت نشده است          | first-use explanation and primary action                    |
| Empty filtered collection | نتیجه‌ای یافت نشد            | filter-reset action                                         |
| Restricted capability     | دسترسی محدود است             | Persian 403 page and safe dashboard return                  |
| Missing resource          | پیدا نشد                     | Persian 404 page and safe return                            |

Destructive confirmations name the affected object, explain permanence, place cancel first in RTL reading order, and may require typed confirmation. Reason capture uses an accessible labelled dialog rather than `window.prompt`. Unsaved navigation uses the same dialog, preserves the triggering control’s focus when cancelled, and retains the browser’s native protection for tab/window close.

MUI Dialog and Drawer provide focus trapping, Escape handling, modal semantics, focus restoration, and RTL anchoring. Native application dialogs retain explicit labels, descriptions, initial focus, Escape interception while busy, and focus restoration. All primary controls meet the 44px design token; global focus rings remain visible. Reduced-motion media rules disable nonessential animation and smooth scrolling.

## Coverage matrix

- Destructive and unsaved-change confirmations: settings, payment settings, categories, products, media, orders.
- Owner approval: reusable `OwnerApprovalNotice`; inventory permissions remain server-authoritative.
- Media picker: labelled modal, initial search focus, Escape close, restored trigger focus, loading/error/empty states.
- Jalali range: `JalaliDateRange`, Persian `YYYY/MM/DD` inputs with a bounded pattern and associated error.
- Advanced filters and details: left-side RTL drawers with labelled modal semantics and focus restoration.
- Snackbar and errors: centralized `notify`, `StatusMessage`, field `aria-describedby`, and `role=alert` for blocking failures.
- Skeletons: reduced-motion-aware MUI wave skeletons under one polite busy region.
- Pagination: localized accessible names and RTL direction.
- Table to card: `ResponsiveTableCards`; operational pages retain one data model and information-preserving desktop/mobile presentations.

## Verification

Run `npm run test:unit`, `npm run test:e2e:shared-states`, and the affected dashboard E2E scripts. The focused Playwright suite runs axe on desktop, 390×844 mobile with reduced motion, and the Persian 404 page; serious and critical violations fail the test. Keyboard checks cover Drawer Escape/focus restoration and typed destructive confirmation. A visible-copy scan rejects English placeholder/lorem text in source UI.
