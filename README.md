# Microsoft Fabric Credit Ratings

Bond-style credit ratings (AAA to E) for every Microsoft Fabric item. Each item is scored 1 to 7 on **Feature Capability**, **User Experience**, and **CU / Token Cost**. The three scores add up to a total out of 21, and each point of the total is one notch on the scale (21 = AAA, 12 = BBB-, the lowest investment grade, 3 = C). D and E are flags for broken and withdrawn items.

The ratings in this repo are examples for design review.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript only |

## Where things live

- `src/domain/scale.ts`: grade scale, `TOTAL_TO_GRADE`, bands, outlooks
- `src/data/factors.ts`: the three scoring factors
- `src/data/artifacts.ts`: Fabric items and their workloads
- `src/data/submissions.mock.ts`: dated scoring entries (example data)
- `src/data/index.ts`: `getRatings()` turns entries into ratings. The newest entry per item is the current rating, and older entries become its history. This is the only file to change when ratings come from a real source.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**.

The site is served at https://fabriccreditratings.com (custom domain, DNS at Bluehost). `base` in `vite.config.ts` is `'/'` and `public/CNAME` holds the domain.
