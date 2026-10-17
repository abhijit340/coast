// Coast FIRE: the one-line summaries shown on collapsed sections, the saved
// open/closed state of those sections, and the touch-safe slider gestures. Pure
// functions, so the tests can check them in node; app.js puts the strings on the
// page. The one DOM piece, guardSlider(), runs only when the page calls it.
// Needs calc.js first.
(function (root) {
  "use strict";
  const CF = root.CoastFire || (typeof require === "function" ? require("./calc.js") : null);

  const UI_KEY = "coastfire.ui.v1";   // { sectionId: true/false }; layout only, never numbers
  const HINT_KEY = "coastfire.chartHintSeen";

  const money = (x) => CF.fmtMoney(x);
  const cmp = (x) => CF.fmtCompact(x, 2);
  const kRound = (x) => CF.fmtCompact(Math.round(x / 1000) * 1000);
  const p1 = (x) => (+x).toFixed(1) + "%";
  const badAges = (res) => res.warnings.includes("retAgeNotAfterAge");

  // ---------- open/closed state ----------

  // A stored map, cleaned: only short id-like keys with true/false values survive.
  function parseOpen(raw) {
    let m = null;
    try { m = JSON.parse(raw || "null"); } catch (e) { m = null; }
    const out = {};
    if (!m || typeof m !== "object" || Array.isArray(m)) return out;
    for (const [k, v] of Object.entries(m)) {
      if (/^[A-Za-z][\w-]{0,39}$/.test(k) && typeof v === "boolean") out[k] = v;
    }
    return out;
  }
  function withOpen(map, id, open) { return { ...map, [id]: !!open }; }
  // Whether a section starts open: the saved choice, else its default.
  function isOpenIn(map, id, dflt) { return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : !!dflt; }

  // ---------- summary lines ----------

  // Read "~" aloud as "about".
  const spoken = (s) => s.replace(/~/g, "about ");

  function kpiSummary(res) {
    if (badAges(res)) return "fix the ages first";
    const s = res.surplus, ok = s >= -0.5;
    return `FIRE ${cmp(res.fire)} · coast today ${cmp(res.coastNow)} · ${cmp(Math.abs(s))} ${ok ? "ahead" : "short"} at ${res.inputs.retAge}`;
  }

  function contribSummary(res) {
    return `${money(res.start.total)}/yr · ${money(res.start.total / 12)}/mo`;
  }

  function ecSummary(res) {
    const v = res.inputs, R = v.retAge, E = res.earliest;
    if (badAges(res)) return "fix the ages first";
    const age = (e) => (!e || e.age === null ? `not by ${R}` : e.age <= v.age ? "now" : String(e.age));
    if (!v.two) return E.both.age === null ? `not possible by ${R}` : age(E.both);
    if (E.both.age === null && E.A.age === null && E.B.age === null) return `not possible by ${R}`;
    return `both ${age(E.both)} · A alone ${age(E.A)} · B alone ${age(E.B)}`;
  }

  function sparkSummary(res) {
    const sw = res.sweep || [];
    if (badAges(res) || sw.length < 2) return "";
    const ok = sw.find((p) => p.balance >= res.fire * (1 - 1e-6));
    return ok ? `enough if you stop at ${ok.age} or later` : `at most ${cmp(sw[sw.length - 1].balance)}`;
  }

  function partnerSummary(v, p) {
    const on = !!v["coastOn" + p], ca = v["coastAge" + p], after = v["after" + p];
    const accounts = `401(k) ${money(v["k" + p])} · employer ${p1(v["emp" + p])} · Roth ${money(v["roth" + p])}`;
    if (!on) return `${accounts} · no coast`;
    // A coast plan that is on leads, so the row says so even when the line is cut short.
    // What still goes in after coasting, in dollars: that share of the partner's own saving.
    const kept = afterCoast(v, p);
    const coast = ca >= v.retAge ? `coast age ${ca}, no effect` : `coasts at ${Math.max(ca, v.age)}${kept > 0.5 ? `, then ${money(kept)}/yr` : ""}`;
    return `${coast} · ${accounts}`;
  }

  // A partner's yearly saving that continues after their coast age (401(k) + employer + Roth).
  function afterCoast(v, p) { return CF.partnerBase(v, p).total * (v["after" + p] || 0) / 100; }

  // The returns grid: how many of its 25 return / withdrawal-rate cases reach the FIRE number by R.
  function heatSummary(res, g) {
    if (badAges(res) || !g) return "fix the ages first";
    const cells = g.cells.flat(), ok = cells.filter((c) => c.age !== null).length;
    if (!ok) return `none make it by ${res.inputs.retAge}`;
    return ok === cells.length ? `all ${ok} make it` : `${ok} of ${cells.length} make it`;
  }

  function hsaSummary(v) { return `${v.hsaFamily ? "Family" : "Self-only"} · ${money(v.hsa)}/yr`; }

  function drawSummary(res) {
    const v = res.inputs, first = res.firstCoast;
    if (!(v.draw > 0)) return "none";
    return Number.isFinite(first) && first < v.retAge ? `${cmp(v.draw)}/yr from ${Math.max(first, v.age)}` : `${cmp(v.draw)}/yr · needs a coast age`;
  }

  function assumeSummary(v) {
    return {
      text: `${p1(v.nominal)} · inflation ${p1(v.inflation)} · withdraw ${p1(v.swr)}`,
      label: `return ${p1(v.nominal)}, inflation ${p1(v.inflation)}, withdrawal ${p1(v.swr)}`,
    };
  }

  // The bridge row: before 59½ a chip and a teaser sentence sit above it; otherwise one invitation.
  function bridgeSummary(res, br) {
    const ask = "Retiring before 59½?";
    if (!br.applies) {
      const value = br.reason === "badAges" ? "fix the ages first"
        : br.reason === "tooYoung" ? "not drawn for this age" : "how a 72(t) bridge works";
      return { title: ask, value, chip: null, teaser: "" };
    }
    const gaps = br.gapYears.length;
    const chip = gaps ? { kind: "bad", text: `${gaps} short year${gaps === 1 ? "" : "s"}` } : { kind: "good", text: "No gaps" };
    const teaser = `72(t) pays ${kRound(br.pay0)} in year one; ` +
      (gaps ? `short ${cmp(br.totalShort)} over ${gaps} year${gaps === 1 ? "" : "s"}.` : "every year to 59½ is covered.");
    return { title: "Early-access bridge", value: chip.text, chip, teaser };
  }


  // ---------- buying a home (SPEC 11.5) ----------

  const pctShort = (x) => +(+x).toFixed(2) + "%"; // 0.9%, 1%, 0.5%
  const yrs = (d) => { const t = Math.abs(d).toFixed(1); return t + (t === "1.0" ? " yr" : " yrs"); };

  // The row's live value: off, a reason it can't compare yet, or the verdict.
  function houseSummary(res, h) {
    const v = res.inputs;
    if (!v.houseOn) return "off";
    if (badAges(res) || h.reason === "badAges") return "fix the ages first";
    if (h.reason === "buyAfterRet") return `buy before ${v.retAge} to compare`;
    if (h.reason === "noPrice") return "add a home price";
    const at = `Buy at ${h.b}`;
    if (h.cashShort > 0) return `${at}: ${cmp(h.cashShort)} short at closing`;
    const fr = h.fi.rent.age, fb = h.fi.buy.age;
    if (fr !== null && fb !== null) {
      const d = fb - fr;
      // Short enough to fit the row at 375px; the verdict inside says "than renting".
      if (Math.abs(d) < 0.05) return `${at}: same FI age`;
      return `${at}: FI ${yrs(d)} ${d > 0 ? "later" : "earlier"}`;
    }
    const n = h.atRet.buyNW - h.atRet.rentNW;
    return `${at}: ${cmp(Math.abs(n))} ${n < 0 ? "less" : "more"} at ${v.retAge}`;
  }

  // The nested "Costs and growth" row.
  function houseCostsSummary(v) {
    return `closing ${pctShort(v.closePct)} · selling ${pctShort(v.sellPct)} · tax ${pctShort(v.propTax)} · insurance ${money(v.insure)} · upkeep ${pctShort(v.maint)} · growth ${pctShort(v.apprec)}`;
  }

  // The nested "How this is worked out" row: the payment and how often owning costs more.
  function houseHowSummary(h, R) {
    const before = Math.max(0, R - h.b), n = h.yearsCostMore;
    const often = n === 0 ? "owning costs less every year" : n === before ? "owning costs more every year" : `owning costs more ${n} of ${before} yrs`;
    return (h.payment > 0.5 ? `P&I ${money(h.first.pi)}/mo · ` : "") + often;
  }

  // The nested "Breakeven" row: where net worth at R ties, or which side stays ahead.
  function breakevenSummary(h) {
    const g = h.breakeven.growth, i = h.breakeven.rate;
    const ties = [], ahead = [];
    if (g.value !== null) ties.push(`home prices ${g.value >= 0 ? "+" : "−"}${Math.abs(g.value).toFixed(1)}%/yr`);
    else if (g.side) ahead.push(g.side === "buy" ? "buying ahead at any growth" : "renting ahead at any growth");
    if (i.value !== null) ties.push(`a ${i.value.toFixed(1)}% rate`);
    else if (i.side) ahead.push(i.side === "buy" ? "buying ahead at any rate" : "renting ahead at any rate");
    const parts = [];
    if (ties.length) parts.push("ties at " + ties.join(" or "));
    return parts.concat(ahead).join(" · ") || "not found";
  }


  // ---------- suggestions: "Ways to reach your goal" (SPEC 12.7) ----------

  const DISCLAIMER = "Educational estimates from this model, not financial advice. Taxes, catch-up contributions, " +
    "income limits and account rules aren't modeled and can change what makes sense.";
  const SIZE_LABEL = { small: "Small", medium: "Medium", big: "Big stretch", veryBig: "Very big" };
  const yrsW = (n) => `${n} yr${n === 1 ? "" : "s"}`;
  const yearsW = (n) => `${n} ${n === 1 ? "year" : "years"}`;
  const pct0 = (x) => Math.round(x * 100) + "%";
  // "an 11.1%", "an 8.0%", "a 7.0%": the article for a number read aloud.
  const art = (txt) => (/^(8|11|18)(\D|$)/.test(txt) || /^8\d/.test(txt) ? "an " : "a ");

  function accountName(key, two) {
    if (key === "hsa") return "HSA";
    if (key === "taxSave") return "Other investing";
    const base = key.startsWith("roth") ? "Roth IRA" : "401(k)";
    return two ? `Partner ${key.slice(-1)} ${base}` : base;
  }

  // A short action, as in "Best: …" and in the hero line (both round the same way: "$19.7K").
  function phrase(s, sg, forLine) {
    const v = sg.inputs, c = s.change, two = !!v.two;
    switch (s.id) {
      case "save": return `save ${cmp(c.delta)}/yr more`;
      case "spend": return forLine ? `spend ${cmp(c.to)}/yr` : `plan on ${cmp(c.to)}/yr`;
      case "retLater": return `retire at ${c.to}`;
      case "coastBoth": return `keep saving to ${c.to}`;
      case "coastA": case "coastB": return `${s.who} keeps saving to ${c.to}`;
      case "drawLess": return `draw ${cmp(c.to)}/yr`;
      case "buyLater": return `buy at ${c.to}`;
      case "price": return `a home around ${cmp(c.to)}`;
      case "down": return `put ${c.to}% down`;
      case "noBuy": return "rent instead";
      case "combo": return s.pair.map((p) => phrase(p, sg, forLine)).join(" + ");
      case "coastSooner": return s.who === "both" || !two ? `coast ${yrsW(-c.delta)} sooner` : `${s.who} could coast ${yrsW(-c.delta)} sooner`;
      case "retireSooner": return `retire ${yrsW(-c.delta)} sooner`;
      case "spendMore": return `spend ${cmp(c.delta)}/yr more`;
      case "saveLess": return `save ${cmp(-c.delta)}/yr less`;
      case "drawMore": return `draw ${cmp(c.delta)}/yr more`;
      default: return "";
    }
  }

  // The summary of the closed "Ways to reach your goal" row (fits one line at 375px).
  function suggestSummary(sg) {
    if (sg.status === "badAges") return "Fix the ages first";
    if (sg.status === "fiNow") return "You're already there";
    const b = sg.best;
    if (sg.status === "met") return b ? `On track: could ${phrase(b, sg)}` : "On track";
    if (!b) return "No single step gets there";
    let tail = "";
    if (b.id === "save") tail = b.steps.length === 1 ? ` (${accountName(b.steps[0].key, sg.inputs.two)})` : ` (${b.steps.length} accounts)`;
    const t = `Best: ${phrase(b, sg)}${tail}`;
    return b.kind === "combo" && t.length > 46 ? "Best: two smaller steps" : t;
  }

  const goalWords = (sg) => {
    const G = sg.goal, R = sg.inputs.retAge;
    return G.type === "coast" ? `coast by ${G.X}` : G.type === "early" ? `FI by ${G.T}` : `retire by ${R}`;
  };

  // The hero's one off-track sentence (short only): the closest single steps on three levers.
  function suggestLine(sg) {
    if (sg.status !== "short") return "";
    const pick = ["save", "retLater", "spend"].map((id) => sg.list.find((s) => s.id === id)).filter(Boolean);
    const parts = (pick.length ? pick : sg.best ? [sg.best] : []).map((s) => phrase(s, sg, true));
    const where = sg.goal.type === "retire" ? "" : ` to ${goalWords(sg)}`;
    // The hero shows the renting plan; with a home purchase the engine judges buying, so say so
    // and give that scenario's own gap (SPEC 12.5).
    let lead = "";
    if (sg.scenario === "buy") {
      const P = sg.progress, gap = P && P.metric === "balance" ? P.need - P.have : 0;
      lead = gap > 0.5 ? `If you buy at ${sg.buyAge}, you'd be ${cmp(gap)} short. ` : `If you buy at ${sg.buyAge}: `;
    }
    const cap = (t) => (lead && !lead.endsWith(". ") ? t.charAt(0).toLowerCase() + t.slice(1) : t);
    if (!parts.length) return lead + cap(`No single step gets you there${where}; see the ways below.`);
    const list = parts.length > 1 ? parts.slice(0, -1).join(", ") + ", or " + parts[parts.length - 1] : parts[0];
    return lead + cap(`Closest steps${where}: ${list}.`);
  }

  function goalText(sg) {
    const G = sg.goal, R = sg.inputs.retAge;
    if (G.type === "coast") return `Coast by ${G.X}`;
    if (G.type === "early") return `Financially independent by ${G.T}`;
    return `Retire by ${R}`;
  }

  // The status line above the meter.
  function statusText(sg) {
    const v = sg.inputs, R = v.retAge, G = sg.goal, P = sg.progress;
    if (sg.status === "badAges") return "Set a retirement age after your current age.";
    if (sg.status === "fiNow") return "You already have your FIRE number today.";
    const met = sg.status === "met";
    // With a home purchase the engine judges buying, while the hero shows renting: name it.
    const buy = sg.scenario === "buy" ? `With the home purchase at ${sg.buyAge}, ` : "";
    if (G.type === "early") {
      const a = P.fiFrac !== undefined && P.fiFrac !== null ? +P.fiFrac.toFixed(1) : P.fiAge;
      const pace = buy ? `${buy}saving at full pace` : "Saving at full pace";
      if (a === null) return `${pace}, you don't reach your FIRE number by ${sg.fi.top}.`;
      const d = +Math.abs(G.T - a).toFixed(1);
      return met ? `On track: ${pace.charAt(0).toLowerCase() + pace.slice(1)}, you'd be FI at about ${a}${a < G.T && d > 0 ? `, ${yrsW(d)} early` : ""}.`
        : `${pace}, you'd be FI at about ${a}, ${yrsW(d)} after ${G.T}.`;
    }
    const coast = G.type === "coast" ? `${v.two ? "both coasting" : "coasting"} at ${G.X}, you reach` : "";
    const subj = coast ? (buy ? buy + coast : coast.charAt(0).toUpperCase() + coast.slice(1)) : buy ? `${buy}your plan reaches` : "Your plan reaches";
    const gap = Math.abs(P.have - P.need);
    if (met) {
      const low = subj.charAt(0).toLowerCase() + subj.slice(1);
      // Within 1% (or the two round alike): one figure, not "$1.78M ... more than $1.78M".
      if (gap < 0.01 * P.need || cmp(P.have) === cmp(P.need)) return `On track, just barely: ${low} your ${cmp(P.need)} by ${R}, with ${cmp(gap)} to spare.`;
      return `On track: ${low} ${cmp(P.have)} by ${R}, ${cmp(gap)} more than the ${cmp(P.need)} you need.`;
    }
    return `${subj} ${cmp(P.have)} of ${cmp(P.need)} by ${R}: ${cmp(gap)} short.`;
  }

  function progressText(sg) {
    const P = sg.progress;
    if (!P) return "";
    const at = P.metric === "fiAge" ? ` at ${sg.goal.T}` : "";
    return `${cmp(P.have)} of ${cmp(P.need)}${at} · ${Math.round(Math.min(9.99, P.pct) * 100)}%`;
  }

  function sensitivityText(sg) {
    const s = sg.sensitivity;
    if (!s || (sg.status !== "short" && sg.status !== "met")) return "";
    const G = sg.goal;
    const subj = G.type === "retire" ? "your plan as entered" : G.type === "coast" ? `coasting at ${G.X}` : `being FI by ${G.T}`;
    const tail = " This shows how sensitive the plan is; it isn't something to plan on.";
    const ret = s.needReturn !== null ? p1(s.needReturn) : null, swr = s.needSwr !== null ? p1(s.needSwr) : null;
    if (sg.status === "met") {
      const parts = [];
      if (ret) parts.push(`down to ${art(ret)}${ret} return a year before inflation (you assume ${p1(s.haveReturn)})`);
      // A lower withdrawal rate is the more cautious one, so the plan holds for any rate down to this.
      if (swr) parts.push(`with a withdrawal rate as low as ${swr} (you assume ${p1(s.haveSwr)})`);
      return parts.length ? `For reference, ${subj} still works ${parts.join(", or ")}.${tail}` : "";
    }
    const parts = [];
    if (ret) parts.push(`${art(ret)}${ret} return a year before inflation (you assume ${p1(s.haveReturn)})`);
    if (swr) parts.push(`${art(swr)}${swr} withdrawal rate (you assume ${p1(s.haveSwr)})`);
    if (!parts.length) return `For reference, no return or withdrawal rate in this model's range gets ${subj} there.`;
    return `For reference, ${subj} would need ${parts.join(", or ")}.${tail}`;
  }

  // One line per account changed, all in one form: "HSA $1,400 → $8,750 (family limit)",
  // "Partner A Roth IRA $3,200 → $7,500 (limit)".
  function splitLines(steps, v) {
    const two = !!v.two;
    return steps.map((s) => {
      const lim = !s.atLimit ? "" : s.key === "hsa" ? (v.hsaFamily ? " (family limit)" : " (limit)") : " (limit)";
      const name = s.key === "taxSave" ? "Other investing (taxable)" : accountName(s.key, two);
      return `${name} ${money(s.from)} → ${money(s.to)}${lim}`;
    });
  }

  const FLAG_CHIP = {
    rothIncome: ["warn", "Roth income limits apply"],
    hsaEligibility: ["warn", "Needs an HSA-eligible plan"],
    catchUp: ["neutral", "Catch-up (50+) not modeled"],
    overPay: ["bad", "More than your pay"],
    bigCut: ["warn", "Large cut"],
    bridge: ["warn", "Before 59½: see the bridge"],
  };
  const REASON = {
    noYearsLeft: (s, sg) => (sg.goal.type === "coast" ? `coasting at ${sg.goal.X} leaves no years to save` : `no years left before ${sg.goal.T}`),
    notByTop: () => "not even by 100",
    notByRet: (s, sg) => (s.id === "coastBoth" ? `not even coasting at ${sg.inputs.retAge - 1}` : `not even saving to ${sg.inputs.retAge}`),
    belowZero: () => "not even at $0",
    exceedsPay: () => "it would take more than your pay",
    noPay: () => "no salary to save from",
    noEffect: () => "no amount gets there",
    rentShort: () => "renting falls short too",
    tooLate: (s) => `would take until ${s.change.to}`,
    belowFloor: (s) => (s.id === "price" ? `would take a home around ${money(s.change.to)}` : `would take ${money(s.change.to)}/yr`),
    cashShort: (s) => `more cash at closing than the portfolio holds${s.cashShort ? ` (${money(s.cashShort)} short)` : ""}`,
  };
  const NOUN = {
    save: "saving more", spend: "spending less", retLater: "retiring later", coastBoth: "coasting later",
    coastA: "A coasting later", coastB: "B coasting later", drawLess: "drawing less", buyLater: "buying later",
    price: "a cheaper home", down: "a bigger down payment", noBuy: "renting instead",
  };
  function reasonText(s, sg) { return (REASON[s.reason] || (() => "doesn't get there"))(s, sg); }

  // The muted line for levers that can't do it alone.
  function rejectedText(sg) {
    if (sg.status !== "short" || !sg.rejected.length) return "";
    return "Not on its own: " + sg.rejected.map((s) => `${NOUN[s.id] || s.id} (${reasonText(s, sg)})`).join("; ") + ".";
  }

  // The effect line. Each option can have its own FIRE number (spending, the home, the age), so a
  // different target is named as "the $X you'd need", and spending is said as coverage.
  function effectText(s, sg) {
    const e = s.effect, v = sg.inputs, c = s.change;
    if (!e) return "";
    if (e.metric === "fiAge") {
      if (e.fiAge === null) return "Still not FI by 100";
      const at = e.after !== null && e.after !== undefined ? +e.after.toFixed(1) : e.fiAge;
      const d = e.yearsSooner;
      return d !== null && d > 0.05 ? `FI ${d.toFixed(1)} yrs sooner, at about ${at}` : `FI at about ${at}`;
    }
    const R2 = s.set && s.set.retAge !== undefined ? s.set.retAge : v.retAge;
    if (s.id === "noBuy") return `Renting reaches ${cmp(e.after)} of the ${cmp(e.target)} it needs by ${R2}`;
    if (s.id === "spend" || s.id === "spendMore") {
      return `Your ${cmp(e.after)} would cover ${money(c.to)}/yr` + (sg.scenario === "rent" ? ` at your ${p1(v.swr)} withdrawal rate` : " with the home's costs");
    }
    const P = sg.progress, same = P && Math.abs(e.target - P.need) <= 0.005 * Math.max(1, P.need);
    const when = R2 === v.retAge ? "by" : "at";
    if (s.kind === "opportunity") return same ? `Still reaches your ${cmp(e.target)} ${when} ${R2}` : `Still reaches the ${cmp(e.target)} you'd need ${when} ${R2}`;
    if (!same) return `Reaches the ${cmp(e.target)} you'd need ${when} ${R2} (now ${cmp(e.before)})`;
    if (s.id === "retLater") return `Reaches ${cmp(e.after)} at ${R2}`;
    return `Reaches ${cmp(e.after)} by ${R2} (now ${cmp(e.before)})`;
  }

  // Everything a card says: {title, detail, effect, chips:[{tone, word}], split, why, note, side, sizeLabel}.
  function cardText(s, sg) {
    const v = sg.inputs, R = v.retAge, two = !!v.two, c = s.change, G = sg.goal;
    const pay = (v.salA || 0) + (two ? v.salB || 0 : 0);
    const out = { title: "", detail: "", effect: effectText(s, sg), chips: [], split: [], why: "", note: "", side: "",
      sizeLabel: s.size ? `Effort: ${SIZE_LABEL[s.size].toLowerCase()}` : "" };
    const other = (p) => (p === "A" ? "B" : "A");
    switch (s.id) {
      case "save":
        out.title = `Save ${money(c.delta)}/yr more`;
        out.detail = `${money(c.delta / 12)}/mo${two ? " together" : ""}` + (pay > 0 ? ` · ${pct0(c.delta / pay)} of pay` : "");
        out.split = splitLines(s.steps, v);
        out.why = "Why this order: a common general order (an HSA, then Roth IRAs, then 401(k)s, then taxable), not advice for you. " +
          "This model gives every account the same return and no taxes, so the projection is the same whichever account gets the money.";
        out.note = "If your plan matches, contributing enough to get the whole match usually comes first.";
        out.side = `Take-home about ${money(Math.round(c.delta / 12 / 10) * 10)}/mo lower (before tax effects).`;
        if (pay > 0) out.chips.push({ tone: s.flags.some((f) => f.code === "highShare") ? "warn" : "neutral", word: `${pct0((c.delta) / pay)} of pay` });
        break;
      case "spend":
        out.title = `Plan on ${money(c.to)}/yr in retirement`;
        out.detail = `${pct0(-c.delta / c.from)} less than your ${money(c.from)} plan`;
        break;
      case "retLater":
        out.title = `Retire at ${c.to} instead of ${c.from}`;
        out.detail = `${c.delta} more working ${c.delta === 1 ? "year" : "years"}`;
        break;
      case "coastBoth":
        out.title = `Keep saving until ${c.to}, not ${c.from}`;
        out.detail = `${yearsW(c.delta)} more before ${two ? "you both coast" : "you coast"}`;
        break;
      case "coastA": case "coastB":
        if (G.type === "coast") {
          out.title = `Only ${s.who} keeps saving to ${c.to}`;
          out.detail = `${other(s.who)} still coasts at ${G.X}`;
          if (s.set.goal === 1) out.note = `Also sets your goal to Retire by ${R}, with this coast plan.`;
        } else {
          out.title = `${s.who} keeps saving to ${c.to}, not ${c.from}`;
          out.detail = `${yearsW(c.delta)} more before ${s.who} coasts`;
        }
        break;
      case "drawLess":
        out.title = `Draw ${money(c.to)}/yr while coasting`;
        out.detail = `${money(-c.delta)} less than ${money(c.from)}`;
        break;
      case "buyLater":
        out.title = `Buy at ${c.to} instead of ${c.from}`;
        out.detail = `${yearsW(c.delta)} more renting`;
        break;
      case "price":
        out.title = `A home around ${money(c.to)}`;
        out.detail = `${money(-c.delta)} less than ${money(c.from)}`;
        break;
      case "down":
        out.title = `Put ${c.to}% down instead of ${+c.from.toFixed(1)}%`;
        out.detail = `${money(v.price * c.delta / 100)} more at closing`;
        break;
      case "noBuy":
        out.title = "Rent instead of buying";
        out.detail = "Switches off Buying a home";
        break;
      case "combo":
        out.title = `Two smaller steps: ${phrase(s.pair[0], sg)} and ${phrase(s.pair[1], sg)}`;
        out.split = s.pair.map((p) => cardText(p, sg).title);
        out.detail = "Two smaller changes instead of one big one";
        if (s.pair.some((p) => p.id === "save")) {
          out.why = "Why this order: a common general order (an HSA, then Roth IRAs, then 401(k)s, then taxable), not advice for you. " +
            "This model gives every account the same return and no taxes.";
        }
        break;
      case "coastSooner": {
        const all = s.who === "both" || !two, subj = all ? (two ? "Both of you" : "You") : s.who;
        out.title = c.to <= v.age ? `${subj} could stop saving now` : `${subj} could stop saving at ${c.to} instead of ${c.from}`;
        out.detail = all ? `${yearsW(-c.delta)} sooner` : `${yearsW(-c.delta)} sooner; ${other(s.who)} keeps their plan`;
        if (s.set.goal === 1) out.detail += `; also sets your goal to Retire by ${R}`;
        break;
      }
      case "retireSooner":
        out.title = `Retire at ${c.to}, ${yrsW(-c.delta)} sooner`;
        out.detail = `${yearsW(-c.delta)} less working`;
        break;
      case "spendMore":
        out.title = `Spend up to ${money(c.to)}/yr (+${money(c.delta)})`;
        out.detail = `In retirement, instead of ${money(c.from)}`;
        break;
      case "saveLess":
        out.title = `Save ${money(-c.delta)}/yr less and still make it`;
        out.detail = `${money(-c.delta / 12)}/mo${two ? " together" : ""}`;
        out.split = splitLines(s.steps, v);
        out.side = `Take-home about ${money(Math.round(-c.delta / 12 / 10) * 10)}/mo higher (before tax effects).`;
        break;
      case "drawMore":
        out.title = `Draw up to ${money(c.to)}/yr while coasting (+${money(c.delta)})`;
        out.detail = `Instead of ${money(c.from)}`;
        break;
      default: break;
    }
    // Under a coast goal the patch also turns the coast switches on (calc.js make); say so once.
    const G2 = s.goal2 || G;
    if (G2.type === "coast" && s.set && s.set.coastOnA && !/^coast/.test(s.id) && s.kind !== "opportunity") {
      const X = s.set.coastAgeA;
      out.note = (out.note ? out.note + " " : "") + `Also sets ${two ? "both of you" : "you"} to coast at ${X}.`;
    }
    const seen = new Set();
    for (const f of s.flags || []) {
      const ch = FLAG_CHIP[f.code];
      if (ch && !seen.has(f.code)) { seen.add(f.code); out.chips.push({ tone: ch[0], word: ch[1] }); }
    }
    if (!s.feasible) out.chips.push({ tone: "bad", word: `Not possible: ${reasonText(s, sg)}` });
    return out;
  }

  // "Applied: save $19,700/yr more."
  function appliedText(s, sg) {
    const t = cardText(s, sg).title;
    return `Applied: ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
  }

  // ---------- how you compare (SPEC 13) ----------
  // Words for CF.compare(): the closed row's summary and, per comparison, a title, a short
  // value for its row, one plain sentence, a few smaller lines and its sources.

  function ordinal(n) {
    const m = n % 100, s = m >= 11 && m <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
    return n + s;
  }
  // [35, 44] -> "35–44"; [18, 34] -> "under 35"; [75, 120] -> "75 and over".
  function bandWords(b) {
    if (!b) return "";
    if (b[1] >= 120) return `${b[0]} and over`;
    if (b[0] <= 18) return `under ${b[1] + 1}`;
    return `${b[0]}–${b[1]}`;
  }
  // A percentile result in a sentence ("about the 55th percentile") and short ("~55th percentile").
  function pctlWords(r) {
    if (!r || r.kind === "none") return "not comparable";
    if (r.kind === "below") return r.p === 50 ? "below the median" : `below the ${ordinal(r.p)} percentile`;
    if (r.kind === "zero") return `at $0, with at least ${Math.round(r.p)}%`;
    if (r.kind === "top") return `in the top ${r.approx ? "~" : ""}${r.top}%`;
    return `about the ${ordinal(r.p)} percentile`;
  }
  function pctlShort(r) {
    if (!r || r.kind === "none") return "—";
    if (r.kind === "below") return r.p === 50 ? "below the median" : `below the ${ordinal(r.p)} percentile`;
    if (r.kind === "zero") return "none yet";
    if (r.kind === "top") return `top ${r.approx ? "~" : ""}${r.top}%`;
    return `~${ordinal(r.p)} percentile`;
  }
  const rate1 = (x) => (+x).toFixed(1) + "%";
  const pct = (x) => Math.round(x) + "%";
  const mult = (x) => String(+(+x).toFixed(x < 1 ? 2 : 1)) + "×"; // 0.36×, 3.6×, 6×, 0×
  // A rate next to a target: one decimal, or two when one decimal would hide which side it's on.
  function rateVs(rate, target) {
    const one = (+rate).toFixed(1);
    return (rate < target && +one >= target) || (rate >= target && +one < target) ? (+rate).toFixed(2) + "%" : one + "%";
  }

  /** The closed "How you compare" row: invested assets against all households the same age (named, since a couple's rows also show couples). */
  function compareSummary(c) {
    if (!c || !c.assets) return "for ages 18 and up";
    const r = c.assets.r;
    if (r.kind === "below") return `below the ${ordinal(r.p)} percentile of households your age`;
    if (r.kind === "top") return `top ${r.approx ? "~" : ""}${r.top}% of households your age`;
    return `~${ordinal(r.p)} percentile of households your age`;
  }

  /** The seven comparisons as words; `bench` supplies the source names and links. */
  function compareItems(c, bench) {
    const S = bench.sources, src = (key, year) => ({ label: S[key].label, url: S[key].url, year });
    const two = c.couple, items = [];
    const who = (p) => (two ? p : "You");
    const age = bandWords;

    // 1. Invested assets
    if (c.assets) {
      const a = c.assets, med = a.cuts.find((q) => q.p === 50);
      const subs = [];
      if (a.couples) {
        const cr = a.couples.r, c50 = a.couples.cuts.find((q) => q.p === 50), c90 = a.couples.cuts.find((q) => q.p === 90);
        const where = cr.kind === "below" ? "below their median" : cr.kind === "top" ? "in their top 10%" : `at about their ${ordinal(cr.p)} percentile`;
        subs.push(`Among couples your age the median is ${cmp(c50.v)} and the top 10% have ${cmp(c90.v)} or more: you're ${where}.`);
      }
      subs.push("Compared with the survey's financial assets: cash, investments and retirement accounts, not home equity. Your total leaves out the emergency fund, so you may rank a little higher than shown.");
      items.push({
        id: "assets", title: "Invested assets", value: pctlShort(a.r),
        line: `Your ${cmp(a.x)} invested is ${pctlWords(a.r)} for households aged ${age(a.band)}, where the median is ${cmp(med.v)}.`,
        subs, sources: [src(a.src, `${a.year} survey`)],
      });
    } else {
      items.push({ id: "assets", title: "Invested assets", value: "—", line: "The survey covers households headed by someone 18 or older.", subs: [], sources: [] });
    }

    // 2. Retirement accounts
    if (c.retirement) {
      const t = c.retirement, grp = t.group === "couples" ? "couples" : "households", h = t.holders;
      const hgrp = h.group === "couples" ? "couples" : "households";
      let line;
      if (t.r.kind === "zero") line = `Like about ${pct(100 - h.pct)} of ${hgrp} aged ${age(t.band)}, you don't have money in retirement accounts yet.`;
      else line = `Your ${cmp(t.x)} in retirement accounts is ${pctlWords(t.r)} for ${grp} aged ${age(t.band)}, counting those with none.`;
      const subs = [`Among the ${pct(h.pct)} of ${hgrp} your age who have an account, the median is ${cmp(h.median)}.`];
      if (t.couplesMissing) subs.push("There's no couples-only spread past 64, so this compares with all households your age.");
      subs.push("Counts your invested money except what you keep in taxable accounts and cash (set under Bridge). The survey doesn't count HSAs.");
      items.push({
        id: "retire", title: "Retirement accounts", value: t.r.kind === "zero" ? "none yet" : pctlShort(t.r) + (t.group === "couples" ? " (couples)" : ""),
        line, subs, sources: [src("scf_tables", `${t.year} share and median`), src(t.src, `${t.year} percentiles`)],
      });
    } else {
      items.push({ id: "retire", title: "Retirement accounts", value: "—", line: "The survey covers households headed by someone 18 or older.", subs: [], sources: [] });
    }

    // 3. Saving rate
    if (c.saving) {
      const s = c.saving, vg = s.vanguard, T = s.target, subs = [];
      subs.push(`With Roth IRAs, the HSA and other investing: ${rate1(s.totalRate)} of pay.`);
      if (s.ageDeferral !== null) subs.push(`Your own part, ${rate1(s.deferral)}, compares with an average of ${rate1(s.ageDeferral)} for savers aged ${age(s.ageBand)}.`);
      const paid = s.people.filter((q) => q.pay > 0);
      const verdict = (q) => (q.maxed ? "at the 401(k) maximum"
        : q.rate <= 0 ? `not contributing yet (target ${q.target}%)`
        : q.meets ? `${rateVs(q.rate, q.target)}, meeting the ${q.target}% target`
        : `${rateVs(q.rate, q.target)}, ${q.target - q.rate < 0.1 ? "a hair under" : q.target - q.rate < 0.5 ? "just under" : "under"} the ${q.target}% target`);
      const same = paid.length === 2 && verdict(paid[0]) === verdict(paid[1]);
      const list = same ? `A and B each: ${verdict(paid[0])}.` : paid.map((q) => `${who(q.p)}: ${verdict(q)}.`).join(" ");
      subs.push(`Vanguard's target by pay, counting the employer's share: ${T.rates[0]}% under ${cmp(T.under)}, ${T.rates[1]}% to ${cmp(T.over)}, ${T.rates[2]}% above, or the 401(k) maximum; ${T.meetPct}% of its savers meet theirs. ${list}`);
      if (s.anyMaxed) {
        const maxers = paid.filter((q) => q.maxed).map((q) => who(q.p));
        const hp = s.atMaxHighPay;
        subs.push(`Maxing the 401(k) puts ${two ? maxers.join(" and ") : "you"} with the ${s.atMax}% of savers who do (${s.atMaxAge !== null ? `${s.atMaxAge}% at ${age(s.ageBand)}; ` : ""}${hp.pct}% of those paid ${cmp(hp.floor)} or more).`);
      }
      subs.push(`These cover workers in employer plans run by Vanguard or Fidelity, their current plan only, not all Americans. Counting eligible workers who don't join, Vanguard's figure is ${rate1(vg.inclZero)}.`);
      items.push({
        id: "saving", title: "Saving rate", value: `${rate1(s.planRate)} vs ${rate1(vg.median)} typical`,
        line: `You put ${rate1(s.planRate)} of pay into 401(k)s, counting the employer's share. The typical Vanguard saver puts in ${rate1(vg.median)} (average ${rate1(vg.mean)}), and Fidelity's average is ${rate1(s.fidelity.total)}.`,
        subs, sources: [src(vg.src, String(vg.year)), src(s.fidelity.src, "Q2 " + s.fidelity.year)],
      });
    } else {
      items.push({ id: "saving", title: "Saving rate", value: "—", line: "Add a salary to compare saving rates.", subs: [], sources: [] });
    }

    // 4. Household income
    {
      const n = c.income, subs = [];
      const peer = n.peer.kind === "married" ? "married couples" : "one-person and other nonfamily households";
      let line = n.x > 0 ? `Your household's pay, ${cmp(n.x)}, is ${pctlWords(n.r)} of all US households. ` : "With no pay entered, there's no income to compare. ";
      line += `The median for ${peer} is ${cmp(n.peer.median)}` + (n.ageMedian !== null ? `, and for households headed by someone aged ${age(n.ageBand)}, ${cmp(n.ageMedian)}.` : ".");
      const paid = n.people.filter((q) => q.pay > 0);
      // Two equal salaries read as one line ("A and B each earn ...").
      const groups = paid.length === 2 && paid[0].pay === paid[1].pay ? [[paid[0], "A and B each earn"]]
        : paid.map((q) => [q, two ? `${q.p} earns` : "You earn"]);
      for (const [q, lead] of groups) {
        subs.push(`${lead} ${cmp(q.pay)}: ${pctlWords(q.r)} of full-time wage and salary workers ${n.payGroup === "25+" ? "25 and over" : "16 and over"} (BLS weekly pay × 52)` +
          (q.median !== null ? `. The median full-time worker aged ${age(q.band)} earns ${cmp(q.median)}.` : "."));
      }
      subs.push(`Census income counts all money income before tax, not just pay.${n.peer.kind === "married" ? " Married couples include those with one earner." : ""}`);
      items.push({
        id: "income", title: "Household income", value: n.x > 0 ? pctlShort(n.r) : "—", line, subs,
        sources: [src(n.src, `${n.year} income`), src(n.srcMedians, `${n.year} medians`), src("census_t11", `${n.ftyrYear} earnings`), src("bls_weekly", n.payYear)],
      });
    }

    // 5. Savings as a multiple of pay
    if (c.multiple) {
      const m = c.multiple, pts = m.points, subs = [];
      const steps = pts.map(([a, k]) => `${k}× by ${a}`).join(", ");
      let line = `You have ${mult(m.x)} your pay saved (${cmp(m.assets)} ÷ ${cmp(m.pay)}). `;
      const end = pts[pts.length - 1];
      line += m.guide === null ? `Fidelity's guideline starts at ${pts[0][1]}× by ${pts[0][0]}.`
        : m.past ? `Fidelity's guideline is ${end[1]}× by ${end[0]}.` : `Fidelity's guideline at ${m.age} is about ${mult(m.guide)}.`;
      subs.push(`The guideline: ${steps}.`);
      subs.push("This uses all your invested money, taxable accounts and cash included; Fidelity's guideline counts savings meant for retirement.");
      subs.push("A rule of thumb that assumes saving 15% from 25 and retiring at 67, not what people actually have.");
      items.push({
        id: "multiple", title: "Savings vs. pay", value: m.guide === null ? `${mult(m.x)} · guideline from ${pts[0][0]}` : `${mult(m.x)} vs ${mult(m.guide)} guideline`,
        line, subs, sources: [src(m.src, "2026")],
      });
    } else {
      items.push({ id: "multiple", title: "Savings vs. pay", value: "—", line: "Add a salary to compare savings with pay.", subs: [], sources: [] });
    }

    // 6. Retirement age
    {
      const r = c.retAge, d = r.x - r.actual, subs = [];
      const rel = d === 0 ? "the same age as the typical retiree" : `${Math.abs(d)} year${Math.abs(d) === 1 ? "" : "s"} ${d < 0 ? "earlier" : "later"} than the typical retiree`;
      subs.push(`${r.earlier}% of retirees stopped earlier than they planned; health or disability was the top reason (${r.health}%).`);
      if (r.x < 60) subs.push(`Only about ${r.before60}% of adults not yet retired expect to stop before 60.`);
      const half = (a) => { const h = Math.round(a * 2) / 2; return Math.floor(h) + (h % 1 ? "½" : ""); };
      subs.push(`Gallup's averages: ${r.gallup.expectedMean} expected, ${r.gallup.actualMean} actual. Labor-force data (CRR, ${r.crr.year}): by about ${half(r.crr.men)} for men and ${half(r.crr.women)} for women, fewer than half still work.`);
      subs.push("Expected and actual ages come from surveys.");
      items.push({
        id: "retage", title: "Retirement age", value: `${r.x} vs ${r.actual} actual`,
        line: `You plan to retire at ${r.x}, ${rel}. Workers expect to retire at ${r.expected} (median); retirees' median actual age was ${r.actual}.`,
        subs, sources: [src(r.src, String(r.year)), src(r.gallup.src, String(r.gallup.year))].concat(r.x < 60 ? [src("gallup2018", "2018")] : [], [src(r.crr.src, String(r.crr.year))]),
      });
    }

    // 7. Retirement spending
    {
      const s = c.spending, subs = [];
      if (s.ssShare !== null) {
        const one = s.ssShare >= 1 ? "more than all of it" : `${pct(s.ssShare * 100)} of it`;
        const both = two ? (s.ssShare * 2 >= 1 ? "; two would cover all of it" : `; two would cover ${pct(s.ssShare * 200)}`) : "";
        subs.push(`One average Social Security retirement benefit, ${money(s.ssMonthly)}/mo (${cmp(s.ssYear)}/yr), would cover ${one}${both}. This calculator doesn't count Social Security.`);
      }
      subs.push(`Average spending of households headed by someone 65 or older (${s.people} people on average), ${s.year} survey raised for inflation. Without payroll taxes and pension contributions, which a retirement budget usually leaves out, it's ${cmp(s.core65)}.`);
      items.push({
        id: "spend", title: "Retirement spending", value: `${cmp(s.x)} vs ${cmp(s.all65)} at 65+`,
        line: `You plan to spend ${cmp(s.x)} a year. Households headed by someone 65 or older spend ${cmp(s.all65)} on average (${cmp(s.a6574)} at 65–74, ${cmp(s.a75)} at 75+).`,
        subs, sources: [src(s.src, `${s.year} survey`), src(s.ssSrc, s.ssPeriod)],
      });
    }
    return items;
  }

  const COMPARE_NOTE = "Comparisons use public survey data (Federal Reserve SCF 2025, Census CPS 2026, BLS, Vanguard, Fidelity, EBRI, SSA). " +
    "Dollar figures are in today's dollars: older ones are raised by consumer prices (CPI-U) to September 2026. Percentiles are estimated " +
    "between published points and are approximate. Two incomes are compared as a couple (the survey's couples include unmarried partners), " +
    "one as a single person, both partners at your current age. For context only, not financial advice.";

  // ---------- touch-safe sliders (SPEC 2.1) ----------
  // On a touch screen a range input jumps to wherever a finger lands and grabs vertical
  // swipes meant for the page. guardSlider() takes touches over instead: only a sideways
  // drag that starts on or near the thumb changes the value; taps and vertical swipes do
  // nothing (the page scrolls). Mouse and keyboard keep the browser's own behavior, and the
  // input stays a real <input type="range"> for screen readers and arrow keys.

  const SLOP = 10;   // px a finger moves before the gesture counts as a drag or a swipe
  const REACH = 24;  // px either side of the thumb's center that still grabs it (48px target;
                     // at the ends the wrapper's 8px overhang in style.css keeps it 45px or more)

  // "pending" (still within the slop), "horizontal" (a drag) or "vertical" (a scroll).
  // Exactly diagonal counts as vertical: when in doubt, the page scrolls.
  function classifyGesture(dx, dy, slop = SLOP) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.hypot(ax, ay) < slop) return "pending";
    return ax > ay ? "horizontal" : "vertical";
  }
  // A gesture that ended while still "pending" was a tap.
  const gestureEnd = (state) => (state === "pending" ? "tap" : state);

  // Where the thumb's center sits, in px from the input's left edge: browsers keep the whole
  // thumb inside the input, so the center runs from thumb/2 to width - thumb/2.
  function thumbCenter(value, min, max, width, thumb) {
    const span = max - min, f = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
    return thumb / 2 + f * Math.max(0, width - thumb);
  }
  // Whether a touch at x (px from the input's left edge) is on or near the thumb.
  function nearThumb(x, value, min, max, width, thumb, reach = REACH) {
    return Math.abs(x - thumbCenter(value, min, max, width, thumb)) <= reach;
  }
  // What ending a gesture does. Only a finger lifted after a sideways drag commits (a
  // "change" event and the Undo toast). A pointercancel means the browser or the system took
  // the gesture over (a late scroll, an edge swipe, a call), so a drag puts the value back.
  function gestureFinish(state, start, value, cancelled) {
    if (state !== "horizontal") return { commit: false, revert: false };
    if (cancelled) return { commit: false, revert: value !== start };
    return { commit: value !== start, revert: false };
  }
  // The value after dragging dx px from where the thumb was grabbed: relative, so the thumb
  // never jumps to the finger; snapped to the step and kept within min..max.
  function dragValue(start, dx, min, max, step, width, thumb) {
    const travel = Math.max(1, width - thumb);
    const raw = start + dx / travel * (max - min);
    const st = step > 0 ? step : 1;
    const n = Math.round((Math.min(max, Math.max(min, raw)) - min) / st);
    const decimals = (String(st).split(".")[1] || "").length;
    return Math.min(max, Math.max(min, +(min + n * st).toFixed(decimals)));
  }

  // Wires one range input (DOM; the page calls it, the tests don't). The input's wrapper
  // receives the touches: CSS turns pointer events off on the input itself while
  // <html class="touch-guard"> is set (any coarse pointer). opts.onStart() runs when
  // a drag begins and opts.onEnd({ changed, start, touch, cancelled }) when it ends; value changes go
  // through the input's own "input" and "change" events, so the page needs no other path.
  function guardSlider(input, opts = {}) {
    const wrap = input.parentElement;
    let g = null; // { id, x0, y0, start, state, rect, thumb }
    const num = (v, d) => (Number.isFinite(+v) && v !== "" ? +v : d);
    const range = () => ({ min: num(input.min, 0), max: num(input.max, 100), step: num(input.step, 1) });
    const thumbPx = () => parseFloat(getComputedStyle(input).getPropertyValue("--thumb")) || 22;
    const fire = (type) => input.dispatchEvent(new Event(type, { bubbles: true }));
    // Focus the slider for the drag. A number box that had focus is blurred first, so Chrome
    // does not carry its :focus-visible over to the slider (which would show the range labels).
    const focusInput = () => {
      const ae = document.activeElement;
      if (ae && ae !== input && ae !== document.body && ae.blur) ae.blur();
      input.focus({ preventScroll: true });
    };
    // Ends the gesture: commit on a lifted finger, put the value back on a cancel.
    const finish = (cancelled) => {
      if (!g) return;
      const was = g; g = null;
      wrap.classList.remove("dragging");
      if (was.state !== "horizontal") return;
      const out = gestureFinish(was.state, was.start, +input.value, cancelled);
      if (out.revert) { input.value = was.start; fire("input"); }
      if (out.commit) fire("change");
      if (opts.onEnd) opts.onEnd({ changed: out.commit, start: was.start, touch: !was.mouse, cancelled: !!cancelled });
    };
    wrap.addEventListener("pointerdown", (e) => {
      if (!document.documentElement.classList.contains("touch-guard") || !e.isPrimary || input.disabled) return;
      finish(true); // a gesture whose pointerup never arrived: drop it without committing
      const rect = input.getBoundingClientRect(), r = range(), thumb = thumbPx();
      const x = e.clientX - rect.left, value = num(input.value, r.min);
      if (e.pointerType === "mouse") {
        // A mouse on a touch-first device: like the browser's own slider (jump, then drag).
        if (e.button !== 0) return;
        e.preventDefault();
        try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
        focusInput();
        wrap.classList.add("dragging");
        if (opts.onStart) opts.onStart();
        const v = dragValue(r.min, x - thumb / 2, r.min, r.max, r.step, rect.width, thumb);
        g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, start: value, base: v, state: "horizontal", rect, thumb, mouse: true };
        if (v !== value) { input.value = v; fire("input"); }
        return;
      }
      if (!nearThumb(x, value, r.min, r.max, rect.width, thumb)) return;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, start: value, base: value, state: "pending", rect, thumb };
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id || g.state === "vertical") return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (g.state === "pending") {
        g.state = classifyGesture(dx, dy);
        if (g.state !== "horizontal") return;
        focusInput();
        wrap.classList.add("dragging");
        if (opts.onStart) opts.onStart();
      }
      const r = range();
      const v = dragValue(g.base, dx, r.min, r.max, r.step, g.rect.width, g.thumb);
      if (v !== +input.value) { input.value = v; fire("input"); }
      e.preventDefault();
    });
    wrap.addEventListener("pointerup", (e) => { if (g && e.pointerId === g.id) finish(false); });
    wrap.addEventListener("pointercancel", (e) => { if (g && e.pointerId === g.id) finish(true); });
    // Capture lost without a pointerup (pointerup runs first when there is one): a cancel.
    wrap.addEventListener("lostpointercapture", (e) => { if (g && e.pointerId === g.id) finish(true); });
    // A long press would otherwise open the text-selection / callout menu.
    wrap.addEventListener("contextmenu", (e) => { if (g) e.preventDefault(); });
  }

  const api = {
    UI_KEY, HINT_KEY, parseOpen, withOpen, isOpenIn,
    spoken, kpiSummary,
    DISCLAIMER, SIZE_LABEL, accountName, phrase, suggestSummary, suggestLine, goalText, statusText, progressText,
    sensitivityText, splitLines, rejectedText, effectText, cardText, appliedText, contribSummary, ecSummary, sparkSummary, partnerSummary, afterCoast, heatSummary, hsaSummary,
    drawSummary, assumeSummary, bridgeSummary, houseSummary, houseCostsSummary, houseHowSummary, breakevenSummary,
    ordinal, bandWords, pctlWords, pctlShort, rateVs, mult, compareSummary, compareItems, COMPARE_NOTE,
    SLOP, REACH, classifyGesture, gestureEnd, gestureFinish, thumbCenter, nearThumb, dragValue, guardSlider,
  };
  root.CoastUI = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
