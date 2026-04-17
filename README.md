# sst-leaderboard

A live monthly recruiter leaderboard rendered from a Notion database. One Vercel serverless function, no build step, no database of its own — your Notion is the source of truth.

Built for — and running in production at — **Six Sigma Talent K.K.**, a Tokyo-based bilingual executive recruiting firm. Open-sourced as a self-contained component you can drop into any Notion-based recruiting pipeline.

---

## Why this exists

Most recruiting teams live in a CRM where reporting means "export to spreadsheet, send weekly." We wanted the opposite: a live page, always current, that anyone on the team can leave open in a browser tab. No login, no dashboard tool, no BI subscription.

If your team tracks sendouts in a Notion database, this gets you a live ranked leaderboard in ~10 minutes.

## How it works

1. On each page load, the serverless function queries your Notion Sendouts database filtered to the selected month.
2. For each sendout record, it extracts the **Candidate Owner** and **Client Owner** from rollup properties.
3. It tallies contributions per recruiter, sorts by total, and renders a standalone HTML page.
4. The response is cached for 60 seconds at the edge, so your Notion workspace isn't hammered.

The whole thing is ~300 lines of TypeScript in a single file. No client-side JS, no framework, no node_modules beyond `@vercel/node`.

## Expected Notion schema

Your Sendouts database needs at minimum:

| Property         | Type    | Purpose                                      |
| ---------------- | ------- | -------------------------------------------- |
| `Interview Date` | date    | Used to filter sendouts into monthly buckets |
| `Candidate Owner`| rollup  | Who owns the candidate side of the sendout   |
| `Client Owner`   | rollup  | Who owns the client side of the sendout      |

The rollups typically point to a related Candidate and related Job record, pulling each record's Owner field. Property names are configurable in `api/leaderboard.ts` (`CONFIG` object).

## Deploy

```bash
# 1. Clone and install
git clone https://github.com/tony-six-sigma/sst-leaderboard.git
cd sst-leaderboard
npm install

# 2. Set environment variables
vercel env add NOTION_API_KEY        # Your Notion integration token
vercel env add SENDOUTS_DB_ID        # UUID of your Sendouts database
vercel env add ORG_NAME              # (optional) displayed in header

# 3. Deploy
vercel --prod
```

Your leaderboard is live at `https://your-project.vercel.app/api/leaderboard`.

## Configuration

Edit the `CONFIG` object at the top of `api/leaderboard.ts` to change property names or defaults:

```ts
const CONFIG = {
  dateProperty: "Interview Date",       // date field to group by
  candidateOwnerProperty: "Candidate Owner",
  clientOwnerProperty: "Client Owner",
  orgName: process.env.ORG_NAME || "Recruiting Team",
};
```

## Design notes

**Why Interview Date, not Created Date?** Sendouts are often created days or weeks before the actual interview. Counting by creation date under-credits recruiters whose work lands in the following month. Interview Date reflects the month the recruiting activity actually happened.

**Why rollups, not direct properties?** The Owner of a sendout is derived from whoever owns the related candidate and related job record — a single source of truth. If a recruiter transfers ownership of a candidate, their historical sendouts automatically re-attribute. No back-filling.

**Why cache 60s?** Notion's API is rate-limited and slow (~500ms per query on average). A 60s edge cache means every page load completes in <50ms on a cache hit, and we hit Notion at most once per minute per region.

## License

MIT.

---

Built by [Tony Nakada](https://github.com/tony-six-sigma) · [sixsigmatalent.com](https://sixsigmatalent.com)
