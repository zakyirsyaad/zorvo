# Acme payments demo (fictional)

This folder is a tiny, entirely fictional project for trying Zorvo Private without putting real data
in a prompt. The client "Acme", the customers, the order ids, the gateway key and the card number are
made up. The card number is Stripe's public test card `4242 4242 4242 4242`; it is not a real card,
and nothing here charges, refunds or stores anything.

## Try it privately

1. Open this folder as the workspace in Zorvo.
2. Start a Qwen Code draft with **Private · TEE** on.
3. Send: **"Review the payment module for client Acme and list what could leak card data."**

The demo contains three planted problems, so the answer has something to find:

- `payment.js` logs the full card number on every charge.
- `payment.js` has a hard-coded fake gateway key. Pasting that key into a private message would also
  trip the secret guard before it left this Mac.
- `refund()` accepts any amount, including a negative one or more than the order's total, because it
  never checks the input.

## Files

- `payment.js` — the payment module the agent should review.
- `demo.js` — runs one charge and one refund with the test card.
- `orders.json` — a small fictional order book; every address uses the reserved `.test` domain.