# Armani Caffe

وب‌سایت آرمانی کافه، ساخته‌شده با Next.js App Router و TypeScript.

## پیش‌نیازها

- Node.js 24.15.0 (مطابق `.nvmrc`)
- npm 11.12.1 (مطابق `packageManager`)
- Docker Desktop یا Docker Engine همراه با Compose v2 برای سرویس‌های محلی

## راه‌اندازی اولیه

```bash
npm ci
npm run dev
```

سپس آدرس [http://localhost:3000](http://localhost:3000) را باز کنید.

## دستورات پروژه

```bash
npm run dev        # اجرای محیط توسعه
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

پیش از توسعهٔ محلی، `.env.example` را به `.env.local` کپی کنید و فقط متغیرهای موردنیاز را مقدار دهید. فایل‌های واقعی محیطی در Git ثبت نمی‌شوند. هیچ راز سروری نباید پیشوند `NEXT_PUBLIC_` داشته باشد.

قواعد افزودن وابستگی‌ها در [dependency policy](docs/dependency-policy.md) و قالب ثبت تصمیم‌های معماری در [ADR template](docs/adr/0000-template.md) آمده‌اند. کد مربوط به پایگاه داده، رازها، MinIO، صف و پرداخت باید زیر `src/server` بماند و در هر فایل `import "server-only"` داشته باشد.

برای اجرای MongoDB، Redis و MinIO، دستورات راه‌اندازی، آزمون، توقف و پاک‌سازی داده‌ها را در [راهنمای زیرساخت محلی](docs/local-infrastructure.md) ببینید. برنامهٔ Next.js همچنان روی میزبان اجرا می‌شود.
