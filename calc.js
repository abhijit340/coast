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
    // Suggestions (SPEC 12): the goal (0 picked from the plan, 1 retire by R, 2 coast by X,
    // 3 as early as possible), its age (X, or the target FI age T), and taxable saving.
    goal: 0, goalAge: 55, taxSave: 0,
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
    goal:      { choice: [0, 1, 2, 3] },                                    // anything else cleans to 0
    goalAge:   { min: 0,   max: 120,  sMin: 18, sMax: 85,      step: 1,    int: true },
    taxSave:   { min: 0,   max: 1e8,  sMin: 0,  sMax: 50000,   step: 100,  curve: true, money: true },
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
    goal: "go", goalAge: "gx", taxSave: "o",
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
    if (f.choice) return { value: f.choice.includes(n) ? n : fb, ok: true };
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
    const out = { k401: 0, employer: 0, roth: 0, hsa: 0, taxable: 0, byPartner: {} };
    const ps = partners(v);
    for (const p of ps) {
      const b = partnerBase(v, p), f = factorAt(plan[p], age);
      out.k401 += b.k401 * f; out.employer += b.employer * f; out.roth += b.roth * f;
      out.byPartner[p] = b.total * f;
      // Other investing (taxable): split evenly, each half follows its partner (like a self-only HSA).
      out.taxable += (v.taxSave || 0) / ps.length * f;
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
    out.total = out.k401 + out.employer + out.roth + out.hsa + out.taxable;
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

  /**
   * FI age buying: never coast, full saving, working past R if needed, against FIRE_own. The
   * household must be FI and stay FI through the purchase: a renter's FI before b doesn't count if
   * closing then drops the portfolio below FIRE_own, so the search restarts at the last point up
   * to b (the balance after closing at b) that is below target. -> {age, wholeAge, points, top}
   */
  function fiBuy(v, T, r) {
    const top = Math.max(v.age, v.retAge, NEVER_COAST_MAX_AGE);
    const points = buyPath(v, fullPlanOf(v), r, T, top, true).points;
    let restart = 0;
    points.forEach((p, i) => {
      const t = T.fireOwn(p.age), bal = p.post !== undefined ? p.post : p.balance;
      if (p.age <= T.b && bal - t < -1e-9 * Math.max(1, Math.abs(t))) restart = i;
    });
    const f = firstReach(points.slice(restart), T.fireOwn);
    return { age: f.age, wholeAge: f.wholeAge, points, top };
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
    const fiRent = firstReach(res.neverCoast.points, T.fireRent);
    const fb = fiBuy(v, T, r);
    const fiBuyAge = { age: fb.age, wholeAge: fb.wholeAge };

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
      fi: { rent: fiRent, buy: fiBuyAge }, cross: { rent: crossRent, buy: crossBuy }, earliest,
      atRet: {
        rentPortfolio: res.balanceAtRet, buyPortfolio: nw.buyPortfolio, rentNW: nw.rent, buyNW: nw.buy,
        value: nw.value, loanLeft: nw.loanLeft, homeNet: nw.homeNet, credited: nw.credited, shortDebt: nw.shortDebt,
      },
      breakeven: { growth, rate },
      yearsCostMore, yearsShort, totalDeficit, cashShort: short > 0.5 ? short : 0, afford, points, warnings,
    };
  }

  // ---------- suggestions: ways to reach a goal (SPEC 12) ----------
  // For a goal (retire by R, coast by X, or FI by a target age T), each lever is solved for the
  // smallest change that meets it, on the same projections as everything else. Educational
  // estimates from this model, not advice: every account earns the same return and no taxes.

  const YEAR_EFFORT = 0.04;    // one more year (working, buying later) counts like 4% of pay
  const COMBO_TAU = 0.15;      // above this effort for the best single step, try two smaller ones
  // Plausible range (SPEC 12.2): beyond these a lever goes to "Not on its own", never a card.
  const RET_MAX = 80;          // retiring later than this isn't offered
  const SPEND_FLOOR = 10000;   // retirement spending below max($10K, 25% of the plan) isn't offered
  const CUT_FLOOR = 0.25;      // nor a home below 25% of the price
  const LEVER_ORDER = Object.freeze(["save", "coastBoth", "coastA", "coastB", "spend", "drawLess", "retLater",
    "price", "buyLater", "down", "noBuy"]);
  const SIZE_STEPS = Object.freeze([[0.05, "small"], [0.15, "medium"], [0.30, "big"], [Infinity, "veryBig"]]);
  function sizeOf(e) { for (const [lim, name] of SIZE_STEPS) if (e <= lim) return name; return "veryBig"; }

  /**
   * The goal the suggestions aim at. goal 0 picks from the plan: "coast by X" when every partner's
   * coast switch is on at the same age X before R, otherwise "retire by R" (the plan as entered,
   * coast switches included). Coasting at R is the same as retiring (coerced "xIsR").
   */
  function goalOf(v) {
    const R = v.retAge, ps = partners(v);
    const out = { type: "retire", X: null, T: null, inferred: v.goal === 0 };
    if (v.goal === 0) {
      const ages = ps.filter((p) => v["coastOn" + p]).map((p) => Math.max(v["coastAge" + p], v.age));
      if (ages.length === ps.length && ages.every((a) => a === ages[0]) && ages[0] < R) { out.type = "coast"; out.X = ages[0]; }
    } else if (v.goal === 2) {
      const X = Math.min(R, Math.max(v.age, v.goalAge));
      if (X >= R) out.coerced = "xIsR"; else { out.type = "coast"; out.X = X; }
    } else if (v.goal === 3) {
      out.type = "early"; out.T = Math.max(v.age, v.goalAge);
    }
    return out;
  }

  /** The coast plan a goal judges: as entered (retire), or everyone coasting at X (`ages` overrides one). */
  function goalPlan(v, G) {
    if (G.type !== "coast") return planOf(v);
    const o = {};
    for (const p of partners(v)) o[p] = { on: true, age: G.ages && G.ages[p] !== undefined ? G.ages[p] : G.X };
    return planOf(v, o);
  }

  /** Whether the home comparison runs for these inputs (house() would apply). */
  function houseApplies(v) { return !!v.houseOn && v.retAge > v.age && v.buyAge < v.retAge && v.price > 0; }

  /**
   * Where a plan stands against a goal. ctx.scenario "buy" judges the buying path against
   * FIRE_own(R) (homeTerms rebuilt from v, so price, down payment and buy age can change).
   * -> {metric, have, need, margin, fiAge?, fiFrac?}; margin in $ (retire, coast) or whole years (early).
   */
  function measure(v, G, ctx) {
    const r = realReturn(v.nominal / 100, v.inflation / 100);
    const buy = !!ctx && ctx.scenario === "buy";
    const T = buy ? homeTerms(v, r) : null;
    const fire = fireNumber(v.spend, v.swr / 100);
    if (G.type === "early") {
      const f = buy ? fiBuy(v, T, r) : neverCoastAge(v, fire, r);
      const p = f.points[Math.min(Math.max(0, G.T - v.age), f.points.length - 1)];
      return {
        metric: "fiAge", fiAge: f.wholeAge, fiFrac: f.age,
        have: p.post !== undefined ? p.post : p.balance, need: buy ? T.fireOwn(p.age) : fire,
        margin: f.wholeAge === null ? -Infinity : G.T - f.wholeAge,
      };
    }
    const plan = goalPlan(v, G);
    let have, need;
    if (!buy) { have = balanceAtRet(v, plan, r); need = fire; }
    else {
      // Cash short at closing is carried as a debt grown at r to R (as house().atRet.shortDebt),
      // so a down payment the household doesn't have is never free.
      const run = buyPath(v, plan, r, T, v.retAge), pts = run.points;
      const shortDebt = run.short > 0.5 ? run.short * Math.pow(1 + r, v.retAge - T.b) : 0;
      have = pts[pts.length - 1].balance - shortDebt; need = T.fireOwn(v.retAge);
      if (shortDebt) return { metric: "balance", have, need, margin: have - need, cashShort: run.short, shortDebt };
    }
    return { metric: "balance", have, need, margin: have - need };
  }
  /** >= -tol means the goal is met (tol = 1e-6 x the target for $, 0 for whole years). */
  function margin(v, G, ctx) { return measure(v, G, ctx).margin; }

  /**
   * Monotone search on multiples of `step`. dir "up" (default): the smallest x >= lo with test(x)
   * true (false below, true above); `hi` is the first guess, doubled up to `cap`. dir "down": the
   * largest x in [lo, hi] with test(x) true (true below, false above). null when there is none.
   * At most 60 halvings; the answer is exact on the step grid, so x - step (up) or x + step (down) fails.
   */
  function bisect(test, lo, hi, o) {
    o = o || {};
    const step = o.step || 1, at = (k) => +(k * step).toFixed(6);
    if (o.dir === "down") {
      let a = Math.ceil(lo / step - 1e-9), b = Math.floor(hi / step + 1e-9);
      if (b < a) return null;
      if (test(at(b))) return at(b);
      if (!test(at(a))) return null;
      for (let i = 0; i < 60 && b - a > 1; i++) { const m = Math.floor((a + b) / 2); if (test(at(m))) a = m; else b = m; }
      return at(a);
    }
    const cap = o.cap === undefined ? hi : o.cap, kCap = Math.floor(cap / step + 1e-9);
    let a = Math.ceil(lo / step - 1e-9);
    if (a > kCap) return null;
    if (test(at(a))) return at(a);
    let b = Math.min(kCap, Math.max(a + 1, Math.ceil(hi / step - 1e-9)));
    for (let i = 0; i < 60 && !test(at(b)); i++) {
      if (b >= kCap) return null;
      const span = b - a; a = b; b = Math.min(kCap, b + 2 * span);
    }
    for (let i = 0; i < 60 && b - a > 1; i++) { const m = Math.floor((a + b) / 2); if (test(at(m))) b = m; else a = m; }
    return at(b);
  }

  /**
   * Whole ages from `from` toward `to` (either direction). dir "first" (default): the first age
   * that passes; "last": the last of an unbroken run of passes starting at `from`. null if none.
   */
  function scanAge(test, from, to, dir) {
    const d = to >= from ? 1 : -1;
    let last = null;
    for (let a = from; d > 0 ? a <= to : a >= to; a += d) {
      const ok = test(a);
      if (dir === "last") { if (!ok) break; last = a; } else if (ok) return a;
    }
    return dir === "last" ? last : null;
  }

  // Splits `amt` between two accounts: B gets half rounded down to $50, A the rest; overflow moves.
  function split2(amt, roomA, roomB) {
    let b = Math.floor(amt / 2 / 50) * 50, a = amt - b;
    if (a > roomA) { b += a - roomA; a = roomA; }
    if (b > roomB) { a += b - roomB; b = roomB; }
    return [a, b];
  }
  function spread(amt, rooms) { return rooms.length === 1 ? [Math.min(amt, rooms[0])] : split2(amt, rooms[0], rooms[1]); }

  // Fills accounts tier by tier; shared by allocate (add) and unallocate (take back).
  function fill(v, delta, tiers, sign) {
    const set = {}, steps = [];
    let left = Math.max(0, delta);
    for (const t of tiers) {
      const items = t.items();
      const rooms = items.map((it) => Math.max(0, it.room));
      const amt = Math.min(left, rooms.reduce((s, x) => s + x, 0));
      if (!(amt > 0)) continue;
      spread(amt, rooms).forEach((g, i) => {
        if (!(g > 0)) return;
        const it = items[i], from = v[it.key], to = from + sign * g;
        set[it.key] = to;
        if (t.spend) t.spend(it.who, g);
        steps.push({ key: it.key, who: it.who, from, to, tier: t.n, atLimit: it.limit !== undefined && to >= it.limit - 1e-9 });
      });
      left -= amt;
    }
    return { set, steps, left };
  }

  /**
   * Adds `delta` $/yr across accounts in a common, general order (SPEC 12.4): the HSA to its limit
   * (only if one is in use), Roth IRAs to the limit, 401(k)s to the limit (only with a plan), then
   * taxable. Each partner's tax-advantaged room is also capped by what is left of their own salary.
   * Employer money is never changed. -> {set, steps:[{key, who, from, to, tier, atLimit}], left}
   */
  function allocate(v, delta) {
    const ps = partners(v), head = {};
    for (const p of ps) head[p] = Math.max(0, v["sal" + p] - partnerBase(v, p).total);
    const paid = ps.filter((p) => v["sal" + p] > 0);
    const use = (who, g) => { head[who] -= g; };
    const lim = hsaLimit(v);
    return fill(v, delta, [
      { n: 1, items: () => (v.hsa > 0 ? [{ key: "hsa", who: "household", room: lim - v.hsa, limit: lim }] : []) },
      { n: 2, spend: use, items: () => paid.map((p) => ({ key: "roth" + p, who: p, room: Math.min(LIMITS.roth - v["roth" + p], head[p]), limit: LIMITS.roth })) },
      { n: 3, spend: use, items: () => paid.filter((p) => v["k" + p] > 0 || v["emp" + p] > 0)
        .map((p) => ({ key: "k" + p, who: p, room: Math.min(LIMITS.k401 - v["k" + p], head[p]), limit: LIMITS.k401 })) },
      { n: 4, items: () => [{ key: "taxSave", who: "household", room: FIELDS.taxSave.max - v.taxSave }] },
    ], 1);
  }

  /** Takes `delta` $/yr back out, in reverse: taxable, 401(k)s, Roth IRAs, then the HSA. Never employer money. */
  function unallocate(v, delta) {
    const ps = partners(v);
    return fill(v, delta, [
      { n: 4, items: () => [{ key: "taxSave", who: "household", room: v.taxSave }] },
      { n: 3, items: () => ps.filter((p) => v["k" + p] > 0).map((p) => ({ key: "k" + p, who: p, room: v["k" + p] })) },
      { n: 2, items: () => ps.filter((p) => v["roth" + p] > 0).map((p) => ({ key: "roth" + p, who: p, room: v["roth" + p] })) },
      { n: 1, items: () => (v.hsa > 0 ? [{ key: "hsa", who: "household", room: v.hsa }] : []) },
    ], -1);
  }
  function removable(v) {
    let s = v.taxSave + v.hsa;
    for (const p of partners(v)) s += v["k" + p] + v["roth" + p];
    return s;
  }

  /**
   * The suggestion engine (SPEC 12.6): where the plan stands against its goal, then the smallest
   * change to each lever that meets it (short) or the room to spare (met), ranked.
   */
  function suggest(inputs) {
    const v = sanitize(inputs).values;
    const G = goalOf(v), R = v.retAge, ps = partners(v);
    const out = {
      goal: G, scenario: "rent", status: "short", margin: 0, progress: null, list: [], rejected: [],
      sensitivity: null, best: null, inputs: v, fi: null,
    };
    if (R <= v.age) { out.status = "badAges"; return out; }
    const buy = houseApplies(v);
    const ctx = { scenario: buy ? "buy" : "rent" };
    out.scenario = ctx.scenario;
    if (buy) out.buyAge = Math.max(v.buyAge, v.age);
    const pay = ps.reduce((s, p) => s + v["sal" + p], 0);
    const yrs = R - v.age;
    const early = G.type === "early";

    // Where things stand now.
    const r0 = realReturn(v.nominal / 100, v.inflation / 100);
    const fiNow = buy ? fiBuy(v, homeTerms(v, r0), r0) : neverCoastAge(v, fireNumber(v.spend, v.swr / 100), r0);
    out.fi = { age: fiNow.age, wholeAge: fiNow.wholeAge, top: fiNow.top };
    const m0 = measure(v, G, ctx);
    const tol = early ? 0 : 1e-6 * Math.max(1, m0.need);
    const ok = (m) => m >= -tol;
    const meets = (vv, GG) => ok(margin(vv, GG || G, ctx));
    out.margin = m0.margin;
    out.progress = {
      have: m0.have, need: m0.need, pct: m0.need > 0 ? m0.have / m0.need : 1, metric: m0.metric,
      ...(early ? { fiAge: m0.fiAge, fiFrac: m0.fiFrac } : {}),
    };
    if (fiNow.wholeAge === v.age) { out.status = "fiNow"; return out; }
    const met = ok(m0.margin);
    out.status = met ? "met" : "short";

    // ----- shared pieces -----
    const curTotal = contribAt(v, fullPlanOf(v), v.age).total;
    const payOf = (vv) => partners(vv).reduce((s, p) => s + vv["sal" + p], 0);
    // The coast keys that make the plan as entered match a coast goal (not counted as parts).
    const coastKeys = (GG) => {
      if (GG.type !== "coast") return {};
      const s = {};
      for (const p of ps) { s["coastOn" + p] = 1; s["coastAge" + p] = GG.ages && GG.ages[p] !== undefined ? GG.ages[p] : GG.X; }
      return s;
    };
    // A partner's yearly saving that stops while they coast (their accounts, half the HSA and taxable).
    const lost = (vv, p) => (partnerBase(vv, p).total + vv.taxSave / ps.length + vv.hsa / ps.length) * (1 - vv["after" + p] / 100);
    function effectOf(vv, GG) {
      const m = measure(vv, GG, ctx);
      if (m.metric === "fiAge") {
        return { metric: "fiAge", before: m0.fiFrac, after: m.fiFrac, target: GG.T, fiAge: m.fiAge,
          yearsSooner: m0.fiFrac !== null && m.fiFrac !== null ? m0.fiFrac - m.fiFrac : null };
      }
      return { metric: "balance", before: m0.have, after: m.have, target: m.need };
    }
    // Under a coast goal every Apply patch also turns both coast switches on at X (SPEC 12.2), so
    // the page then judges the same plan the card was solved for. The lever's own keys win.
    const make = (vv, GG, o) => {
      const G2 = o.G2 || GG;
      const set = o.set && G2.type === "coast" ? { ...coastKeys(G2), ...o.set } : o.set;
      const s = {
        id: o.id, kind: o.kind || "fix", change: o.change, set, steps: o.steps || [],
        effect: effectOf(sanitize({ ...vv, ...set }).values, G2),
        effort: o.effort === undefined ? 0 : o.effort, parts: o.parts === undefined ? 1 : o.parts,
        feasible: o.feasible !== false, flags: o.flags || [], goal2: G2,
      };
      if (o.who) s.who = o.who;
      if (o.reason) s.reason = o.reason;
      if (o.benefit !== undefined) s.benefit = o.benefit;
      s.size = s.kind === "opportunity" ? null : sizeOf(s.effort);
      return s;
    };
    // The labels on a save-more change of d $/yr (the solo save card and a combo's partial save).
    function saveFlags(vv, steps, d) {
      const flags = [], pay2 = Math.max(1, payOf(vv));
      for (const st of steps) if (st.atLimit) flags.push({ code: "atLimit", key: st.key });
      if (steps.some((st) => st.tier === 1)) flags.push({ code: "hsaEligibility" });
      if (steps.some((st) => st.tier === 2)) flags.push({ code: "rothIncome" });
      flags.push({ code: "matchNote" });
      if (vv.age >= 50) flags.push({ code: "catchUp" });
      const share = (contribAt(vv, fullPlanOf(vv), vv.age).total + d) / pay2;
      if (share >= 0.35) flags.push({ code: "highShare", pct: share });
      if (share > 1 + 1e-9) flags.push({ code: "overPay" });
      return flags;
    }
    const bad = (id, reason, extra) => ({ id, kind: "fix", feasible: false, reason, flags: [], effort: Infinity, parts: 1,
      change: null, set: null, steps: [], effect: null, size: null, ...(extra || {}) });

    const spendFloor = (S) => Math.max(SPEND_FLOOR, CUT_FLOOR * S);
    // Cash short at closing on the buying path the goal judges (0 when the portfolio covers it).
    const cashShortAt = (vv, GG) => buyPath(vv, goalPlan(vv, GG), realReturn(vv.nominal / 100, vv.inflation / 100),
      homeTerms(vv, realReturn(vv.nominal / 100, vv.inflation / 100)), vv.retAge).short;

    // ----- levers (each works on any v / G, so the combo can reuse them) -----
    const L = {};

    L.save = (vv, GG) => {
      if ((GG.type === "coast" && GG.X <= vv.age) || (GG.type === "early" && GG.T <= vv.age)) return bad("save", "noYearsLeft");
      const pay2 = payOf(vv);
      if (!(pay2 > 0)) return bad("save", "noPay");
      const total = contribAt(vv, fullPlanOf(vv), vv.age).total;
      const test = (d) => meets({ ...vv, ...allocate(vv, d).set }, GG);
      // Closed-form first guess when it applies: retire, renting, nobody coasting.
      let guess = Math.max(1e4, pay2);
      if (GG.type === "retire" && !buy && !Number.isFinite(firstCoastAge(planOf(vv)))) {
        const n2 = vv.retAge - vv.age, rr = realReturn(vv.nominal / 100, vv.inflation / 100);
        const need = (fireNumber(vv.spend, vv.swr / 100) - vv.assets * Math.pow(1 + rr, n2)) / annuityFactor(rr, n2) - total;
        if (need > 0) guess = need;
      }
      const d = bisect(test, 100, guess, { step: 100, cap: Math.min(FIELDS.taxSave.max, 10 * Math.max(pay2, 1e4)) });
      if (d === null) return bad("save", "exceedsPay");
      const a = allocate(vv, d), flags = saveFlags(vv, a.steps, d);
      const over = flags.some((f) => f.code === "overPay");
      return make(vv, GG, {
        id: "save", change: { key: "save", from: total, to: total + d, delta: d, unit: "$/yr" },
        set: { ...a.set, ...coastKeys(GG) }, steps: a.steps, effort: d / pay2, parts: a.steps.length, flags,
        feasible: !over, reason: over ? "exceedsPay" : undefined,
      });
    };

    L.spend = (vv, GG) => {
      const S = vv.spend, test = (x) => meets({ ...vv, spend: x }, GG);
      const s = bisect(test, 0, Math.ceil(S / 100) * 100 - 100, { step: 100, dir: "down" });
      if (s === null || s >= S) return bad("spend", "belowZero");
      const cut = (S - s) / S;
      // Retiring on almost nothing "meets" any goal; below the floor it isn't offered (SPEC 12.2).
      const low = s < spendFloor(S);
      return make(vv, GG, { id: "spend", change: { key: "spend", from: S, to: s, delta: s - S, unit: "$/yr" },
        set: { spend: s }, effort: cut, flags: cut >= 0.25 ? [{ code: "bigCut", pct: cut }] : [],
        feasible: !low, reason: low ? "belowFloor" : undefined });
    };

    L.retLater = (vv, GG) => {
      if (GG.type === "early") return null;
      const top = NEVER_COAST_MAX_AGE, R0 = vv.retAge;
      const a = R0 >= top ? null : scanAge((x) => meets({ ...vv, retAge: x }, GG), R0 + 1, top);
      if (a === null) return bad("retLater", "notByTop");
      const late = a > RET_MAX;
      return make(vv, GG, { id: "retLater", change: { key: "retAge", from: R0, to: a, delta: a - R0, unit: "age" },
        set: { retAge: a }, effort: (a - R0) * YEAR_EFFORT, flags: a < 59.5 ? [{ code: "bridge" }] : [],
        feasible: !late, reason: late ? "tooLate" : undefined });
    };

    // Coasting later: everyone (coastBoth) or one partner. Under the coast goal both start at X;
    // under the retire goal only partners whose switch is on, each from their own age.
    function coastLever(vv, GG, who) {
      const ps2 = partners(vv), R0 = vv.retAge;
      const pay2 = Math.max(1, payOf(vv)), yrs2 = Math.max(1, R0 - vv.age);
      const movers = who === "both" ? ps2 : [who];
      const id = who === "both" ? "coastBoth" : "coast" + who;
      if (GG.type === "coast") {
        const from = who === "both" ? GG.X : GG.ages && GG.ages[who] !== undefined ? GG.ages[who] : GG.X;
        const G2 = (x) => (who === "both" ? { ...GG, X: x, ages: undefined } : { ...GG, ages: { ...(GG.ages || {}), [who]: x } });
        // Both coasting at R is just retiring, so everyone together stops by R - 1; one partner may save to R.
        const a = scanAge((x) => meets(vv, G2(x)), from + 1, who === "both" ? R0 - 1 : R0);
        if (a === null) return bad(id, "notByRet", { who });
        const gg = G2(a), set = coastKeys(gg);
        // Both later: the goal moves with them. One later: the plan as entered is judged from now on.
        if (vv.goal === 2) { if (who === "both") set.goalAge = a; else set.goal = 1; }
        const eff = movers.reduce((s, p) => s + (a - from) * lost(vv, p), 0) / (yrs2 * pay2);
        return make(vv, GG, { id, who, change: { key: "coastAge" + (who === "both" ? "" : who), from, to: a, delta: a - from, unit: "age" },
          set, effort: eff, G2: gg });
      }
      if (GG.type !== "retire") return null;
      if (!movers.every((p) => vv["coastOn" + p] && vv["coastAge" + p] < R0)) return null;
      const cur = {};
      for (const p of movers) cur[p] = Math.max(vv.age, vv["coastAge" + p]);
      const from = Math.min(...movers.map((p) => cur[p]));
      const patch = (x) => { const s = {}; for (const p of movers) s["coastAge" + p] = Math.max(cur[p], x); return s; };
      const a = scanAge((x) => meets({ ...vv, ...patch(x) }, GG), from + 1, R0);
      if (a === null) return bad(id, "notByRet", { who });
      const eff = movers.reduce((s, p) => s + (Math.max(cur[p], a) - cur[p]) * lost(vv, p), 0) / (yrs2 * pay2);
      return make(vv, GG, { id, who, change: { key: "coastAge" + (who === "both" ? "" : who), from, to: a, delta: a - from, unit: "age" },
        set: patch(a), effort: eff });
    }
    L.coastBoth = (vv, GG) => coastLever(vv, GG, "both");
    L.coastA = (vv, GG) => (vv.two ? coastLever(vv, GG, "A") : null);
    L.coastB = (vv, GG) => (vv.two ? coastLever(vv, GG, "B") : null);

    L.drawLess = (vv, GG) => {
      if (GG.type === "early" || !(vv.draw > 0)) return null;
      const first = firstCoastAge(goalPlan(vv, GG));
      if (!(first < vv.retAge)) return null;
      const D = vv.draw, test = (x) => meets({ ...vv, draw: x }, GG);
      const d = bisect(test, 0, Math.ceil(D / 500) * 500 - 500, { step: 500, dir: "down" });
      if (d === null || d >= D) return bad("drawLess", "belowZero");
      const cy = vv.retAge - Math.max(first, vv.age);
      return make(vv, GG, { id: "drawLess", change: { key: "draw", from: D, to: d, delta: d - D, unit: "$/yr" },
        set: { draw: d }, effort: (D - d) * cy / (Math.max(1, vv.retAge - vv.age) * Math.max(1, payOf(vv))) });
    };

    L.buyLater = (vv, GG) => {
      if (!buy) return null;
      const b = Math.max(vv.buyAge, vv.age);
      const a = scanAge((x) => meets({ ...vv, buyAge: x }, GG), b + 1, vv.retAge - 1);
      if (a === null) return bad("buyLater", "noEffect");
      return make(vv, GG, { id: "buyLater", change: { key: "buyAge", from: b, to: a, delta: a - b, unit: "age" },
        set: { buyAge: a }, effort: (a - b) * YEAR_EFFORT * 0.5 });
    };
    L.price = (vv, GG) => {
      if (!buy) return null;
      const P = vv.price, test = (x) => meets({ ...vv, price: x }, GG);
      const p = bisect(test, 1000, Math.ceil(P / 1000) * 1000 - 1000, { step: 1000, dir: "down" });
      if (p === null || p >= P) return bad("price", "noEffect");
      const low = p < CUT_FLOOR * P;
      return make(vv, GG, { id: "price", change: { key: "price", from: P, to: p, delta: p - P, unit: "$" },
        set: { price: p }, effort: (P - p) / P, feasible: !low, reason: low ? "belowFloor" : undefined });
    };
    L.down = (vv, GG) => {
      if (!buy) return null;
      const d0 = vv.downPct;
      const a = scanAge((x) => meets({ ...vv, downPct: x }, GG), Math.floor(d0) + 1, 100);
      if (a === null) return bad("down", "noEffect");
      // Paid from invested assets: a down payment the portfolio doesn't hold at b isn't offered
      // (measure already carries any shortfall as a debt, this keeps it off the cards too).
      const vv2 = sanitize({ ...vv, downPct: a }).values;
      const short = vv2.downFrom ? cashShortAt(vv2, GG) : 0;
      // Effort: the extra cash spread over the years to R, like a year's extra saving.
      const extra = vv.price * (a - d0) / 100;
      const card = make(vv, GG, { id: "down", change: { key: "downPct", from: d0, to: a, delta: a - d0, unit: "%" },
        set: { downPct: a }, effort: extra / (Math.max(1, vv.retAge - vv.age) * Math.max(1, payOf(vv))),
        feasible: !(short > 0.5), reason: short > 0.5 ? "cashShort" : undefined });
      if (short > 0.5) card.cashShort = short;
      return card;
    };
    // Renting instead: the renting plan's margin, for comparison (a fixed switch, not solved).
    L.noBuy = (vv, GG) => {
      if (!buy) return null;
      const m = measure({ ...vv, houseOn: 0 }, GG, { scenario: "rent" });
      const s = {
        id: "noBuy", kind: "fix", change: { key: "houseOn", from: 1, to: 0, delta: -1, unit: "" }, set: { ...coastKeys(GG), houseOn: 0 }, steps: [],
        effect: m.metric === "fiAge" ? { metric: "fiAge", before: m0.fiFrac, after: m.fiFrac, target: GG.T, fiAge: m.fiAge }
          : { metric: "balance", before: m0.have, after: m.have, target: m.need },
        effort: 0.5, parts: 1, feasible: ok(m.margin), flags: [], rentMargin: m.margin, size: sizeOf(0.5), goal2: GG,
      };
      if (!s.feasible) s.reason = "rentShort";
      return s;
    };

    // ----- opportunities (on track): the largest change that still meets the goal -----
    function opportunities() {
      const list = [];
      const add = (o) => list.push(make(v, G, { kind: "opportunity", ...o }));
      const retireG = { type: "retire", X: null, T: null, inferred: false };
      if (!early) {
        // Coast sooner: everyone, and the better single partner.
        const cands = [];
        if (G.type === "coast") {
          const both = scanAge((x) => meets(v, { ...G, X: x }), G.X - 1, v.age, "last");
          if (both !== null) {
            const set = coastKeys({ ...G, X: both });
            if (v.goal === 2) set.goalAge = both;
            cands.push({ id: "coastSooner", who: "both", change: { key: "coastAge", from: G.X, to: both, delta: both - G.X, unit: "age" },
              set, benefit: (G.X - both) * YEAR_EFFORT, G2: { ...G, X: both } });
          }
          if (v.two) for (const p of ps) {
            const a = scanAge((x) => meets(v, { ...G, ages: { [p]: x } }), G.X - 1, v.age, "last");
            if (a === null) continue;
            const set = coastKeys({ ...G, ages: { [p]: a } });
            if (v.goal === 2) set.goal = 1;
            cands.push({ id: "coastSooner", who: p, change: { key: "coastAge" + p, from: G.X, to: a, delta: a - G.X, unit: "age" },
              set, benefit: (G.X - a) * YEAR_EFFORT * 0.5, G2: retireG });
          }
        } else {
          const cur = {};
          for (const p of ps) cur[p] = v["coastOn" + p] && v["coastAge" + p] < R ? Math.max(v.age, v["coastAge" + p]) : R;
          const lo = Math.min(...ps.map((p) => cur[p]));
          const bothSet = (x) => { const s = {}; for (const p of ps) { s["coastOn" + p] = 1; s["coastAge" + p] = x; } return s; };
          const both = lo > v.age ? scanAge((x) => meets({ ...v, ...bothSet(x) }), v.age, lo - 1) : null;
          if (both !== null) cands.push({ id: "coastSooner", who: "both", change: { key: "coastAge", from: lo, to: both, delta: both - lo, unit: "age" },
            set: bothSet(both), benefit: (lo - both) * YEAR_EFFORT });
          if (v.two) for (const p of ps) {
            if (cur[p] <= v.age) continue;
            const one = (x) => ({ ["coastOn" + p]: 1, ["coastAge" + p]: x });
            const a = scanAge((x) => meets({ ...v, ...one(x) }), v.age, cur[p] - 1);
            if (a !== null) cands.push({ id: "coastSooner", who: p, change: { key: "coastAge" + p, from: cur[p], to: a, delta: a - cur[p], unit: "age" },
              set: one(a), benefit: (cur[p] - a) * YEAR_EFFORT * 0.5 });
          }
        }
        const bothC = cands.find((c) => c.who === "both");
        const single = cands.filter((c) => c.who !== "both").sort((a, b) => b.benefit - a.benefit)[0];
        if (bothC) add(bothC);
        if (single) add(single);
        // Retire sooner (after any coast age of the goal, and after buying).
        const floor = Math.max(v.age + 1, G.type === "coast" ? G.X + 1 : 0, buy ? Math.max(v.buyAge, v.age) + 1 : 0);
        const ra = R - 1 >= floor ? scanAge((x) => meets({ ...v, retAge: x }), R - 1, floor, "last") : null;
        if (ra !== null) add({ id: "retireSooner", change: { key: "retAge", from: R, to: ra, delta: ra - R, unit: "age" },
          set: { retAge: ra }, benefit: (R - ra) * YEAR_EFFORT, flags: ra < 59.5 ? [{ code: "bridge" }] : [] });
        // Draw more while coasting.
        const first = firstCoastAge(goalPlan(v, G));
        if (first < R) {
          const test = (x) => meets({ ...v, draw: x });
          let hi = Math.max(1000, v.draw * 2);
          while (hi < FIELDS.draw.max && test(hi)) hi = Math.min(FIELDS.draw.max, hi * 2);
          const d = bisect(test, Math.ceil(v.draw / 500) * 500, hi, { step: 500, dir: "down" });
          if (d !== null && d > v.draw) add({ id: "drawMore", change: { key: "draw", from: v.draw, to: d, delta: d - v.draw, unit: "$/yr" },
            set: { draw: d }, benefit: (d - v.draw) * (R - Math.max(first, v.age)) / (yrs * Math.max(1, pay)) });
        }
      }
      // Spend more.
      {
        const test = (x) => meets({ ...v, spend: x });
        let hi = Math.max(1000, v.spend * 2);
        while (hi < FIELDS.spend.max && test(hi)) hi = Math.min(FIELDS.spend.max, hi * 2);
        const s = bisect(test, Math.ceil(v.spend / 100) * 100, hi, { step: 100, dir: "down" });
        if (s !== null && s > v.spend) add({ id: "spendMore", change: { key: "spend", from: v.spend, to: s, delta: s - v.spend, unit: "$/yr" },
          set: { spend: s }, benefit: (s - v.spend) / Math.max(1, v.spend) });
      }
      // Save less (reverse order: taxable first, employer money never).
      {
        const all = removable(v);
        if (all > 0) {
          const test = (x) => meets({ ...v, ...unallocate(v, x).set });
          const d = test(all) ? all : bisect(test, 0, Math.floor(all / 100) * 100, { step: 100, dir: "down" });
          if (d !== null && d > 0) {
            const u = unallocate(v, d);
            add({ id: "saveLess", change: { key: "save", from: curTotal, to: curTotal - d, delta: -d, unit: "$/yr" },
              set: u.set, steps: u.steps, parts: u.steps.length, benefit: d / Math.max(1, pay) });
          }
        }
      }
      return list.sort((a, b) => b.benefit - a.benefit).slice(0, 6);
    }

    // ----- sensitivity (information only, never a suggestion) -----
    function sensitivity() {
      const o = { haveReturn: v.nominal, haveSwr: v.swr, needReturn: null, inRange: false, needSwr: null, swrInRange: false };
      const f = (patch) => margin({ ...v, ...patch }, G, ctx);
      const lo = FIELDS.nominal.min, hi = FIELDS.nominal.max, slo = FIELDS.swr.min, shi = FIELDS.swr.max;
      if (early) {
        const nr = bisect((x) => ok(f({ nominal: x })), lo, hi, { step: 0.01 });
        if (nr !== null && nr > lo) { o.needReturn = nr; o.inRange = true; }
        const ns = bisect((x) => ok(f({ swr: x })), slo, shi, { step: 0.01 });
        if (ns !== null && ns > slo) { o.needSwr = ns; o.swrInRange = true; }
      } else {
        const solve = (key, a, b) => {
          if (!(f({ [key]: a }) < 0 && f({ [key]: b }) >= 0)) return null;
          for (let i = 0; i < 80 && b - a > 1e-9; i++) { const m = (a + b) / 2; if (f({ [key]: m }) >= 0) b = m; else a = m; }
          return (a + b) / 2;
        };
        o.needReturn = solve("nominal", lo, hi);
        o.inRange = o.needReturn !== null;
        if (!buy) {
          if (m0.have > 0) { o.needSwr = v.spend / m0.have * 100; o.swrInRange = o.needSwr >= slo && o.needSwr <= shi; }
        } else {
          o.needSwr = solve("swr", slo, shi);
          o.swrInRange = o.needSwr !== null;
        }
      }
      if (met) o.cushion = o.needReturn === null ? null : v.nominal - o.needReturn;
      return o;
    }
    out.sensitivity = sensitivity();

    if (met) {
      out.list = opportunities();
      out.best = out.list[0] || null;
      return out;
    }

    // ----- short: solve every lever, rank, and maybe combine two -----
    const solved = [];
    for (const id of LEVER_ORDER) { const s = L[id](v, G); if (s) solved.push(s); }
    const feasible = solved.filter((s) => s.feasible), rejected = solved.filter((s) => !s.feasible);
    const key = (s) => [s.id === "noBuy" ? 1 : 0, s.effort, s.parts, LEVER_ORDER.indexOf(s.id)];
    const byKey = (a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; };
    feasible.sort(byKey);
    // Keep coastBoth and only the better of the single-partner coast levers.
    const singles = feasible.filter((s) => s.id === "coastA" || s.id === "coastB");
    let cards = feasible.filter((s) => s !== singles[1]).slice(0, 5);

    // Combo: two smaller steps when no single one is small enough (or none works).
    const bestEff = cards.length ? cards[0].effort : Infinity;
    if (bestEff > COMBO_TAU) {
      const pool = ["save", "spend", "retLater", "coastBoth"];
      const solo = {};
      // Levers past the plausible range (retiring after 80, spending below the floor) can still lend a smaller part.
      for (const s of solved) if (pool.includes(s.id) && s.set && s.change) solo[s.id] = s;
      const partial = (s, f) => {
        const ch = s.change;
        if (s.id === "save") {
          const d = Math.round(f * ch.delta / 100) * 100;
          if (d <= 0 || d >= ch.delta) return null;
          const a = allocate(v, d), flags = saveFlags(v, a.steps, d);
          if (flags.some((x) => x.code === "overPay")) return null;
          return { set: { ...a.set, ...coastKeys(G) }, G2: G, effort: d / Math.max(1, pay), parts: a.steps.length,
            change: { ...ch, to: ch.from + d, delta: d }, steps: a.steps, flags };
        }
        if (s.id === "spend") {
          const c = Math.round(f * -ch.delta / 100) * 100;
          if (c <= 0 || c >= -ch.delta || v.spend - c < spendFloor(v.spend)) return null;
          return { set: { ...coastKeys(G), spend: v.spend - c }, G2: G, effort: c / v.spend, parts: 1, change: { ...ch, to: v.spend - c, delta: -c },
            flags: c / v.spend >= 0.25 ? [{ code: "bigCut", pct: c / v.spend }] : [] };
        }
        const n = Math.round(f * ch.delta);
        if (n <= 0 || n >= ch.delta) return null;
        if (s.id === "retLater") {
          if (R + n > RET_MAX) return null;
          return { set: { ...coastKeys(G), retAge: R + n }, G2: G, effort: n * YEAR_EFFORT, parts: 1, change: { ...ch, to: R + n, delta: n },
            flags: R + n < 59.5 ? [{ code: "bridge" }] : [] };
        }
        if (s.id === "coastBoth" && G.type === "coast") {
          const G2 = { ...G, X: G.X + n }, set = coastKeys(G2);
          if (v.goal === 2) set.goalAge = G.X + n;
          const eff = ps.reduce((t, p) => t + n * lost(v, p), 0) / (yrs * Math.max(1, pay));
          return { set, G2, effort: eff, parts: 1, change: { ...ch, to: G.X + n, delta: n }, flags: [] };
        }
        return null;
      };
      let best = null;
      for (const i of pool) for (const j of pool) {
        if (i === j || !solo[i]) continue;
        for (const f of [0.25, 0.5, 0.75]) {
          const p1 = partial(solo[i], f);
          if (!p1) continue;
          const s2 = L[j](sanitize({ ...v, ...p1.set }).values, p1.G2);
          if (!s2 || !s2.feasible || !s2.set) continue;
          const score = Math.max(p1.effort, s2.effort), sum = p1.effort + s2.effort;
          if (!best || score < best.score - 1e-12 || (Math.abs(score - best.score) <= 1e-12 && sum < best.sum)) best = { score, sum, p1, i, s2 };
        }
      }
      if (best && (best.score < bestEff || !cards.length)) {
        const set = { ...best.p1.set, ...best.s2.set };
        const G2 = best.s2.goal2 || best.p1.G2;
        if (meets(sanitize({ ...v, ...set }).values, G2)) {
          const first = { ...solo[best.i], change: best.p1.change, set: best.p1.set, effort: best.p1.effort, parts: best.p1.parts,
            steps: best.p1.steps || [], size: sizeOf(best.p1.effort), flags: best.p1.flags, feasible: true };
          delete first.reason;
          // The combo carries both parts' labels, once each.
          const flags = [], seenF = new Set();
          for (const f of best.p1.flags.concat(best.s2.flags || [])) {
            const k = f.code + ":" + (f.key || "");
            if (!seenF.has(k)) { seenF.add(k); flags.push(f); }
          }
          const combo = make(v, G, { id: "combo", kind: "combo", change: null, set, effort: best.score,
            parts: best.p1.parts + best.s2.parts, G2, steps: (best.p1.steps || []).concat(best.s2.steps || []), flags });
          combo.pair = [first, best.s2];
          cards.push(combo);
          // Ranked by its own score with the single steps (renting instead stays last).
          cards.sort(byKey);
        }
      }
    }
    out.list = cards;
    out.rejected = rejected;
    out.best = cards[0] || null;
    return out;
  }

  // ---------- how you compare (SPEC 13) ----------
  // The data is benchmarks.js (window.CoastBench), passed in, so these stay pure. All dollar
  // results are in today's dollars: a series in an older year's dollars is inflated by CPI-U
  // (stored, never fetched). Rates, ages and current-dollar figures are left as published.

  /** Today's dollars per dollar of `year`: CPI-U target month / that year's annual average. 1 for null or an unlisted year. */
  function cpiFactor(bench, year) {
    const avg = year === null || year === undefined ? 0 : bench.cpi.annual[year];
    return avg > 0 ? bench.cpi.target.value / avg : 1;
  }

  /** The row of `bands` whose [min, max] age range holds `age`, or null. */
  function bandOf(bands, age) { return (bands || []).find((b) => age >= b.age[0] && age <= b.age[1]) || null; }

  /** {p25: v, p50: v, ...} -> [{p: 25, v}, ...] by percentile, each value times `scale`. Means and other keys are ignored. */
  function cutsOf(obj, scale) {
    const s = scale === undefined ? 1 : scale;
    return Object.keys(obj || {}).filter((k) => /^p\d+$/.test(k))
      .map((k) => ({ p: +k.slice(1), v: obj[k] * s })).sort((a, b) => a.p - b.p);
  }

  /**
   * Where `x` falls among published percentile cutpoints [{p, v}] (SPEC 13.2). Nothing is
   * extrapolated past the published points, and a mean is never a cutpoint.
   *  - between two cutpoints: interpolated, log-linear when `opts.log` and the lower cutpoint is
   *    above 0 (dollars), otherwise linear (rates; a lower cutpoint of 0); a whole percentile.
   *  - below the lowest: { kind: "below", p: that percentile }.
   *  - x = 0 with cutpoints of 0 up to P: { kind: "zero", p: P } (at least P% have none).
   *  - at or above the highest: { kind: "top", top: 100 - its p }. With P90 and P99 both published,
   *    a Pareto tail through them, alpha = ln 10 / ln(v99 / v90), top share = 10% (x / v90)^-alpha,
   *    gives a rough share between them ({ approx: true }, shown only as "top ~X%").
   */
  function percentileOf(x, cuts, opts) {
    const o = opts || {}, n = cuts ? cuts.length : 0;
    const res = (kind, p, top, approx) => ({ kind, p, top, approx: !!approx });
    if (!n || !Number.isFinite(x)) return res("none", null, null);
    if (x < cuts[0].v) return res("below", cuts[0].p, null);
    let i = 0;
    for (let j = 0; j < n; j++) if (cuts[j].v <= x) i = j; // the highest cutpoint at or below x
    if (x === 0 && cuts[i].v === 0) return res("zero", cuts[i].p, null);
    const c90 = cuts.find((c) => c.p === 90), c99 = cuts.find((c) => c.p === 99);
    if (c90 && c99 && c90.v > 0 && c99.v > c90.v && x >= c90.v) {
      if (x >= c99.v) return res("top", 99, 1);
      const alpha = Math.log(10) / Math.log(c99.v / c90.v);
      const share = 10 * Math.pow(x / c90.v, -alpha);
      return res("top", 90, Math.min(10, Math.max(1, Math.round(share))), true);
    }
    const last = cuts[n - 1];
    if (i === n - 1) return res("top", last.p, 100 - last.p);
    const a = cuts[i], b = cuts[i + 1];
    const t = o.log && a.v > 0 ? Math.log(x / a.v) / Math.log(b.v / a.v) : (x - a.v) / (b.v - a.v);
    return res("in", Math.min(Math.round(a.p + (b.p - a.p) * t), b.p - 1), null); // x < b.v: never b's own p
  }

  /** Fidelity's multiple of salary at `age`, linear between its ages; null before the first (not extrapolated), the last multiple after the last. */
  function guidelineMultiple(points, age) {
    if (!points || !points.length || !(age >= points[0][0])) return null;
    for (let j = 1; j < points.length; j++) {
      const [a0, m0] = points[j - 1], [a1, m1] = points[j];
      if (age <= a1) return m0 + (m1 - m0) * (age - a0) / (a1 - a0);
    }
    return points[points.length - 1][1];
  }

  /** Vanguard's income-based saving target (% of pay, employee + employer) for one person's pay. */
  function savingTarget(t, pay) { return pay < t.under ? t.rates[0] : pay <= t.over ? t.rates[1] : t.rates[2]; }

  /**
   * The seven comparisons with the average American (SPEC 13). The household's age is the
   * survey's reference-person age; two incomes count as a couple, one as a single person.
   * Each part is null when it doesn't apply (no survey band for the age, no pay).
   */
  function compare(inputs, bench) {
    const v = sanitize(inputs).values, B = bench, age = v.age, couple = !!v.two, ps = partners(v);
    const LOG = { log: true };
    const sum = (f) => ps.reduce((s, p) => s + f(p), 0);
    const pay = sum((p) => v["sal" + p]);
    const out = { age, couple, partners: ps.slice() };

    // 1. Invested assets vs SCF financial assets, all families the same age (couples alongside).
    const FA = B.financialAssets, fFA = cpiFactor(B, FA.dollars);
    const fb = bandOf(FA.bands, age), fcb = couple ? bandOf(FA.couples, age) : null;
    out.assets = fb && {
      x: v.assets, band: fb.age, cuts: cutsOf(fb, fFA), year: FA.year, src: FA.src, factor: fFA,
      couples: fcb ? { cuts: cutsOf(fcb, fFA) } : null,
    };
    if (out.assets) {
      out.assets.r = percentileOf(v.assets, out.assets.cuts, LOG);
      if (out.assets.couples) out.assets.couples.r = percentileOf(v.assets, out.assets.couples.cuts, LOG);
    }

    // 2. Retirement accounts (invested minus Taxable + cash) vs SCF, people with no account counted.
    const RA = B.retirementAccounts, fRA = cpiFactor(B, RA.dollars);
    const rb = bandOf(RA.bands, age), rcb = couple ? bandOf(RA.couples, age) : null;
    if (rb) {
      const useC = !!(rcb && rcb.uncond), row = useC ? rcb : rb, held = rcb || rb;
      const x = Math.max(0, v.assets - (v.taxable || 0));
      const cuts = cutsOf(row.uncond, fRA), none = 100 - row.holding, k = cuts.findIndex((c) => c.v > 0);
      // Zero cutpoints say only "at least P% have none"; the published share holding one says how many.
      if (k > 0 && none > cuts[k - 1].p && none < cuts[k].p) cuts.splice(k, 0, { p: none, v: 0 });
      out.retirement = {
        x, band: rb.age, group: useC ? "couples" : "all", couplesMissing: couple && !useC, noneShare: none,
        cuts, r: percentileOf(x, cuts, LOG), year: RA.year, src: RA.src, factor: fRA,
        holders: { group: rcb ? "couples" : "all", pct: held.holding, median: held.condMedian * fRA },
      };
    } else out.retirement = null;

    // 3. Saving rate: 401(k) + employer as % of pay, vs Vanguard and Fidelity plan savers.
    const VG = B.savingRates.vanguard, FD = B.savingRates.fidelity;
    if (pay > 0) {
      const people = ps.map((p) => {
        const s = v["sal" + p], k = v["k" + p], e = s * v["emp" + p] / 100;
        const maxed = k >= LIMITS.k401 - 0.5, target = savingTarget(VG.target, s);
        const rate = s > 0 ? (k + e) / s * 100 : null;
        return { p, pay: s, rate, deferral: s > 0 ? k / s * 100 : null, target, maxed, meets: s > 0 && (maxed || rate >= target - 1e-9) };
      });
      const plan = sum((p) => v["k" + p] + v["sal" + p] * v["emp" + p] / 100);
      const all = plan + sum((p) => v["roth" + p]) + v.hsa + (v.taxSave || 0);
      const ab = bandOf(VG.deferralByAge, age), mb = bandOf(VG.atMaxByAge, age);
      out.saving = {
        pay, planRate: plan / pay * 100, totalRate: all / pay * 100, deferral: sum((p) => v["k" + p]) / pay * 100,
        ageDeferral: ab ? ab.mean : null, ageBand: ab ? ab.age : null, people,
        anyMaxed: people.some((q) => q.maxed), atMax: VG.atMax, atMaxAge: mb ? mb.pct : null, atMaxHighPay: VG.atMaxHighPay,
        vanguard: { mean: VG.total.mean, median: VG.total.median, inclZero: VG.totalInclNonParticipants, year: VG.year, src: VG.src },
        fidelity: { total: FD.total, year: FD.year, src: FD.src }, target: VG.target,
      };
    } else out.saving = null;

    // 4. Household pay vs Census household income; each person's pay vs full-time workers.
    const HI = B.householdIncome, fHI = cpiFactor(B, HI.dollars);
    const ladder = cutsOf(HI.all, fHI), hb = bandOf(HI.byAge, age);
    const FT = B.earnings.ftyr, fFT = cpiFactor(B, FT.dollars), BW = B.earnings.blsWeekly;
    const wk = age >= 25 ? BW.age25plus : BW.age16plus, payCuts = cutsOf(wk, BW.weeks), ftb = bandOf(FT.byAge, age);
    out.income = {
      x: pay, cuts: ladder, r: percentileOf(pay, ladder, LOG), year: HI.year, src: HI.src, factor: fHI,
      peer: couple ? { kind: "married", median: HI.marriedCouple * fHI } : { kind: "single", median: HI.nonfamily * fHI },
      ageMedian: hb ? hb.median * fHI : null, ageBand: hb ? hb.age : null,
      people: ps.map((p) => {
        const s = v["sal" + p];
        return { p, pay: s, median: ftb ? ftb.median * fFT : null, band: ftb ? ftb.age : null, r: s > 0 ? percentileOf(s, payCuts, LOG) : null };
      }),
      payCuts, payGroup: age >= 25 ? "25+" : "16+", payYear: BW.period, ftyrYear: FT.year, srcMedians: HI.srcMedians,
    };

    // 5. Savings as a multiple of pay vs Fidelity's guideline for the age.
    const FG = B.fidelityGuide;
    out.multiple = pay > 0 ? { x: v.assets / pay, assets: v.assets, pay, age, guide: guidelineMultiple(FG.points, age), points: FG.points, past: age > FG.points[FG.points.length - 1][0], src: FG.src } : null;

    // 6. Planned retirement age vs what workers expect and what retirees did.
    const RT = B.retirementAge;
    out.retAge = {
      x: v.retAge, expected: RT.ebri.expectedMedian, actual: RT.ebri.actualMedian, earlier: RT.ebri.earlierThanPlanned,
      health: RT.ebri.healthReason, gallup: RT.gallup, before60: RT.gallupBefore60.pct, crr: RT.crr, year: RT.ebri.year, src: RT.ebri.src,
    };

    // 7. Retirement spending vs households headed by someone 65+, and one average Social Security benefit.
    const SP = B.spending, fSP = cpiFactor(B, SP.dollars), SS = B.socialSecurity;
    const ss = SS.avgRetiredWorkerMonthly * 12;
    out.spending = {
      x: v.spend, all65: SP.age65plus * fSP, core65: SP.age65plusCore * fSP, a6574: SP.age65to74 * fSP, a75: SP.age75plus * fSP, people: SP.people65plus,
      ssMonthly: SS.avgRetiredWorkerMonthly, ssYear: ss, ssShare: v.spend > 0 ? ss / v.spend : null,
      year: SP.year, src: SP.src, factor: fSP, ssPeriod: SS.period, ssSrc: SS.src,
    };
    return out;
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
    PMI_END, mortgagePayment, loanBalance, homeTerms, buyPath, firstReach, fiBuy, house,
    YEAR_EFFORT, COMBO_TAU, LEVER_ORDER, goalOf, goalPlan, houseApplies, measure, margin, bisect, scanAge,
    allocate, unallocate, suggest,
    cpiFactor, bandOf, cutsOf, percentileOf, guidelineMultiple, savingTarget, compare,
    fmtMoney, fmtCompact, encodeHash, decodeHash, sliderToValue, valueToSlider, niceRound,
  };
  root.CoastFire = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
