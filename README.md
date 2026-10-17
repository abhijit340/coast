# Coast FIRE

Live at https://coast-aj.pages.dev (Cloudflare Pages; every push to main redeploys).

A two-income Coast FIRE calculator. It answers: *if we both stopped saving for retirement, would what we have grow into enough by the time we retire? If not yet, when could we stop, and what would it take?* It also plans an early-retirement bridge to 59½ with Rule 72(t) payments and a Roth conversion ladder.

Live at: `https://<project>.pages.dev/` (Cloudflare Pages, site root = repo root).

It's a static page: plain HTML, CSS and JavaScript, with no build step, frameworks, CDN, fonts or analytics. It installs to a phone's home screen and works offline. Nothing you type leaves the browser.

## Using it

The first screen holds only the answer and the chart. Everything else is still there, folded into rows that each show a live one-line value ("Contributions · $22,784/yr", "Returns 7.0% · inflation 2.4% · withdraw 4.0%"); tap a row to open it. Which rows are open is remembered on this device, separately from your numbers.

- **Answer first.** A progress ring, a status chip (On track / Coasting now / Not before 65 / $X short), the earliest age you could both stop saving, and one sentence about that same scenario. When nothing works yet (the case with the median defaults), it says how far short you are and what would close it: save more each year, retire later, or spend less.
- **Your numbers:** ages, invested money and retirement spending; then collapsed rows for returns, inflation & withdrawals and for an optional Barista FIRE draw while coasting. A field's (i) shows its note.
- **Partners A and B** (stack on phones): salary and a total line shown; 401(k), employer %, Roth IRA and an optional "Coast from an age" in a collapsed row, with "Keep saving after coasting" (% of before). The × or the Two incomes switch makes it a one-person plan. Legal limits show as a tick and label on the slider; typing over one clamps with a note.
- **Sliders on phones:** a vertical swipe across a slider scrolls the page, a tap on the track does nothing, and only a sideways drag that starts on the thumb moves it (the thumb glows and the number box lights up), with a toast to Undo it; a drag the phone interrupts puts the value back. The number box is the precise way in; arrow keys and screen readers work as before.
- **HSA:** one collapsed row for the household; Family (one $8,750 limit) or Self-only ($4,400 each).
- **Go deeper** (collapsed rows below the inputs, or on the right on wide screens): contributions, earliest coast age, what-if table, the bridge, and how it works.
- **Earliest coast age:** solved for both together and for each partner alone (the other's plan held as set), each with an **Apply** button that sets the coast switches and ages.
- **Your path (main chart):** your plan, the coast line, "if you stop today", and a dashed teal **Keep saving, never coast** line: everyone keeps their full saving for good (no coast ages, no Barista draw), working past the retirement age if needed. A dot marks where it reaches the FIRE number ("Keep saving → retire at 75"), and the age axis runs past retirement far enough to show it. The **Never coast** tile says "you could retire at about N" and how that compares with your chosen age (or "Not by 100"). Drag or use the arrow keys for a readout; **Show as a table** lists every age.
- **What if returns or withdrawals differ?** A real table: rows are the investment return before inflation, columns the safe withdrawal rate, each header with its unit, and a caption saying what a cell means (the earliest age you could both stop saving). Shade = years of coasting, hatched = can't reach the FIRE number even saving the whole way (the % shows how much you'd have), and the cell for your own inputs is outlined and labelled "your inputs". A legend under the table explains all three.
- **Buying a home** (off by default; one collapsed row after the HSA): switch it on to compare buying a home at an age against renting. Price, down payment (from invested money or a separate cash fund), mortgage rate and 15/30-year term, rent today, and under "Costs and growth" closing and selling costs, property tax, insurance, maintenance, mortgage insurance (PMI), home-price and rent growth above inflation. Each year the difference between owning (payment, tax, insurance, upkeep, PMI) and rent comes out of, or adds to, saving. Your retirement spending is taken to include today's rent; an owner's FIRE number swaps the rent for the home's running costs plus any mortgage still due. The row's summary gives the verdict ("Buy at 45: FI 13.6 yrs later"); inside, a short renting vs buying list (monthly cost, cash at closing, FI age, net worth at retirement), then "How this is worked out" (coast ages, portfolio at retirement, the two FIRE numbers and the notes), breakeven home growth and mortgage rate, and caveats. The chart adds a "Buy a home" line (the portfolio, never the house), with a column for it and home equity in the table. Not advice; taxes and the mortgage-interest deduction aren't modeled.
- **Retire before 59½:** shown when the retirement age is under 59½ (otherwise a teaser card). Splits pre-tax money into a 72(t) IRA and a ladder IRA, then shows each year to 59½: 72(t) (fixed, locked), taxable, Roth basis, ripe ladder rungs, and any gap year with the amount.
- Inputs are remembered in this browser only (`localStorage` key `coastfire.v2`). **Reset** (top right, or below the inputs) restores the defaults, with Undo. **Copy link** puts the numbers after `#` (on a phone, the share sheet), e.g. `#a=42&r=65&b=45000&s=71000&sa=62608&ka=4800`. Opening a link shows its numbers with a banner and leaves your saved numbers alone until you edit or keep them. v1 links still open.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `style.css` | Styles; light and dark follow the system setting |
| `calc.js` | All the math, pure functions, no DOM. `window.CoastFire` in the browser, `require("./calc.js")` in node. Holds the 2026 limits and the IRS Single Life Table (ages 30–60) |
| `ui.js` | The one-line summaries on collapsed rows and the saved open/closed state; pure, tested in node |
| `app.js` | Builds the fields, keeps boxes and sliders in sync, writes results, draws the SVG charts, saves inputs |
| `sw.js` | Service worker: network first, saved copy after 3 s or offline. Bump `CACHE` (now `coast-fire-v7`) whenever the files change |
| `manifest.webmanifest`, `icons/` | Home-screen install. `python tools/make_icons.py` (needs Pillow) redraws the icons |
| `privacy.html` | Privacy note |
| `tests/run_tests.js` | Tests |
| `SPEC.md` | Inputs, formulas, design, and the cited defaults |

## Tests

```
node tests/run_tests.js
```

No packages needed. Hand-checked cases for two incomes, coast downshifts, the family vs self-only HSA, the Barista draw, the earliest-coast-age solver (together and each partner alone), the 72(t) payment ($1,000,000 at 45, 5%, life expectancy 41.0 → $57,822.29), a bridge timeline with gap years and ladder rungs, and rent vs buy (mortgage payment and balance, PMI drop-off at 78%, owning costs flowing into saving with a floor at 0, the owner's FIRE number, breakevens that tie net worth, equity after selling costs, and that switching it off changes nothing else); closed-form and brute-force cross-checks; limits, clamps, the URL hash, slider scale and formatting; the touch-slider gestures (tap, sideways drag, vertical swipe, near-thumb hit test, a cancelled drag putting the value back); that the defaults equal the cited table and the Single Life values match the regulation; and a privacy scan that fails on spreadsheets or on any dollar amount or 4+ digit number not on its allowlist.

To preview, serve the folder (`python -m http.server 8000`) and open http://localhost:8000/.

## The math, briefly

All in today's dollars. Real return *r* = (1 + return) / (1 + inflation) − 1. FIRE number = spending ÷ withdrawal rate. Each year: balance × (1 + *r*) + that year's contributions (each partner's 401(k) + employer + Roth, changing at their coast age, plus the HSA) − any Barista draw. The coast line is the FIRE number discounted to each age. 72(t): fixed amortization, payment = B·i / (1 − (1 + i)^−LE), fixed in dollars so it shrinks in today's dollars. Details in `SPEC.md`.

## Where the defaults come from

US medians or typical figures, never anyone's own numbers (a test enforces it). Full citations in `SPEC.md` section 8.

| Input | Default | Source |
|---|---|---|
| Salary, each | $62,608 | BLS median full-time weekly earnings 2025, $1,204 × 52 |
| 401(k) | $4,800 (7.7%) | Vanguard *How America Saves 2025*, average deferral rate |
| Employer | 4.3% | Same report: 12.0% total − 7.7% |
| Roth IRA | $3,200 | IRS data via CRS R48051: average for filers 35–49, $3,211 (2022) |
| HSA (family) | $1,400 | Devenir: about 60 billion dollars contributed across 41.7M accounts in 2025 ≈ $1,440 |
| Invested | $45,000 | Fed SCF 2022, median retirement accounts, ages 35–44 |
| Age | 42 | BLS median age of employed workers, 2025 |
| Spending | $71,000 | BLS CE 2024, two-person households: $80,830 − $9,652 pension/Social Security contributions |
| Inflation | 2.4% | Social Security Trustees' long-run intermediate CPI assumption |
| Return / withdrawal / retirement | 7% / 4% / 65 | Common planning figures |
| Home (when on) | $418,000 · 10% down · 7.4% · 30 yrs · rent $1,530/mo | NAR median existing-home price (Sep 2026), NAR first-time buyers, Freddie Mac PMMS, Census median asking rent |
| Home costs | tax 0.9% · insurance $1,600 · upkeep 1% · PMI 0.6% · closing 3% · selling 6% · growth 0.5% real · rent growth 0% | ATTOM, NAIC via III, Fannie Mae, Freddie Mac, Chase, RealTrends, Shiller, NBER (SPEC section 11.9) |
| 2026 limits | $24,500 / $7,500 / $4,400 & $8,750 | IRS; Rev. Proc. 2025-19 |

With these numbers the household does not reach its FIRE number by 65; the page treats that as a designed state, not an error.

This is a planning toy, not financial or tax advice.
