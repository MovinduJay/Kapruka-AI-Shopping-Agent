# Kapruka AI Shopping Agent

## Demo Checkout Boundary

The checkout demo ends after the user confirms the checkout details and the
agent generates a Kapruka guest-checkout payment link.

- Do not enter card details or attempt a test payment. Kapruka does not provide
  a test credit card.
- Generating the link does not confirm the order.
- The returned checkout reference is not a trackable order number.
- For the challenge demo, `VPAY827982BA` is a Kapruka-provided test order number
  that can be passed to `kapruka_track_order`.
- Outside the demo test order, `kapruka_track_order` is relevant only after a
  real payment is completed and Kapruka issues the actual order number.

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


