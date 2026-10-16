This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Zuri AI assistant

The floating Zuri assistant sends chat requests to the FastAPI backend at `http://127.0.0.1:8000` by default. Set `NEXT_PUBLIC_BACKEND_URL` in the frontend environment when the backend runs at a different URL. Add the frontend origin to the backend's comma-separated `FRONTEND_ORIGINS` setting if it is not `http://localhost:3000` or `http://127.0.0.1:3000`.

The assistant provides educational trading support and does not submit orders. The workspace's displayed market quotes and account figures are demo data.

## Market briefing

The Dashboard and Charts briefing loads attributed headlines from CNBC US Top News and BBC Business/World through the backend's `GET /api/market-news` endpoint. The browser requests updates every five minutes, and the backend caches publisher feeds for five minutes. Stories include a publication time when the publisher provides one, a source label, a link to the original article, and an optional symbol match based on simple headline/excerpt keyword matching.

Use **Ask Zuri** on a story to include its title, excerpt, source, time, and link as context in the assistant conversation. Zuri treats that publisher material as untrusted input and can discuss possible relevance, not confirm causation or predict price direction. A missing feed is reported in the briefing; if all feeds are unavailable, the endpoint returns an error rather than fabricated headlines.

Publisher RSS reuse, attribution, and commercial-use terms have not been cleared for production. Review each publisher's current terms and obtain any required permissions before deploying this feed commercially. The current three-feed set is an initial briefing, not comprehensive real-time financial news.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
