# Armani Caffe

وب‌سایت آرمانی کافه، ساخته‌شده با Next.js App Router و TypeScript.

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
npm run validate    # همهٔ بررسی‌های پایه
npm run start:local # ساخت و اجرای محلی نسخهٔ production
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

برای اجرای MongoDB، Redis و MinIO، دستورات راه‌اندازی، آزمون، توقف و پاک‌سازی داده‌ها را در [راهنمای زیرساخت محلی](docs/local-infrastructure.md) ببینید. برنامهٔ Next.js همچنان روی میزبان اجرا می‌شود.
