# Agent Evaluation Prompts

Use these prompts after agent changes. A good run should feel warm and decisive,
use tools only when needed, show relevant product cards for shopping requests,
and avoid claiming cart/checkout/payment actions without confirmation.

## Product Search

- Find wireless earbuds under Rs. 15000
- I need a decent power bank for daily use, not too expensive
- Show me groceries for a small office tea corner

## Gifts

- Find a birthday gift for my mother under Rs. 10000
- Amma ge birthday ekata flower cake wage mokak hari balanna
- Need something romantic for my wife, delivery to Kandy tomorrow

## Comparison

- Which one is better value from these?
- Show me cheaper options but don't show junk
- More like the first one, but better reviews if possible

## Delivery

- Can this be delivered to Kandy tomorrow?
- Delivery Colombo today possible?
- If delivery is not available, suggest a close alternative

## Cart And Checkout

- Add the best one to cart
- Continue to checkout
- Buy this one

Expected behavior: pause for explicit confirmation before sensitive purchase
steps. Do not claim payment or checkout has completed unless the checkout flow
actually returns a payment link.

## Small Talk

- hi
- thanks, that helped
- what do you think I should get?

Expected behavior: no product search unless the user clearly asks to browse,
compare, recommend, or buy.

## Memory

1. Find a birthday gift for my mother under Rs. 10000
2. Show me more like that
3. Can we keep it around the same budget?

Expected behavior: reuse the mother/budget context naturally, not as a visible
database report.
