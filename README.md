# Armani Caffe

Atomic order confirmation, immutable checkout snapshots, cancellation/refund controls and stock recovery are documented in [Orders](docs/orders.md). Apply migration 11 and indexes explicitly before rollout.

Product lifecycle, additions, public menu, stock mappings, and rollout are documented in [Products](docs/products.md).
Customer cart contracts, authoritative pricing, expiry, concurrency and rollout are documented in [Carts](docs/carts.md).
Multi-gateway registration, encrypted payment settings, verification, fake settlement and rollout are documented in [Payments](docs/payments.md).

Stock units, approvals, immutable movements, migrations, and trusted order/product ports are documented in [Inventory](docs/inventory.md).

وب‌سایت آرمانی کافه، ساخته‌شده با Next.js App Router و TypeScript.

تنظیمات singleton، نقش‌ها، رمزنگاری و چرخش کلید، cache و migration شمارهٔ ۳ در [راهنمای تنظیمات](docs/settings.md) مستند شده‌اند. ورود مدیر، نشست‌ها، نقش‌ها و راه‌اندازی نخستین مالک در [راهنمای احراز هویت مدیریت](docs/admin-auth.md) آمده‌اند.

ثبت‌نام و ورود مشتری، نشست مستقل، ویرایش پروفایل و تبدیل تاریخ تولد جلالی در [راهنمای احراز هویت مشتری](docs/customer-auth.md) آمده‌اند.

مدیریت دسته‌بندی‌ها، ترتیب اتمی، تصویر رسانه‌ای و انتشار رویداد بازاعتبارسنجی فروشگاه در [راهنمای دسته‌بندی‌ها](docs/categories.md) آمده‌اند.

## پیش‌نیازها

- Node.js 24.15.0 (مطابق `.nvmrc`)
- npm 11.12.1 (مطابق `packageManager`)
- Docker Desktop یا Docker Engine همراه با Compose v2 برای سرویس‌های محلی

## راه‌اندازی اولیه

```bash
npm ci
npm run env:init
npm run dev
```

سپس آدرس [http://localhost:3000](http://localhost:3000) را باز کنید.

## دستورات پروژه

```bash
npm run dev        # اجرای محیط توسعه
npm run env:init   # ساخت .env.local با رازهای محلی تازه
npm run build      # ساخت نسخهٔ production
npm run start      # اجرای نسخهٔ production پس از build
npm run lint       # بررسی ESLint
npm run typecheck  # بررسی TypeScript بدون تولید فایل خروجی
npm run format      # قالب‌بندی فایل‌ها
npm run format:check # بررسی قالب‌بندی
npm run test:unit   # آزمون‌های واحد
npm run test:integration # آزمون‌های یکپارچگی
npm run test:e2e    # ساخت و آزمون HTTP نسخهٔ production
npm run test:unit:watch # اجرای تعاملی Vitest
npm run test:e2e:debug # اشکال‌زدایی Playwright
npm run test:e2e:ui # رابط محلی Playwright
npm run validate    # همهٔ بررسی‌های پایه
npm run start:local # ساخت و اجرای محلی نسخهٔ production
npm run realtime:work # اجرای جداگانهٔ WebSocket و صف چاپ
```

`npm run env:init` فایل محلی `.env.local` را از `.env.example` می‌سازد و رازهای تصادفی لازم را تولید می‌کند؛ فایل موجود را بازنویسی نمی‌کند. فایل‌های واقعی محیطی در Git ثبت نمی‌شوند. بدون تنظیمات معتبر، سرور هنگام شروع با فهرست نام متغیرهای مشکل‌دار متوقف می‌شود. رازها هرگز نباید پیشوند `NEXT_PUBLIC_` داشته باشند.

## تنظیمات محیطی

| متغیر                       | کاربرد                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `APP_URL`                   | آدرس اصلی برنامه برای کد سرور؛ فقط مبدأ HTTP(S)                                     |
| `ADMIN_URL`                 | مبدأ پنل مدیریت برای کد سرور                                                        |
| `NEXT_PUBLIC_APP_URL`       | آدرس عمومی برنامه در مرورگر؛ هنگام build ثابت می‌شود                                |
| `NEXT_PUBLIC_WS_URL`        | آدرس عمومی WebSocket در مرورگر؛ هنگام build ثابت می‌شود                             |
| `MONGODB_URI`               | اتصال MongoDB؛ در توسعهٔ محلی باید replica set و `directConnection=true` داشته باشد |
| `REDIS_URL`                 | اتصال Redis                                                                         |
| `MINIO_ENDPOINT`            | مبدأ API ذخیره‌سازی MinIO                                                           |
| `MINIO_REGION`              | ناحیهٔ S3، در توسعهٔ محلی `us-east-1`                                               |
| `MINIO_BUCKET`              | نام bucket خصوصی رسانه                                                              |
| `MINIO_ACCESS_KEY`          | کلید دسترسی سروری MinIO                                                             |
| `MINIO_SECRET_KEY`          | کلید محرمانهٔ سروری MinIO                                                           |
| `AUTH_SESSION_SECRET`       | راز امضای نشست مشتری، حداقل ۳۲ نویسه                                                |
| `AUTH_ADMIN_SESSION_SECRET` | راز مستقل نشست مدیر، حداقل ۳۲ نویسه                                                 |
| `ENCRYPTION_KEY`            | کلید اصلی رمزنگاری؛ ۳۲ بایت به‌شکل ۶۴ نویسهٔ hex                                    |
| `ENCRYPTION_KEY_PREVIOUS`   | کلید قبلی اختیاری برای چرخش کلید؛ همان قالب                                         |
| `PAYMENT_CALLBACK_BASE_URL` | مبدأ عمومی callback پرداخت                                                          |
| `WEBSOCKET_PORT`            | پورت داخلی فرایند WebSocket                                                         |
| `WEBSOCKET_PATH`            | مسیر WebSocket، مانند `/ws`                                                         |
| `WEBSOCKET_HEARTBEAT_MS`    | فاصلهٔ heartbeat بین ۱۰۰۰ تا ۶۰۰۰۰ میلی‌ثانیه                                       |
| `PRINTER_BRIDGE_ID`         | شناسهٔ پل چاپگر                                                                     |
| `PRINTER_BRIDGE_TOKEN`      | توکن محرمانهٔ پل چاپگر، حداقل ۳۲ نویسه                                              |
| `LOG_LEVEL`                 | یکی از `debug`، `info`، `warn`، `error`                                             |
| `LOG_FORMAT`                | قالب گزارش: `pretty` یا `json`                                                      |
| `TEST_FIXED_TIME`           | زمان ثابت اختیاری فقط در `NODE_ENV=test`؛ پیش‌فرض `2025-01-01T00:00:00.000Z`        |
| `TEST_RANDOM_SEED`          | بذر تصادفی اختیاری فقط در `NODE_ENV=test`؛ پیش‌فرض `42`                             |

`NODE_ENV` را Next.js برای `development` و `production` تعیین می‌کند. تست‌ها از مقادیر ثابت مستقل از `.env.local` استفاده می‌کنند. تنها دو متغیر `NEXT_PUBLIC_*` بالا در ماژول مرورگر خوانده می‌شوند؛ تنظیمات سروری پشت مرز `server-only` قرار دارند.

قواعد افزودن وابستگی‌ها در [dependency policy](docs/dependency-policy.md) و قالب ثبت تصمیم‌های معماری در [ADR template](docs/adr/0000-template.md) آمده‌اند. کد مربوط به پایگاه داده، رازها، MinIO، صف و پرداخت باید زیر `src/server` بماند و در هر فایل `import "server-only"` داشته باشد.

مرزهای ماژول‌ها، مسئولیت‌ها و جریان درخواست در [راهنمای معماری](docs/architecture.md) ثبت شده‌اند. `npm run check:architecture` جهت وابستگی‌ها و چرخه‌های import را بررسی می‌کند.

صدور فاکتور غیرقابل‌تغییر، رسیدهای ۵۸/۸۰ میلی‌متری، نمای چاپ/PDF و بازچاپ ممیزی‌شده در [راهنمای فاکتور](docs/invoices.md) شرح داده شده‌اند.

سرور بلادرنگ، صف پایدار Redis و قرارداد پل چاپگر در [راهنمای چاپ بلادرنگ](docs/printing-realtime.md) آمده‌اند.

برنامهٔ مستقل پل چاپ روی رایانهٔ کافه، شبیه‌ساز فایل، تنظیم چاپگر USB/شبکه و بازیابی عملیاتی در [راهنمای پل چاپ محلی](docs/local-print-bridge.md) شرح داده شده‌اند.

تعریف شاخص‌های فروش امروز و ۳۰ روز، سفارش‌های اخیر، مشتریان/محصولات برتر و موجودی کم در [راهنمای تحلیل داشبورد](docs/dashboard-analytics.md) ثبت شده است.

قراردادهای پایگاه داده، migration، index و seed در [راهنمای پایگاه داده](docs/database.md) آمده‌اند. هیچ migration یا همگام‌سازی index هنگام درخواست عادی اجرا نمی‌شود.

مدل‌های دامنه، مالکیت داده، وضعیت‌ها، نگه‌داری تاریخچه و ایندکس‌های کسب‌وکار در [مدل دامنه](docs/domain-model.md) ثبت شده‌اند.

قرارداد ثبت رویداد ممیزی و outbox تراکنشی، سیاست تحویل حداقل یک‌بار و بازپخش دستی در [راهنمای ممیزی و outbox](docs/audit-outbox.md) آمده است. تا زمانی که مصرف‌کننده‌های واقعی ثبت نشده‌اند، worker تولیدی را اجرا نکنید.

راهنمای [آزمون‌ها](docs/testing.md) شامل پیش‌نیاز مرورگر، ایزوله‌سازی داده‌ها، اجرای CI و بررسی traceهای خطا است.

فایل‌های مرجع طراحی Stitch و فهرست نام‌های جدید آن‌ها در [UI-UX](UI-UX/README.md) قرار دارند؛ چیدمان واکنش‌گرا هنگام پیاده‌سازی باید بازبینی شود.

پایهٔ طراحی فارسی RTL، رنگ‌ها، فونت محلی و شیوهٔ قالب‌بندی اعداد/تاریخ در [راهنمای طراحی](docs/design-foundation.md) آمده‌اند. گالری داخلی اجزا در مسیر `/internal/design-system` قرار دارد.

الگوی خطا، لاگ، سلامت سرویس، خاموشی امن، بازخورد رابط کاربری و سیاست اولیهٔ CSP در [راهنمای پایه‌های برنامه](docs/application-foundations.md) آمده است.

برای اجرای MongoDB، Redis و MinIO، دستورات راه‌اندازی، آزمون، توقف و پاک‌سازی داده‌ها را در [راهنمای زیرساخت محلی](docs/local-infrastructure.md) ببینید. برنامهٔ Next.js همچنان روی میزبان اجرا می‌شود.

قرارداد ذخیره‌سازی خصوصی، محدودیت تصاویر، URL امضاشده، نسخه‌های بهینه و پاک‌سازی آپلودهای ناتمام در [راهنمای رسانه](docs/media-storage.md) آمده است. آزمون یکپارچگی و `validate` اکنون به MinIO واقعی نیاز دارند؛ bucket آزمون مستقل ساخته و پاک می‌شود. وضعیت پشتیبانی نسخهٔ community و ریسک استقرار در [ADR 0003](docs/adr/0003-private-media-storage.md) ثبت شده است.

سرویس‌های کاربردی رسانه، قراردادهای HTTP/action، سطح دسترسی، ارجاعات محصول، جایگزینی و پاک‌سازی پایدار در [ماژول رسانه](docs/media-module.md) مستند شده‌اند. mutationهای مدیریتی فقط با نشست معتبر و نقش مجاز پذیرفته می‌شوند. برای پایگاه دادهٔ موجود، migration شمارهٔ ۲ را آگاهانه اجرا کنید؛ `npm run media:cleanup -- --apply` فرمان عملیاتی پاک‌سازی است.
