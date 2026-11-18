# Chrome Web Store listing

Upload: `node store/package.mjs` → `store/dist/aa-plus-<version>.zip`. Images: `node store/assets.mjs` → `store/assets/`.

## Store listing

- **Name:** AA Plus (from the manifest)
- **Summary:** from the manifest `description`
- **Category:** Tools
- **Language:** English
- **Store icon:** `icons/128.png`
- **Screenshots (1280x800):** `store/assets/screenshot-1.png` … `screenshot-5.png`
- **Small promo tile (440x280):** `store/assets/promo-small.png`
- **Homepage / support:** https://github.com/adamholter/aa-plus

**Description:**

AA Plus adds controls and charts to Artificial Analysis (artificialanalysis.ai), on its own pages and in its own look.

Unofficial: not made by or affiliated with Artificial Analysis.

- Subscription pricing: AA's cost charts priced at what a subscriber to each lab's plan effectively pays (each model at its plan's share of API price), switchable back to API prices on any chart.
- Effort picks: show models at their highest effort, AA's API default, or any set of None, Low, Medium, High, XHigh and Max.
- Plan per lab: choose which plan each lab's models are priced on.
- New charts: Plan Price vs. API Price, and a strengths radar across the evaluations in the Intelligence Index, with what each evaluation measures.
- Advanced settings, out of the way until opened: cost and time from other sources (such as real-use data), and filters by release date, lab, open or closed weights and plan availability.
- Report a bug or request a feature from inside the extension.
- Dark mode, which AA does not have.
- Nothing reloads: AA's own charts redraw in place, including the Pareto line.

Plan prices and evaluation scores come from Priors (mypriors.com), refreshed every 15 minutes. Everything else is read from the AA page you are on. Open source (MIT): https://github.com/adamholter/aa-plus

## Privacy practices

- **Single purpose:** Adds subscription pricing, effort selection and extra charts to the pages of artificialanalysis.ai.
- **storage:** Saves the user's settings (pricing, efforts, plan per lab, added charts, theme) and caches the public Priors data for 30 minutes.
- **Host permission https://mypriors.com/*:** Fetches public plan-price, evaluation-score and cost/time data (`/api/plan-prices`, `/api/aa-strengths`, `/api/aa-task-metrics`). Sends a bug report or feature request only when the user presses Send (`/api/feedback`).
- **Content scripts on https://artificialanalysis.ai/*:** Adds the controls and redraws the charts on that site.
- **Remote code:** No. All code is in the package; only JSON data is fetched.
- **Data usage:** Nothing is collected in the background. A report the user chooses to send contains what they wrote, any contact and screenshots they added, and, unless unticked, the extension version, browser, AA page path and AA Plus settings shown in the form. It is used only to fix bugs and plan features, and is not sold or transferred.
- **Privacy policy:** https://github.com/adamholter/aa-plus#privacy
