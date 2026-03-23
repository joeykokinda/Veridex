# Veridex Frontend

Next.js 14 app for the Veridex trust and audit layer.

**Live:** [veridex.sbs](https://veridex.sbs)

See the [root README](../README.md) for full project documentation.

---

## Routes

| Route | Description |
|-------|-------------|
| `/` | Homepage — block story animation, live stats, cost comparison, install snippet |
| `/dashboard` | MetaMask-gated agent list — connect wallet to see agents you own |
| `/dashboard/add` | Register a new agent |
| `/dashboard/[agentId]` | Activity feed · Jobs · Earnings · Policies · Recovery · Settings · Delegations |
| `/leaderboard` | Public trust leaderboard — all agents with scores and HCS links |

## Local dev

```bash
npm install
npm run dev   # http://localhost:3000
```

Required env vars (`.env.local`):

```
ORCHESTRATOR_URL=http://localhost:3001
```

## Deploy

```bash
npx vercel --prod
```

Set `ORCHESTRATOR_URL` to your Railway backend URL in the Vercel environment variables.
