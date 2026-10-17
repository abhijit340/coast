// Coast FIRE: the one-line summaries shown on collapsed sections, and the saved
// open/closed state of those sections. Pure functions, no DOM, so the tests can
// check them in node; app.js puts the strings on the page. Needs calc.js first.
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

  // The off-track sentence under the headline (and the summary of the full nudge list).
  function nudgeLine(res) {
    const v = res.inputs, R = v.retAge;
    const parts = [];
    if (res.requiredAnnual !== null && res.requiredAnnual > 0) parts.push(`save ~${kRound(res.requiredAnnual)}/yr`);
    parts.push(res.retireLater ? `retire at ${res.retireLater}` : "retire later");
    parts.push(`spend ~${kRound(res.spendWithin)}/yr`);
    const list = parts.length > 1 ? parts.slice(0, -1).join(", ") + ", or " + parts[parts.length - 1] : parts[0];
    return `To get there by ${R}: ${list}.`;
  }
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

  const api = {
    UI_KEY, HINT_KEY, parseOpen, withOpen, isOpenIn,
    nudgeLine, spoken, kpiSummary, contribSummary, ecSummary, sparkSummary, partnerSummary, afterCoast, heatSummary, hsaSummary,
    drawSummary, assumeSummary, bridgeSummary, houseSummary, houseCostsSummary, houseHowSummary, breakevenSummary,
  };
  root.CoastUI = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
