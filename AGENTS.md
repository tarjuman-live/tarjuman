<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`bunx convex ai-files install`.

<!-- convex-ai-end -->

## Local dev runs on port 3000 — always

`bun run dev` reclaims port 3000 (`scripts/free-port.mjs` kills whatever holds it)
and boots there. Never move the app to another port to dodge a collision: the auth,
Convex, and Stripe callbacks are all pinned to `http://localhost:3000`. The server
opens Dia at that URL on boot; set `OPEN_BROWSER=0` to suppress it.
