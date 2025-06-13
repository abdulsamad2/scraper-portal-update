This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

# Scraper Portal Dashboard

Internal web portal for managing ticket-scraper data — events, seat inventories, error logs and operational stats.  
Built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, **react-data-table-component** and **MongoDB (Mongoose)**.

## ✨ Key Features

- **Dashboard overview** showing total events, seats, errors & recent events.
- **Inventory page** with server-side pagination, infinite scroll, advanced filters and a responsive data-table (50 rows / page).
- **Events manager** listing events and related actions.
- **Error log viewer** for quick troubleshooting.
- Fully typed codebase & modular **server actions** for CRUD operations.

## 🗂️ Tech Stack

| Layer      | Technology                                                  |
|------------|-------------------------------------------------------------|
| Front-end  | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| Tables     | react-data-table-component                                  |
| Back-end   | MongoDB Atlas, Mongoose ODM                                 |
| Utilities  | lucide-react icons, Zod validation (if needed)              |

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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
