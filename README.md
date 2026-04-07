# html-to-pdf

Starter project using Next.js (App Router) + TypeScript + Tailwind.

## Yêu cầu

- Node.js 20+ (khuyến nghị)
- npm

## Cài đặt

```bash
npm install
```

## Chạy dev

```bash
npm run dev
```

Mở http://localhost:3000

Trang chính: `src/app/page.tsx`

## Lint & Format

```bash
npm run lint
npm run lint:fix

npm run format
npm run format:check
```

## Build/Start

```bash
npm run build
npm run start
```

## Git hooks (Husky)

- Husky được bật qua script `prepare` khi chạy `npm install`.
- Hook `pre-commit` chạy `npm run lint` và `npm run format:check`.
- Tạm tắt hooks cho 1 lần commit: `HUSKY=0 git commit ...`

Có thể chỉnh hook tại `.husky/pre-commit`.
