---
name: Armani Caffe
colors:
  surface: '#fef9f1'
  surface-dim: '#ded9d2'
  surface-bright: '#fef9f1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8f3eb'
  surface-container: '#f2ede5'
  surface-container-high: '#ece8e0'
  surface-container-highest: '#e7e2da'
  on-surface: '#1d1c17'
  on-surface-variant: '#4c4640'
  inverse-surface: '#32302b'
  inverse-on-surface: '#f5f0e8'
  outline: '#7d766f'
  outline-variant: '#cfc5bd'
  surface-tint: '#625d59'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1e1b18'
  on-primary-container: '#89837e'
  inverse-primary: '#ccc5c0'
  secondary: '#75584a'
  on-secondary: '#ffffff'
  secondary-container: '#fed8c5'
  on-secondary-container: '#795c4e'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#2e1500'
  on-tertiary-container: '#ab794f'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e9e1dc'
  primary-fixed-dim: '#ccc5c0'
  on-primary-fixed: '#1e1b18'
  on-primary-fixed-variant: '#4a4642'
  secondary-fixed: '#ffdbca'
  secondary-fixed-dim: '#e4bfad'
  on-secondary-fixed: '#2a170c'
  on-secondary-fixed-variant: '#5b4133'
  tertiary-fixed: '#ffdcc2'
  tertiary-fixed-dim: '#f5bb8b'
  on-tertiary-fixed: '#2e1500'
  on-tertiary-fixed-variant: '#653d19'
  background: '#fef9f1'
  on-background: '#1d1c17'
  surface-variant: '#e7e2da'
typography:
  headline-xl:
    fontFamily: Vazirmatn
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 52px
  headline-xl-mobile:
    fontFamily: Vazirmatn
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 42px
  headline-lg:
    fontFamily: Vazirmatn
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 40px
  headline-md:
    fontFamily: Vazirmatn
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 32px
  body-lg:
    fontFamily: Vazirmatn
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Vazirmatn
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Vazirmatn
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Vazirmatn
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 22px
  label-md:
    fontFamily: Vazirmatn
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 18px
  label-sm:
    fontFamily: Vazirmatn
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

The visual narrative translates the calm, tactile ritual of third-wave specialty coffee culture in contemporary Tehran into a digital platform. The experience merges refined architectural hospitality with utilitarian operational precision for ordering and CRM management. It speaks to design-conscious urban patrons and café floor staff through a tranquil, high-end editorial tone.

The aesthetic philosophy fuses restrained contemporary minimalism with warm, tactile material tiers:
- **Atmosphere:** Deep espresso roasts, raw cream paper backdrops, and muted golden brass accents.
- **Tone:** Unhurried, hospitable, systematic, and premium without being exclusionary.
- **RTL Integration:** Engineered natively for Persian right-to-left layout geometry, ensuring visual weight, gestural flows, and optical alignment flow naturally from right to left across all viewport sizes.

## Colors

The palette is anchored in roasted coffee pigments, warm ceramic backgrounds, and subdued brass highlights:

- **Canvas & Surfaces:**
  - Background Canvas: `#F7F2EA` (steeped oat tone that avoids blue device glare)
  - Surface Container / Card Base: `#FFFCF7` (clean ceramic warm white)
  - Surface Variant / Structural Wells: `#EEE4D7` (subtle separation for table headers, item groupings, and tag backings)
- **Ink & Typography:**
  - Primary Text: `#211A16` (deep espresso-charcoal)
  - Secondary Text: `#6F6259` (warm stone brown for metadata, descriptions, and Jalali dates)
- **Brand Accents & Highlights:**
  - Brand Primary: `#171411` (near-black coffee bean)
  - Deep Burnt Brown: `#3A2418` (used for interactive press states and heavy emphasis)
  - Warm Caramel / Leather: `#B9855A` (secondary framing, inactive state emphasis)
  - Golden Amber Accent: `#C99A3D` (applied selectively to loyalty badges, active navigation indicators, and primary checkout CTAs)
- **Dividers & Outlines:**
  - Outline Default: `#D8CABB`
  - Outline Muted: `rgba(216, 202, 187, 0.45)`
- **Functional Semantics:**
  - Success: `#2E7D5B` (order received, payment settled)
  - Warning: `#B26A00` (low bean inventory, pending prep)
  - Error: `#B3261E` (out of stock, transaction rejected)
  - Info: `#356A8A` (delivery routing, customer profile notes)

## Typography

The design system uses Vazirmatn across all roles, selected for its balanced Persian glyph anatomy, extended Arabic baseline harmony, and clear diacritic rendering.

- **Numerals:** Strictly render Persian numbers (۰۱۲۳۴۵۶۷۸۹) with tabular figures enabled (`font-variant-numeric: tabular-nums`) across pricing, weights (گرم), order counts, and phone inputs.
- **Currency Convention:** Prices must position the Persian value first, followed by a non-breaking space and the currency token «تومان» in `label-md` or `label-sm` weight (e.g.، «۸۵٬۰۰۰ تومان»).
- **Vertical Metrics:** Persian scripts demand taller vertical clearances. Line-height tokens are intentionally set 15–25% higher than Latin defaults to prevent baseline clipping of complex ligatures and accents.

## Layout & Spacing

Layout geometry follows an 8px modular baseline grid, prioritizing handheld ordering ergonomics and dense multi-column CRM dashboard tables.

- **RTL Fluidity:** Grid gutters and column offsets expand strictly from right to left. Inline start margins correspond to physical screen right; inline end margins correspond to physical screen left.
- **Form Factors & Breakpoints:**
  - **Mobile (<600px):** Single-column fluid stream. Canvas outer margin `space-md` (16px), gutters `space-sm` (8px). Sticky bottom checkout and ordering bar.
  - **Tablet (600px–1024px):** 8-column layout. Split ordering view (6 columns menu catalog, 2 columns persistent active cart drawer). Margins `space-lg` (24px).
  - **Desktop / POS (>1024px):** 12-column layout. Max container width 1280px centered. CRM records adopt 12-column dense data views with fixed contextual detail drawers sliding in from the physical left (end-direction).

## Elevation & Depth

Visual hierarchy relies on warm tonal layering and soft ambient contact shadows rather than high-contrast drop-shadows.

- **Level 0 (Flat Canvas):** `#F7F2EA` with no shadow.
- **Level 1 (Cards, Product Tiles):** `#FFFCF7` surface accompanied by a 1px border of `#D8CABB` and a soft ambient shadow: `0 2px 8px rgba(58, 36, 24, 0.04)`.
- **Level 2 (Hovered Tiles, Sticky Menus):** `0 6px 16px rgba(58, 36, 24, 0.08)`, border subtle `#B9855A` (30% opacity).
- **Level 3 (Drawers, Bottom Sheets, Popovers):** `0 12px 32px rgba(23, 20, 17, 0.12)`, anchored by a warm ambient backlight.
- **Level 4 (Modals, Confirmation Dialogs):** Centered floating layers with backdrop blur `backdrop-filter: blur(6px)` and overlay fill `rgba(23, 20, 17, 0.4)`.

## Shapes

The geometry balances structured architectural forms with approachable organic curvature.

- **Primary Cards & Panels:** 14px to 16px corner radius (`rounded-lg` scale).
- **Interactive Controls (Inputs, Action Buttons):** 10px to 12px radius, preserving a tactile, button-like presence without sliding into playful bubble aesthetics.
- **Chips, Category Filters & Loyalty Badges:** Pill-shaped (`rounded-full` / 9999px) for clear tactile affordance as draggable, tap-friendly tags.
- **Modals & Bottom Drawers:** 20px to 24px top radius (`rounded-xl` scale) on pull-up interaction sheets to cushion touch gestures.

## Components

### Buttons
- **Primary:** Background `#171411`, foreground `#FFFCF7`, corner radius 12px. Active press scales subtly to 0.98 with `#3A2418`.
- **Accent / High-Conversion:** Background `#C99A3D`, foreground `#171411`, used strictly for main checkout and order confirmation triggers.
- **Secondary / Outlined:** Transparent surface with 1.5px stroke of `#3A2418`, text `#3A2418`.
- **Ghost:** Text `#6F6259`, background transparent; hover tint `rgba(185, 133, 90, 0.08)`.
- **Icon Placement:** Icons placed at the `start` position sit on the right side of the label text in Persian RTL context.

### Chips & Filters
- **Deselected:** Surface `#EEE4D7`, text `#6F6259`, border 1px solid transparent, height 36px, full-pill radius.
- **Selected:** Surface `#171411`, text `#FFFCF7`, subtle amber counter badge.
- **Live Status Badges:** Compact pill (24px height) using functional tint backgrounds with matching dark text (e.g., preparation status in `#2E7D5B` over 12% opacity tint).

### Form Inputs
- **Base Style:** 12px radius, height 48px, background `#FFFCF7`, border 1px solid `#D8CABB`.
- **Typography:** Persian text aligned to the right by default; numbers right-aligned with tabular figures.
- **Focus State:** 2px border `#C99A3D` with an ambient glow of `rgba(201, 154, 61, 0.15)`. Floating labels translate upward and align right without clipping bounding boxes.

### Cards (Menu Items & CRM Customer Summaries)
- **Menu Item Card:** Background `#FFFCF7`, 16px radius, 1px border `#D8CABB`. Image placed on the right side on mobile list views, content and price stacked neatly on the left.
- **CRM Customer Summary:** Surface container with header row featuring Persian customer name, Jalali join date (`body-sm`, `#6F6259`), total order volume badge, and coffee bean preference icons.

### Selection Controls (Checkboxes, Radios, Switches)
- **Checkbox & Radio:** 2px border `#6F6259` in unselected state. On selection, filled with `#171411` with check or dot in `#C99A3D`.
- **Switch:** Track filled with `#EEE4D7` when off, transitions to `#3A2418` when active. Thumb is `#FFFCF7` with subtle warm shadow.

### Domain-Specific Components
- **Roast & Extraction Gauge:** Visual segmented scale indicating Roast Level (Light to Dark) and Processing Method (Natural, Washed, Honey) using subtle micro-dashes of `#B9855A`.
- **Jalali Date Range Picker:** Dual-month view featuring Persian calendar months (فروردین to اسفند), start-to-end selection highlights in `#EEE4D7`, and endpoint tokens pinned in `#171411`.
- **Live Kitchen Prep Stepper:** Right-to-left progress track: ثبت سفارش (Placed) ← در حال آماده‌سازی (Brewing) ← آماده تحویل (Ready) ← تحویل شد (Completed). Active pulse indicator in `#C99A3D`.