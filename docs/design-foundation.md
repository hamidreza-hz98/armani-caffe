# Persian RTL design foundation

The approved palette and visual direction come from [`../STITCH_UI_PROMPTS.md`](../../STITCH_UI_PROMPTS.md), Prompt 00. The extracted Stitch board in `UI-UX/` is supporting reference material; where its draft tokens differ, the approved prompt takes precedence.

`src/theme/tokens.ts` stores brand colors, shapes, elevation, and minimum touch size. `src/theme/theme.ts` maps these to MUI's palette, typography, breakpoints, components, and CSS variables (`--armani-*`). The app deliberately ships a warm light scheme only; dark mode needs a separately reviewed accessible palette.

`src/theme/provider.tsx` combines MUI's Next 16 streaming cache with Emotion's prefixer and RTL plugin. The root layout stays a Server Component with `<html lang="fa" dir="rtl">`; the provider is the smallest global Client Component boundary. Portal content such as future dialogs must inherit or explicitly set `dir="rtl"`.

The locally bundled Vazirmatn variable font uses Arabic and Latin unicode subsets with `font-display: swap`. No Google Fonts request is made at runtime. `src/theme/format.ts` centralizes Persian digits, integer تومان, and Jalali dates in Asia/Tehran. `LtrText` isolates IDs, phone numbers, and URLs inside Persian sentences. Dates are input as UTC instants; display formatting does not change stored values.

Preview the internal gallery at `/internal/design-system`. It has `noindex` metadata and is not linked from the customer site. It demonstrates responsive type, palette, controls, statuses, prices, dates, and mixed-direction text. This route is a development reference, not a production page specification.

Check desktop and narrow mobile widths, keyboard focus, reduced motion, and contrast with `npm run test:e2e`. The gallery has an axe check; automated contrast checks complement, but do not replace, visual review of future image-backed components.
