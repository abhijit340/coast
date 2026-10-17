// Coast FIRE math (v2: two-income household). Pure functions, no DOM, so the
// same file runs in the page (as window.CoastFire) and in node for the tests.
//
// Everything is in today's dollars: the nominal return is converted to a real
// (after-inflation) return with the exact Fisher formula, and contributions are
// held constant in today's dollars. The projection steps one year at a time:
//   B[k+1] = B[k] * (1 + r) + contributions in year k - Barista draw in year k
// (contributions and draws at the end of each year). See SPEC.md section 4.
(function (root) {
  "use strict";

  // ---------- 2026 legal limits (verified, sources in SPEC.md section 8) ----------
  const LIMITS = Object.freeze({
    year: 2026,
    k401: 24500,            // IRS: 401(k) elective deferral limit for 2026
    k401CatchUp: 8000,      // age 50+ (not modeled; mentioned as a note)
    k401CatchUp6063: 11250, // ages 60-63 (not modeled)
    roth: 7500,             // IRA contribution limit for 2026
    rothCatchUp: 1100,      // age 50+ (not modeled)
    hsaFamily: 8750,        // Rev. Proc. 2025-19, family HDHP coverage
    hsaSelf: 4400,          // Rev. Proc. 2025-19, self-only coverage (per person)
  });

  // IRS Single Life Table, Treas. Reg. 1.401(a)(9)-9(b) (the table Notice 2022-6
  // requires for 72(t) payments from 2022 on). Ages 30-60, checked against the
  // regulation text on 2026-10-16.
  const SINGLE_LIFE = Object.freeze({
    30: 55.3, 31: 54.4, 32: 53.4, 33: 52.5, 34: 51.5, 35: 50.5, 36: 49.6, 37: 48.6, 38: 47.7, 39: 46.7,
    40: 45.7, 41: 44.8, 42: 43.8, 43: 42.9, 44: 41.9, 45: 41.0, 46: 40.0, 47: 39.0, 48: 38.1, 49: 37.1,
    50: 36.2, 51: 35.3, 52: 34.3, 53: 33.4, 54: 32.5, 55: 31.6, 56: 30.6, 57: 29.8, 58: 28.9, 59: 28.0,
    60: 27.1,
  });

  // US medians / typical figures; sources in SPEC.md section 8. Never anyone's own numbers.
  // Switches are stored as 0/1 so every input is a number (simple hash and storage).
  const PARTNER = { sal: 62608, k: 4800, emp: 4.3, roth: 3200, coastOn: 0, coastAge: 55, after: 0 };
  const DEFAULTS = Object.freeze({
    age: 42, retAge: 65, assets: 45000, spend: 71000, nominal: 7, inflation: 2.4, swr: 4, draw: 0,
    two: 1, hsaFamily: 1, hsa: 1400,
    salA: PARTNER.sal, kA: PARTNER.k, empA: PARTNER.emp, rothA: PARTNER.roth,
    coastOnA: PARTNER.coastOn, coastAgeA: PARTNER.coastAge, afterA: PARTNER.after,
    salB: PARTNER.sal, kB: PARTNER.k, empB: PARTNER.emp, rothB: PARTNER.roth,
    coastOnB: PARTNER.coastOn, coastAgeB: PARTNER.coastAge, afterB: PARTNER.after,
    preShare: 90, sepShare: 50, sepRate: 5, basis: 0, taxable: 0, lead: 0,
    // Buying a home (SPEC 11.9): off by default; US typical figures when switched on.
    houseOn: 0, buyAge: 45, price: 418000, downPct: 10, downFrom: 1, mortRate: 7.4, term: 30,
    pmi: 0.6, closePct: 3, sellPct: 6, propTax: 0.9, insure: 1600, maint: 1, apprec: 0.5,
    rent: 1530, rentGrowth: 0,
  });

  // min/max: what a typed value is clamped to. sMin/sMax: the slider's range.
  // curve: square-root slider. limit: a legal limit (the field max, labelled on the slider).
  const FIELDS = Object.freeze({
    age:       { min: 0,   max: 110,  sMin: 18, sMax: 80,      step: 1,    int: true },
    retAge:    { min: 0,   max: 120,  sMin: 30, sMax: 85,      step: 1,    int: true },
    assets:    { min: 0,   max: 1e10, sMin: 0,  sMax: 2000000, step: 1000, curve: true, money: true },
    spend:     { min: 0,   max: 1e8,  sMin: 10000, sMax: 250000, step: 1000, curve: true, money: true },
    nominal:   { min: -20, max: 30,   sMin: 0,  sMax: 12,      step: 0.1 },
    inflation: { min: -5,  max: 20,   sMin: 0,  sMax: 8,       step: 0.1 },
    swr:       { min: 0.1, max: 20,   sMin: 2.5, sMax: 6,      step: 0.1 },
    draw:      { min: 0,   max: 1e8,  sMin: 0,  sMax: 100000,  step: 500,  curve: true, money: true },
    two:       { bool: true },
    hsaFamily: { bool: true },
    hsa:       { min: 0,   max: 2 * LIMITS.hsaSelf, sMin: 0, sMax: LIMITS.hsaFamily, step: 50, curve: true, money: true, limit: "hsa" },
    salA:      { min: 0,   max: 1e8,  sMin: 0,  sMax: 300000,  step: 1000, curve: true, money: true },
    kA:        { min: 0,   max: LIMITS.k401, sMin: 0, sMax: LIMITS.k401, step: 100, curve: true, money: true, limit: "k401" },
    empA:      { min: 0,   max: 50,   sMin: 0,  sMax: 10,      step: 0.1 },
    rothA:     { min: 0,   max: LIMITS.roth, sMin: 0, sMax: LIMITS.roth, step: 100, curve: true, money: true, limit: "roth" },
    coastOnA:  { bool: true },
    coastAgeA: { min: 0,   max: 120,  sMin: 18, sMax: 85,      step: 1,    int: true },
    afterA:    { min: 0,   max: 100,  sMin: 0,  sMax: 100,     step: 5 },
    salB:      { min: 0,   max: 1e8,  sMin: 0,  sMax: 300000,  step: 1000, curve: true, money: true },
    kB:        { min: 0,   max: LIMITS.k401, sMin: 0, sMax: LIMITS.k401, step: 100, curve: true, money: true, limit: "k401" },
    empB:      { min: 0,   max: 50,   sMin: 0,  sMax: 10,      step: 0.1 },
    rothB:     { min: 0,   max: LIMITS.roth, sMin: 0, sMax: LIMITS.roth, step: 100, curve: true, money: true, limit: "roth" },
    coastOnB:  { bool: true },
    coastAgeB: { min: 0,   max: 120,  sMin: 18, sMax: 85,      step: 1,    int: true },
    afterB:    { min: 0,   max: 100,  sMin: 0,  sMax: 100,     step: 5 },
    preShare:  { min: 0,   max: 100,  sMin: 0,  sMax: 100,     step: 1 },
    sepShare:  { min: 0,   max: 100,  sMin: 0,  sMax: 100,     step: 1 },
    sepRate:   { min: 0,   max: 20,   sMin: 0,  sMax: 10,      step: 0.1 },
    basis:     { min: 0,   max: 1e10, sMin: 0,  sMax: 500000,  step: 1000, curve: true, money: true },
    taxable:   { min: 0,   max: 1e10, sMin: 0,  sMax: 500000,  step: 1000, curve: true, money: true },
    lead:      { min: 0,   max: 5,    sMin: 0,  sMax: 5,       step: 1,    int: true },
    houseOn:   { bool: true },
    buyAge:    { min: 0,   max: 120,  sMin: 18, sMax: 85,      step: 1,    int: true },
    price:     { min: 0,   max: 1e9,  sMin: 50000, sMax: 1500000, step: 1000, curve: true, money: true },
    downPct:   { min: 3,   max: 100,  sMin: 3,  sMax: 50,      step: 1 },   // no 100% loan
    downFrom:  { bool: true },                                              // 1 = invested assets, 0 = separate cash
    mortRate:  { min: 0,   max: 20,   sMin: 2,  sMax: 10,      step: 0.05 },
    term:      { choice: [15, 30] },                                        // anything but 15 cleans to 30
    pmi:       { min: 0,   max: 3,    sMin: 0,  sMax: 1.5,     step: 0.05 },
    closePct:  { min: 0,   max: 10,   sMin: 0,  sMax: 6,       step: 0.1 },
    sellPct:   { min: 0,   max: 15,   sMin: 0,  sMax: 10,      step: 0.1 },
    propTax:   { min: 0,   max: 5,    sMin: 0,  sMax: 3,       step: 0.05 },
    insure:    { min: 0,   max: 1e6,  sMin: 0,  sMax: 10000,   step: 50,   curve: true, money: true },
    maint:     { min: 0,   max: 10,   sMin: 0,  sMax: 4,       step: 0.1 },
    apprec:    { min: -10, max: 10,   sMin: -2, sMax: 3,       step: 0.1 },
    rent:      { min: 0,   max: 1e6,  sMin: 0,  sMax: 5000,    step: 10,   curve: true, money: true },
    rentGrowth:{ min: -10, max: 10,   sMin: -2, sMax: 3,       step: 0.1 },
  });
  const KEYS = Object.keys(DEFAULTS);

  // Short names for the URL hash. v1 links (#a=42&r=65&s=..&b=..&n=..&i=..&w=..) still open.
  const HASH_KEYS = Object.freeze({
    age: "a", retAge: "r", assets: "b", spend: "s", nominal: "n", inflation: "i", swr: "w", draw: "d",
    two: "t", hsaFamily: "f", hsa: "h",
    salA: "sa", kA: "ka", empA: "ea", rothA: "ra", coastOnA: "ca", coastAgeA: "ga", afterA: "pa",
    salB: "sb", kB: "kb", empB: "eb", rothB: "rb", coastOnB: "cb", coastAgeB: "gb", afterB: "pb",
    preShare: "x", sepShare: "y", sepRate: "z", basis: "q", taxable: "c", lead: "l",
    houseOn: "ho", buyAge: "hb", price: "hp", downPct: "hd", downFrom: "hf", mortRate: "hm", term: "ht",
    pmi: "hq", closePct: "hc", sellPct: "hs", propTax: "hx", insure: "hi", maint: "hn", apprec: "hg",
    rent: "hr", rentGrowth: "hw",
  });

  // ---------- building blocks ----------

  /** Annual real return from nominal return and inflation, both decimals (0.07, 0.024). */
  function realReturn(nominal, inflation) { return (1 + nominal) / (1 + inflation) - 1; }

  /** Portfolio needed at retirement: spending / withdrawal rate (decimal). Rate floors at 0.1%. */
  function fireNumber(spend, swr) { return spend / Math.max(swr, 0.001); }

  /** What you'd need invested `years` before retirement to coast to `fire` at real return r. */
  function coastNumber(fire, r, years) { return fire / Math.pow(1 + r, Math.max(years, 0)); }

  /** Future value of 1 a year, paid at the end of each year, for n years at rate r. */
  function annuityFactor(r, n) { return Math.abs(r) < 1e-12 ? n : (Math.pow(1 + r, n) - 1) / r; }

  /** HSA limit for the household: one family limit, or the self-only limit per person. */
  function hsaLimit(v) {
    return v.hsaFamily ? LIMITS.hsaFamily : LIMITS.hsaSelf * (v.two ? 2 : 1);
  }

  /** Parse what someone typed: "71,000", "$71000", "7 %" all work. NaN when it isn't a number. */
  function parseNumber(text) {
    if (typeof text === "number") return text;
    if (typeof text === "boolean") return text ? 1 : 0;
    const s = String(text == null ? "" : text).replace(/[$,%\s_]/g, "");
    if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return Number(s);
  }

  /**
   * Clean one field: clamp to its limits, round ages, 0/1 for switches.
   * Returns {value, ok}; ok is false (and value is `fallback`) when it isn't a number.
   */
  function cleanField(key, raw, fallback) {
    const f = FIELDS[key];
    const n = parseNumber(raw);
    const fb = fallback === undefined ? DEFAULTS[key] : fallback;
    if (!Number.isFinite(n)) return { value: fb, ok: false };
    if (f.bool) return { value: n ? 1 : 0, ok: true };
    if (f.choice) return { value: n === f.choice[0] ? f.choice[0] : f.choice[f.choice.length - 1], ok: true };
    let v = Math.min(f.max, Math.max(f.min, n));
    if (f.int) v = Math.round(v);
    return { value: v, ok: true };
  }

  /** Clean a whole set of inputs; missing or bad fields fall back to `base` (defaults if omitted). */
  function sanitize(inputs, base) {
    const from = base || DEFAULTS;
    const out = {};
    const invalid = [];
    for (const k of KEYS) {
      const has = inputs && inputs[k] !== undefined && inputs[k] !== null;
      const c = cleanField(k, has ? inputs[k] : from[k], from[k]);
      if (!c.ok) invalid.push(k);
      out[k] = c.value;
    }
    // The HSA limit depends on the coverage switch and the number of partners.
    const lim = hsaLimit(out);
    const hsaClamped = out.hsa > lim;
    if (hsaClamped) out.hsa = lim;
    return { values: out, invalid, hsaClamped };
  }

  // ---------- contributions ----------

  /** One partner's own yearly saving before coasting: 401(k) + employer + Roth IRA. */
  function partnerBase(v, p) {
    const k = v["k" + p], emp = v["sal" + p] * v["emp" + p] / 100, roth = v["roth" + p];
    return { k401: k, employer: emp, roth, total: k + emp + roth };
  }

  /** Which partners are in the plan. */
  function partners(v) { return v.two ? ["A", "B"] : ["A"]; }

  /**
   * The coast plan as entered: {A: {on, age, after}, B: {...}}. `override`
   * replaces parts of it (used by the solvers).
   */
  function planOf(v, override) {
    const plan = {};
    for (const p of partners(v)) {
      plan[p] = { on: !!v["coastOn" + p], age: v["coastAge" + p], after: v["after" + p] / 100 };
      if (override && override[p]) Object.assign(plan[p], override[p]);
    }
    return plan;
  }

  /** Nobody coasts: everyone saves until retirement. */
  function fullPlanOf(v) { return planOf(v, { A: { on: false }, B: { on: false } }); }

  /** Share of a partner's pre-coast saving still going in during the year that starts at `age`. */
  function factorAt(pl, age) { return pl.on && age >= pl.age ? pl.after : 1; }

  /** Age the first partner starts coasting (the Barista draw starts here), or Infinity. */
  function firstCoastAge(plan) {
    let a = Infinity;
    for (const p in plan) if (plan[p].on) a = Math.min(a, plan[p].age);
    return a;
  }

  /**
   * Contributions in the year that starts at `age`, by source, in today's dollars.
   * HSA: family coverage is one shared account that keeps going until the last
   * partner coasts (then at that partner's "after" share); self-only coverage is
   * split evenly and follows each partner's own plan.
   */
  function contribAt(v, plan, age) {
    const out = { k401: 0, employer: 0, roth: 0, hsa: 0, byPartner: {} };
    const ps = partners(v);
    for (const p of ps) {
      const b = partnerBase(v, p), f = factorAt(plan[p], age);
      out.k401 += b.k401 * f; out.employer += b.employer * f; out.roth += b.roth * f;
      out.byPartner[p] = b.total * f;
    }
    if (v.hsaFamily) {
      const allCoasting = ps.every((p) => plan[p].on && age >= plan[p].age);
      let f = 1;
      if (allCoasting) {
        // The share of whoever coasted last; on a tie, the larger share of those
        // partners (the household keeps funding the shared account at that rate).
        const lastAge = Math.max(...ps.map((p) => plan[p].age));
        f = Math.max(...ps.filter((p) => plan[p].age === lastAge).map((p) => plan[p].after));
      }
      out.hsa = v.hsa * f;
    } else {
      for (const p of ps) out.hsa += v.hsa / ps.length * factorAt(plan[p], age);
    }
    out.total = out.k401 + out.employer + out.roth + out.hsa;
    return out;
  }

  // ---------- the projection ----------

  /** Balance path for a plan, one point per whole year from `age` to `retAge`. */
  function path(v, plan, r) {
    const n = Math.max(0, v.retAge - v.age);
    const first = firstCoastAge(plan);
    const pts = [];
    let B = v.assets;
    for (let k = 0; k <= n; k++) {
      const age = v.age + k;
      const c = k < n ? contribAt(v, plan, age).total : 0;
      const draw = k < n && age >= first ? v.draw : 0;
      pts.push({ age, balance: B, contrib: c, draw });
      if (k < n) B = Math.max(0, B * (1 + r) + c - draw);
    }
    return pts;
  }

  function balanceAtRet(v, plan, r) {
    const pts = path(v, plan, r);
    return pts[pts.length - 1].balance;
  }

  /**
   * Earliest whole age `who` ("both", "A" or "B") can coast and still reach the
   * FIRE number by retirement, holding the other partner's plan as entered.
   * Coasting at the retirement age means saving the whole way.
   * Returns {age, years, after} or, when not possible, {age: null, best} with
   * what saving the whole way would reach. `after` is the yearly saving that
   * still goes in once coasting starts (each partner's "after" share; 0 when
   * nobody keeps saving), so "no more saving" is only said when it is 0.
   */
  function earliestCoast(v, who, fire, r) {
    const tol = 1e-6 * Math.max(1, fire);
    const make = (c) => {
      const o = {};
      for (const p of partners(v)) if (who === "both" || who === p) o[p] = { on: true, age: c };
      return planOf(v, o);
    };
    for (let c = v.age; c <= v.retAge; c++) {
      if (balanceAtRet(v, make(c), r) >= fire - tol) {
        const after = c < v.retAge ? contribAt(v, make(c), c).total : 0;
        return { age: c, years: v.retAge - c, after };
      }
    }
    return { age: null, years: 0, best: balanceAtRet(v, make(v.retAge), r) };
  }

  const NEVER_COAST_MAX_AGE = 100;

  /**
   * "Keep saving at full pace, never coast": every partner keeps their full
   * pre-coast saving (401(k), employer, Roth IRA, HSA) every year, coast ages and
   * the Barista draw are ignored, and the household keeps working past the chosen
   * retirement age if it has to. When does the balance first reach `fire`?
   *
   *   neverCoastAge(v, fire, r, maxAge = 100)
   *     v: sanitized inputs, fire: FIRE number, r: real return (decimal).
   *     The search runs to top = max(v.age, maxAge, v.retAge), so it always covers
   *     the chosen retirement age and starts no earlier than today.
   *   -> { age, wholeAge, yearly, points, top }
   *     age: fractional age, interpolated linearly between the two year-ends
   *          around the crossing (v.age when already there today), or null when
   *          the balance never reaches `fire` by `top`;
   *     wholeAge: first whole age whose year-end balance is at or above `fire`
   *          (Math.ceil of `age`), or null;
   *     yearly: the constant real yearly saving used;
   *     points: [{age, balance}] for every whole age from v.age to top;
   *     top: the last age searched.
   */
  function neverCoastAge(v, fire, r, maxAge) {
    const top = Math.max(v.age, v.retAge, maxAge === undefined ? NEVER_COAST_MAX_AGE : maxAge);
    const yearly = contribAt(v, fullPlanOf(v), v.age).total; // constant in today's dollars
    const tol = 1e-9 * Math.max(1, Math.abs(fire));
    const points = [];
    let B = v.assets, age = null, wholeAge = null;
    for (let a = v.age; a <= top; a++) {
      points.push({ age: a, balance: B });
      if (age === null && B >= fire - tol) {
        const prev = points.length > 1 ? points[points.length - 2].balance : null;
        age = prev === null || B <= prev ? a : (a - 1) + Math.min(1, Math.max(0, (fire - prev) / (B - prev)));
        wholeAge = a;
      }
      if (a < top) B = Math.max(0, B * (1 + r) + yearly);
    }
    return { age, wholeAge, yearly, points, top };
  }

  /** The whole calculation. Inputs use the page's units (ages, dollars, percent). */
  function project(inputs) {
    const san = sanitize(inputs);
    const v = san.values;
    const warnings = [];
    const r = realReturn(v.nominal / 100, v.inflation / 100);
    const fire = fireNumber(v.spend, v.swr / 100);
    let n = v.retAge - v.age;
    if (n <= 0) { n = 0; warnings.push("retAgeNotAfterAge"); }
    if (r < 0) warnings.push("negativeRealReturn");
    if (v.spend === 0) warnings.push("zeroSpend");

    const plan = planOf(v);
    const coastNow = coastNumber(fire, r, n);
    const points = path(v, plan, r).map((p, k) => ({
      ...p,
      coastLine: coastNumber(fire, r, n - k),
      noContrib: v.assets * Math.pow(1 + r, k),
    }));
    const balance = points[points.length - 1].balance;
    const noContribAtRet = v.assets * Math.pow(1 + r, n);
    const tol = (x) => 1e-9 * Math.max(1, x);
    // First whole age the plan's balance is at or above the coast line.
    let crossAge = null;
    for (const y of points) if (y.balance >= y.coastLine - tol(y.coastLine)) { crossAge = y.age; break; }
    const reached = n > 0 ? v.assets >= coastNow - tol(coastNow) : v.assets >= fire - tol(fire);

    const base = {};
    for (const p of partners(v)) base[p] = partnerBase(v, p);
    const start = contribAt(v, fullPlanOf(v), v.age); // yearly saving before anyone coasts

    const earliest = { both: n > 0 ? earliestCoast(v, "both", fire, r) : { age: null, years: 0, best: v.assets } };
    if (v.two && n > 0) { earliest.A = earliestCoast(v, "A", fire, r); earliest.B = earliestCoast(v, "B", fire, r); }

    const fullBalance = n > 0 ? balanceAtRet(v, fullPlanOf(v), r) : v.assets;

    // Yearly total, saved the whole way, that reaches the FIRE number by retirement.
    let requiredAnnual = null;
    if (n > 0) requiredAnnual = (fire - v.assets * Math.pow(1 + r, n)) / annuityFactor(r, n);

    // Balance at retirement for each whole age you could both stop (the sparkline).
    const sweep = [];
    for (let c = v.age; c <= v.retAge && n > 0; c++) {
      const o = {};
      for (const p of partners(v)) o[p] = { on: true, age: c };
      sweep.push({ age: c, balance: balanceAtRet(v, planOf(v, o), r) });
    }

    // Never coast: the age full-pace saving first reaches the FIRE number (may be after retAge).
    const neverCoast = neverCoastAge(v, fire, r);
    // Other ways out when nothing works: retire later, or spend less. "Retire later" is the
    // never-coast age (the same full-saving recurrence), so the nudge and the tile always agree.
    const retireLater = n > 0 && earliest.both.age === null && neverCoast.wholeAge !== null && neverCoast.wholeAge > v.retAge
      ? neverCoast.wholeAge : null;
    const spendWithin = fullBalance * v.swr / 100;

    const headline = [fire, coastNow, balance, noContribAtRet, fullBalance];
    if (requiredAnnual !== null) headline.push(requiredAnnual);
    if (headline.some((x) => !Number.isFinite(x))) warnings.push("tooLarge");

    return {
      inputs: v, hsaClamped: san.hsaClamped, r, years: n, fire, coastNow, reached, plan,
      points, balanceAtRet: balance, surplus: balance - fire, noContribAtRet, crossAge,
      base, start, earliest, fullBalance, requiredAnnual, sweep, retireLater, spendWithin, neverCoast,
      firstCoast: firstCoastAge(plan), warnings,
    };
  }

  // ---------- what-if grid (heatmap) ----------

  const GRID_SWR = Object.freeze([3, 3.5, 4, 4.5, 5]);

  /** Earliest both-coast age for returns around the input (rows) and withdrawal rates 3-5% (columns). */
  function grid(inputs) {
    const v = sanitize(inputs).values;
    const rows = [2, 1, 0, -1, -2].map((d) => +(v.nominal + d).toFixed(2));
    return {
      rows, cols: GRID_SWR.slice(),
      cells: rows.map((nom) => GRID_SWR.map((w) => {
        const r = realReturn(nom / 100, v.inflation / 100);
        const fire = fireNumber(v.spend, w / 100);
        const e = v.retAge > v.age ? earliestCoast(v, "both", fire, r) : { age: null, best: v.assets };
        return {
          nominal: nom, swr: w, age: e.age, years: e.age === null ? 0 : v.retAge - e.age,
          pctOfFire: e.age === null ? (fire > 0 ? e.best / fire : 1) : null,
        };
      })),
    };
  }

  // ---------- 72(t) and the Roth conversion ladder ----------

  /** Life expectancy from the Single Life Table (ages 30-60), or null outside it. */
  function lifeExpectancy(age) {
    const a = Math.floor(age);
    return Object.prototype.hasOwnProperty.call(SINGLE_LIFE, a) ? SINGLE_LIFE[a] : null;
  }

  /**
   * 72(t) fixed amortization: the level yearly payment that uses up `balance`
   * over the life expectancy at `rate` (decimal). Notice 2022-6 caps the rate at
   * the greater of 5% or 120% of the federal mid-term rate (see SEP_RATE_FLOOR).
   */
  function sepPayment(balance, rate, le) {
    if (!(le > 0)) return 0;
    if (Math.abs(rate) < 1e-12) return balance / le;
    return balance * rate / (1 - Math.pow(1 + rate, -le));
  }

  /** Payments must run for the longer of 5 years or until 59½. */
  function sepLockEnd(startAge) { return Math.max(startAge + 5, 59.5); }

  // Notice 2022-6: the rate may not exceed the greater of 5% or 120% of the federal
  // mid-term rate for either of the two months before the first payment. Above 5%
  // the bridge warns ("rateOverCap"): it is only allowed when 120% of the AFR is higher.
  const SEP_RATE_FLOOR = 5;

  const SEASON = 5; // a conversion's principal can be taken out penalty-free 5 years later

  /**
   * Year-by-year early-access plan from retirement to 59½, in today's dollars.
   *  - Pre-tax money at retirement = portfolio x preShare. sepShare of it goes to
   *    a separate IRA for 72(t); the rest feeds the Roth ladder. Separate pots,
   *    so no dollar is counted twice.
   *  - 72(t) pays a fixed nominal amount, so in today's dollars it shrinks with
   *    inflation every year.
   *  - A ladder rung is converted each year (from `lead` years before retiring),
   *    sized so that after 5 years of inflation it covers that year's spending
   *    not met by 72(t). It becomes usable 5 years later.
   *  - Each year: 72(t) first (it must be taken; any extra is kept as cash), then
   *    taxable/cash, then Roth contribution basis, then ripe ladder money.
   *    Anything still missing is a gap.
   */
  function bridge(inputs, res) {
    const v = sanitize(inputs).values;
    res = res || project(v);
    const R = v.retAge;
    if (R >= 59.5) return { applies: false, reason: "notEarly" };
    if (R <= v.age) return { applies: false, reason: "badAges" };
    const le = lifeExpectancy(R);
    if (le === null) return { applies: false, reason: "tooYoung" };
    const r = res.r, pi = v.inflation / 100, rate = v.sepRate / 100;
    const P = Math.max(0, res.balanceAtRet);
    const preTax = P * v.preShare / 100;
    const pot72 = preTax * v.sepShare / 100;
    const potLadder = preTax - pot72;
    const pay0 = sepPayment(pot72, rate, le);               // first year, today's dollars
    const payNominal = pay0 * Math.pow(1 + pi, R - v.age);  // the fixed amount, in dollars of the year you retire
    const lockEnd = sepLockEnd(R);
    const inflate = Math.pow(1 + pi, SEASON);

    // Bridge years: R, R+1, ... while under 59½; the last one may be half a year.
    const years = [];
    for (let a = R; a < 59.5; a++) {
      const frac = Math.min(1, 59.5 - a);
      years.push({ age: a, frac, need: v.spend * frac, p72: pay0 / Math.pow(1 + pi, a - R) * frac });
    }

    // Ladder conversions: one rung for each year that can ripen inside the bridge.
    // Rungs converted before retiring come out of the pot as it stands at retirement
    // (at what that money would have grown to).
    const conversions = [];
    const ripe = {};
    let pot = potLadder;
    for (let ca = R - v.lead; ca + SEASON < 59.5; ca++) {
      if (ca > R) pot *= 1 + r; // the pot keeps growing after retirement
      const target = years.find((y) => y.age === ca + SEASON);
      if (!target) continue;
      const want = Math.max(0, target.need - target.p72) * inflate;
      const grow = ca < R ? Math.pow(1 + r, R - ca) : 1;
      const take = Math.min(pot, want * grow);
      pot -= take;
      const amount = take / grow;
      if (amount > 0) {
        conversions.push({ age: ca, amount, usableAge: ca + SEASON });
        ripe[ca + SEASON] = amount / inflate;
      }
    }

    // Spend each year in order.
    let cash = v.taxable, basis = v.basis, ladder = 0, totalShort = 0;
    const gapYears = [];
    for (const y of years) {
      ladder += ripe[y.age] || 0;
      y.ladderRipe = ripe[y.age] || 0;
      let left = y.need;
      y.use72 = Math.min(y.p72, left); left -= y.use72;
      cash += y.p72 - y.use72; // a 72(t) payment above spending is kept as cash
      y.taxable = Math.min(cash, left); cash -= y.taxable; left -= y.taxable;
      y.basis = Math.min(basis, left); basis -= y.basis; left -= y.basis;
      y.ladder = Math.min(ladder, left); ladder -= y.ladder; left -= y.ladder;
      y.short = left > 0.5 ? left : 0;
      if (y.short) { totalShort += y.short; gapYears.push(y.age); }
    }
    const warnings = [];
    if (v.basis + v.taxable > P - preTax + 0.5) warnings.push("accessibleOverNonPreTax");
    if (lockEnd > 59.5) warnings.push("lockPast59");
    if (v.sepRate > SEP_RATE_FLOOR + 1e-9) warnings.push("rateOverCap");
    const coverPay = sepPayment(preTax, rate, le);
    return {
      applies: true, retAge: R, le, rate, portfolio: P, preTax, pot72, potLadder, pay0, payNominal,
      lockEnd, firstLadderAge: conversions.length ? conversions[0].usableAge : null,
      conversions, years, gapYears, totalShort, warnings,
      // The 72(t) share whose first payment would cover all spending (the "Size it" button).
      shareToCover: coverPay > 0 ? Math.min(100, Math.ceil(v.spend / coverPay * 100)) : 100,
    };
  }

  /** Roth IRA contributions you'd add by retirement under the plan (a guide to the basis). */
  function rothBasisEstimate(inputs) {
    const v = sanitize(inputs).values;
    const plan = planOf(v);
    let sum = 0;
    for (let a = v.age; a < v.retAge; a++) sum += contribAt(v, plan, a).roth;
    return sum;
  }

  // ---------- buying a home: rent vs buy (SPEC 11) ----------
  // Renting is the plan as entered (project(), untouched). Buying is the same plan with the
  // purchase at age b and the yearly difference in housing cost flowing through saving.
  // All real (today's dollars); the mortgage payment is fixed in dollars of the purchase year,
  // so it shrinks by (1 + inflation) a year. Home equity is never part of the FIRE portfolio.

  const PMI_END = 0.78; // Homeowners Protection Act: PMI ends at a scheduled 78% of the original value

  /** Monthly payment on a fixed-rate loan: L·m / (1 − (1 + m)^−N); m = 0 → L / N; no loan → 0. */
  function mortgagePayment(loan, annualRate, years) {
    if (!(loan > 0) || !(years > 0)) return 0;
    const m = annualRate / 12, N = 12 * years;
    if (Math.abs(m) < 1e-12) return loan / N;
    return loan * m / (1 - Math.pow(1 + m, -N));
  }

  /** Scheduled balance after t monthly payments (same dollars as the loan); 0 once paid off. */
  function loanBalance(loan, annualRate, years, t) {
    if (!(loan > 0) || t >= 12 * years) return 0;
    if (t <= 0) return loan;
    const m = annualRate / 12, pmt = mortgagePayment(loan, annualRate, years);
    if (Math.abs(m) < 1e-12) return Math.max(0, loan - pmt * t);
    const g = Math.pow(1 + m, t);
    return Math.max(0, loan * g - pmt * (g - 1) / m);
  }

  /**
   * Everything about the home that doesn't depend on the portfolio, as functions of age.
   * `over` replaces inputs (the breakeven solvers vary apprec and mortRate).
   */
  function homeTerms(v, r, over) {
    const o = over ? { ...v, ...over } : v;
    const P = o.price, pi = o.inflation / 100, g = o.apprec / 100, rho = o.rentGrowth / 100;
    const b = Math.max(o.buyAge, o.age), term = o.term, rate = o.mortRate / 100;
    const D = P * o.downPct / 100, L = Math.max(0, P - D), K = P * o.closePct / 100;
    const pmt = mortgagePayment(L, rate, term);
    const pmiOn = o.downPct < 20 && L > 0;
    const swr = Math.max(o.swr / 100, 0.001);
    const defl = (j) => Math.pow(1 + pi, j);
    const value = (a) => P * Math.pow(1 + g, a - b);
    const sched = (j) => loanBalance(L, rate, term, 12 * j);       // purchase-year dollars
    const loanAt = (a) => (a < b ? 0 : sched(a - b) / defl(a - b)); // today's dollars
    const rentAt = (a) => 12 * o.rent * Math.pow(1 + rho, a - o.age);
    // Months of year j with PMI: those starting above 78% of the price (pro-rated in the year it ends).
    const thr = PMI_END * P + 1e-9;
    function pmiMonths(j) {
      if (!(sched(j) > thr)) return 0;
      if (sched(j + 1) > thr) return 12;
      let k = 1;
      while (k < 12 && loanBalance(L, rate, term, 12 * j + k) > thr) k++;
      return k;
    }
    function ownAt(a) {
      const j = a - b, V = value(a);
      const pAndI = j < term ? 12 * pmt / defl(j) : 0;
      const tax = o.propTax / 100 * V, ins = o.insure, maint = o.maint / 100 * V;
      const pmi = pmiOn ? o.pmi / 100 * L / defl(j) * pmiMonths(j) / 12 : 0;
      return { pi: pAndI, tax, ins, maint, pmi, total: pAndI + tax + ins + maint + pmi };
    }
    const delta = (a) => (a < b ? 0 : ownAt(a).total - rentAt(a)); // + = owning costs more
    // Mortgage payments still to come at age a, as a lump in today's dollars (discounted at r).
    function mortLeft(a) {
      let s = 0;
      for (let j = Math.max(0, a - b); j < term; j++) s += 12 * pmt / defl(j) / Math.pow(1 + r, j - (a - b) + 1);
      return s;
    }
    // FIRE numbers at age a. Retirement spending includes today's rent (SPEC 11.3).
    const fireRent = (a) => Math.max(0, o.spend + rentAt(a) - 12 * o.rent) / swr;
    const fireOwn = (a) => {
      if (a < b) return fireRent(a);
      const V = value(a);
      const carry = o.propTax / 100 * V + o.insure + o.maint / 100 * V;
      return Math.max(0, o.spend - 12 * o.rent + carry) / swr + mortLeft(a);
    };
    return {
      P, D, L, K, cash: D + K, b, term, pmt, pmiOn, fromInvested: !!o.downFrom, sellPct: o.sellPct / 100,
      value, loanAt, rentAt, ownAt, delta, mortLeft, fireRent, fireOwn, sched, pmiMonths,
    };
  }

  /**
   * The buying path: the same plan with the purchase at b and housing deltas added to (or
   * taken from) saving. Contributions floor at 0 (the rest is a deficit, assumed paid from pay).
   * `full`: never coast and no draw (the FI-age search), running to `end`.
   * Each point's `balance` is at the start of that age; at b, `post` is the balance just after
   * the cash at closing leaves (when it comes from invested assets).
   */
  function buyPath(v, plan, r, T, end, full) {
    const first = full ? Infinity : firstCoastAge(plan);
    const pts = [];
    let B = v.assets, short = 0;
    for (let a = v.age; a <= end; a++) {
      const p = { age: a, balance: B };
      if (a === T.b && T.fromInvested) {
        short = Math.max(0, T.cash - B);
        B = Math.max(0, B - T.cash);
        p.post = B;
      }
      if (a < end) {
        const C = contribAt(v, plan, a).total, d = T.delta(a);
        p.contrib = Math.max(0, C - d);
        p.deficit = Math.max(0, d - C);
        p.draw = !full && a < v.retAge && a >= first ? v.draw : 0;
        B = Math.max(0, B * (1 + r) + p.contrib - p.draw);
      }
      pts.push(p);
    }
    return { points: pts, short };
  }

  /**
   * First age a path's balance meets a target that can change with age, interpolating the gap
   * linearly between the two year-ends around the crossing (as neverCoastAge does). At the
   * purchase age the balance after closing counts.
   */
  function firstReach(points, target) {
    let prev = null;
    for (const p of points) {
      const t = target(p.age), gap = (p.post !== undefined ? p.post : p.balance) - t;
      if (gap >= -1e-9 * Math.max(1, Math.abs(t))) {
        const age = prev === null || gap <= prev ? p.age : p.age - 1 + Math.min(1, Math.max(0, -prev / (gap - prev)));
        return { age, wholeAge: p.age };
      }
      prev = gap;
    }
    return { age: null, wholeAge: null };
  }

  /** Net worth at R on each side, everything else as entered. */
  function netWorths(v, res, T) {
    const R = v.retAge;
    const run = buyPath(v, planOf(v), res.r, T, R);
    const port = run.points[run.points.length - 1].balance;
    const value = T.value(R), loanLeft = T.loanAt(R);
    // Down payment from a separate cash fund: the renter keeps that cash invested (net worth only).
    const credited = T.fromInvested ? 0 : T.cash * Math.pow(1 + res.r, R - T.b);
    // Cash short at closing: the home was bought with money the portfolio didn't have, so the
    // gap is carried as a debt growing at r to R (SPEC 11.2), not counted as a gift.
    const shortDebt = run.short > 0.5 ? run.short * Math.pow(1 + res.r, R - T.b) : 0;
    return {
      run, buyPortfolio: port, value, loanLeft, homeNet: value * (1 - T.sellPct) - loanLeft, shortDebt,
      buy: port + value * (1 - T.sellPct) - loanLeft - shortDebt, rent: res.balanceAtRet + credited, credited,
    };
  }

  /** Bisection for where f (net worth buying − renting at R) crosses 0 on [lo, hi]. */
  function tie(f, lo, hi) {
    const flo = f(lo), fhi = f(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return { value: null, side: null };
    if ((flo >= 0) === (fhi >= 0)) return { value: null, side: flo >= 0 ? "buy" : "rent" };
    let a = lo, b = hi, fa = flo;
    for (let i = 0; i < 80; i++) {
      const m = (a + b) / 2, fm = f(m);
      if ((fm >= 0) === (fa >= 0)) { a = m; fa = fm; } else b = m;
    }
    return { value: (a + b) / 2, side: null };
  }

  /**
   * Rent vs buy (SPEC 11). {applies: false, reason} when off or not modeled ("off", "badAges",
   * "buyAfterRet", "noPrice"); otherwise the comparison. Never changes project()'s result.
   */
  function house(inputs, res) {
    const v = sanitize(inputs).values;
    res = res || project(v);
    if (!v.houseOn) return { applies: false, reason: "off", warnings: [] };
    if (v.retAge <= v.age) return { applies: false, reason: "badAges", warnings: [] };
    if (v.buyAge >= v.retAge) return { applies: false, reason: "buyAfterRet", warnings: ["buyAfterRet"] };
    if (!(v.price > 0)) return { applies: false, reason: "noPrice", warnings: ["noPrice"] };
    const r = res.r, R = v.retAge, T = homeTerms(v, r), b = T.b;
    const near0 = (x) => 1e-9 * Math.max(1, Math.abs(x));

    // The plan as entered, buying; and net worth at R on both sides.
    const nw = netWorths(v, res, T);
    const short = nw.run.short;
    const points = nw.run.points.map((p) => {
      const a = p.age, owns = a >= b;
      return {
        ...p, rent: T.rentAt(a), own: owns ? T.ownAt(a).total : null, delta: T.delta(a),
        value: owns ? T.value(a) : 0, loan: T.loanAt(a),
        equity: owns ? T.value(a) - T.loanAt(a) : 0,
        equityNet: owns ? T.value(a) * (1 - T.sellPct) - T.loanAt(a) : 0,
      };
    });

    const fireRent = T.fireRent(R), fireOwn = T.fireOwn(R);

    // FI age: never coast, full saving, working past R if needed; each against its own FIRE number.
    const top = Math.max(v.age, v.retAge, NEVER_COAST_MAX_AGE);
    const fiRent = firstReach(res.neverCoast.points, T.fireRent);
    // Buying: the first age the household is FI and stays FI through the purchase. A renter's FI
    // before b doesn't count if closing then drops the portfolio below FIRE_own, so the search
    // restarts at the last point up to b (the balance after closing at b) that is below target.
    const fullBuy = buyPath(v, fullPlanOf(v), r, T, top, true).points;
    let restart = 0;
    fullBuy.forEach((p, i) => {
      const t = T.fireOwn(p.age), bal = p.post !== undefined ? p.post : p.balance;
      if (p.age <= b && bal - t < -1e-9 * Math.max(1, Math.abs(t))) restart = i;
    });
    const fiBuy = firstReach(fullBuy.slice(restart), T.fireOwn);

    // Meets the coast line. Buying: the balance at k that, with no base saving from k (housing
    // deltas and the purchase only, no draw), grows into FIRE_own by R. It is affine in the
    // starting balance, so one zero-start run per age gives it (no floor at 0).
    function zeroStart(k) {
      let B = 0;
      for (let a = k; a < R; a++) {
        if (a === b && T.fromInvested) B -= T.cash;
        B = B * (1 + r) + Math.max(0, -T.delta(a));
      }
      return B;
    }
    const coastBuy = (k) => (fireOwn - zeroStart(k)) / Math.pow(1 + r, R - k);
    const coastRent = (k) => fireRent / Math.pow(1 + r, R - k);
    let crossBuy = null, crossRent = null;
    for (const p of points) {
      const cb = coastBuy(p.age), cr = coastRent(p.age);
      if (crossBuy === null && p.balance >= cb - near0(cb)) crossBuy = p.age;
      if (crossRent === null && res.points[p.age - v.age].balance >= cr - near0(cr)) crossRent = p.age;
    }

    // Earliest age both could coast, each side against its own FIRE number.
    function earliestBuy() {
      const tol = 1e-6 * Math.max(1, fireOwn);
      const make = (c) => { const o = {}; for (const p of partners(v)) o[p] = { on: true, age: c }; return planOf(v, o); };
      const end = (c) => { const pts = buyPath(v, make(c), r, T, R).points; return pts[pts.length - 1].balance; };
      for (let c = v.age; c <= R; c++) if (end(c) >= fireOwn - tol) return { age: c, years: R - c };
      return { age: null, years: 0, best: end(R) };
    }
    const earliest = { rent: earliestCoast(v, "both", fireRent, r), buy: earliestBuy() };

    // Breakevens: the home growth and the mortgage rate at which net worth at R ties.
    const nwDiff = (over) => { const n = netWorths(v, res, homeTerms(v, r, over)); return n.buy - n.rent; };
    const growth = tie((g) => nwDiff({ apprec: g }), -10, 10);
    const rateTie = tie((i) => -nwDiff({ mortRate: i }), 0, 20); // negated: buying gets worse as the rate rises
    const rate = { value: rateTie.value, side: rateTie.side === null ? null : rateTie.side === "buy" ? "rent" : "buy" };

    // Cash flow while owning, before R.
    let yearsCostMore = 0, yearsShort = 0, totalDeficit = 0;
    for (const p of points) {
      if (p.age < b || p.age >= R) continue;
      if (p.delta > 0.005) yearsCostMore++;
      if (p.deficit > 0.5) { yearsShort++; totalDeficit += p.deficit; }
    }
    // Cash short at closing: the first whole age from b at which the renting plan holds enough.
    let afford = null;
    if (short > 0.5) for (let a = b; a < R; a++) if (res.points[a - v.age].balance >= T.cash) { afford = a; break; }
    // The first year PMI is no longer charged (null when there is none).
    let pmiEnds = null;
    if (T.pmiOn && v.pmi > 0) for (let j = 0; j <= T.term; j++) if (T.sched(j) <= PMI_END * T.P + 1e-9) { pmiEnds = b + j; break; }

    const first = T.ownAt(b), rentFirst = T.rentAt(b);
    const warnings = [];
    if (v.buyAge <= v.age) warnings.push("buyNow");
    if (short > 0.5) warnings.push("cashShort");
    if (yearsShort) warnings.push("deficit");
    if (![fireOwn, nw.buy, nw.rent].every(Number.isFinite)) warnings.push("tooLarge");
    return {
      applies: true, b, price: T.P, down: T.D, loan: T.L, closing: T.K, cash: T.cash, fromInvested: T.fromInvested,
      payment: T.pmt, // monthly P&I, in dollars of the purchase year (= today's dollars then)
      first: {
        pi: first.pi / 12, tax: first.tax / 12, ins: first.ins / 12, maint: first.maint / 12, pmi: first.pmi / 12,
        total: first.total / 12, rent: rentFirst / 12, diff: (first.total - rentFirst) / 12,
      },
      pmiEnds,
      fire: { rent: fireRent, own: fireOwn, mortLeft: T.mortLeft(R) },
      fi: { rent: fiRent, buy: fiBuy }, cross: { rent: crossRent, buy: crossBuy }, earliest,
      atRet: {
        rentPortfolio: res.balanceAtRet, buyPortfolio: nw.buyPortfolio, rentNW: nw.rent, buyNW: nw.buy,
        value: nw.value, loanLeft: nw.loanLeft, homeNet: nw.homeNet, credited: nw.credited, shortDebt: nw.shortDebt,
      },
      breakeven: { growth, rate },
      yearsCostMore, yearsShort, totalDeficit, cashShort: short > 0.5 ? short : 0, afford, points, warnings,
    };
  }

  // ---------- sliders ----------

  const SLIDER_STEPS = 1000;

  /** Round a slider amount to a "nice" step: the field's step, or about 2 significant digits for big amounts. */
  function niceRound(v, step) {
    if (!(v > 0)) return 0;
    const coarse = 0.5 * Math.pow(10, Math.floor(Math.log10(v)) - 1);
    const s = Math.max(step, coarse);
    return +(Math.round(v / s) * s).toFixed(4);
  }

  /** Slider position -> value. Curved fields: value = min + span x t^2. `hi` overrides the slider max (HSA). */
  function sliderToValue(key, pos, hi) {
    const f = FIELDS[key], top = hi === undefined ? f.sMax : hi;
    if (!f.curve) return cleanField(key, pos).value;
    const t = Math.min(1, Math.max(0, Number(pos) / SLIDER_STEPS || 0));
    if (t >= 1) return top; // the end of the track is exactly the limit
    const raw = f.sMin + (top - f.sMin) * t * t;
    return Math.min(top, Math.max(f.sMin, niceRound(raw, f.step)));
  }

  /** Value -> slider position (pinned to the ends when outside the slider's range). */
  function valueToSlider(key, value, hi) {
    const f = FIELDS[key], top = hi === undefined ? f.sMax : hi;
    if (!f.curve) return Math.min(f.sMax, Math.max(f.sMin, value));
    const u = (Math.min(top, Math.max(f.sMin, value)) - f.sMin) / ((top - f.sMin) || 1);
    return Math.round(Math.sqrt(u) * SLIDER_STEPS);
  }

  // ---------- formatting ----------

  /** $1,234,567 style; non-finite numbers become "Too large to show". */
  function fmtMoney(x) {
    if (!Number.isFinite(x)) return "Too large to show";
    const v = Math.round(x);
    return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US");
  }

  /** $1.5M / $635K / $1.2T style. `digits`: decimals for millions and up (default 1). */
  function fmtCompact(x, digits) {
    if (!Number.isFinite(x)) return "Too large to show";
    const sign = x < 0 ? "-" : "";
    const a = Math.abs(x);
    const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    if (a >= 1e15) return sign + "$" + a.toExponential(1).replace("e+", "e");
    for (let u = units.length - 1; u >= 0; u--) {
      // Use the biggest unit the value reaches; 999,600 counts as a million.
      const [size, suffix] = units[u];
      if (a < size * 0.9995) break;
      if (u > 0 && a >= units[u - 1][0] * 0.9995) continue;
      const q = a / size;
      const d = digits && size >= 1e6 ? digits : 1;
      const k = Math.pow(10, d), qr = Math.round(q * k + 1e-9) / k; // 1.775 -> 1.78, not 1.77
      const txt = q >= 100 ? String(Math.round(q)) : String(qr);
      return sign + "$" + txt + suffix;
    }
    return sign + "$" + Math.round(a);
  }

  // ---------- shareable hash ----------

  /** Inputs -> "a=42&r=65&..." (no leading #). Only the given values, in a fixed order. */
  function encodeHash(values) {
    return KEYS.filter((k) => values[k] !== undefined)
      .map((k) => HASH_KEYS[k] + "=" + encodeURIComponent(String(+(+values[k]).toFixed(4))))
      .join("&");
  }

  /** "#a=42&r=65..." (or long names, "#age=42") -> {age: 42, ...}; unknown or bad keys are ignored. */
  function decodeHash(hash) {
    const out = {};
    const s = String(hash || "").replace(/^#/, "");
    if (!s) return out;
    const byShort = {};
    for (const k of KEYS) { byShort[HASH_KEYS[k]] = k; byShort[k.toLowerCase()] = k; }
    for (const part of s.split("&")) {
      const eq = part.indexOf("=");
      if (eq < 1) continue;
      let name, val;
      try { name = decodeURIComponent(part.slice(0, eq)).toLowerCase(); val = decodeURIComponent(part.slice(eq + 1)); }
      catch (e) { continue; }
      const key = byShort[name];
      if (!key) continue;
      const c = cleanField(key, val);
      if (c.ok) out[key] = c.value;
    }
    return out;
  }

  const api = {
    LIMITS, SINGLE_LIFE, DEFAULTS, FIELDS, KEYS, HASH_KEYS, SLIDER_STEPS, GRID_SWR, SEASON, SEP_RATE_FLOOR,
    NEVER_COAST_MAX_AGE,
    realReturn, fireNumber, coastNumber, annuityFactor, hsaLimit, parseNumber, cleanField, sanitize,
    partnerBase, planOf, fullPlanOf, contribAt, path, balanceAtRet, earliestCoast, neverCoastAge, project, grid,
    lifeExpectancy, sepPayment, sepLockEnd, bridge, rothBasisEstimate,
    PMI_END, mortgagePayment, loanBalance, homeTerms, buyPath, firstReach, house,
    fmtMoney, fmtCompact, encodeHash, decodeHash, sliderToValue, valueToSlider, niceRound,
  };
  root.CoastFire = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
