(function () {
  "use strict";

  var OFFICIAL = { base: 0.25, growth: 1, maturity: 1 };

  var state = {
    tab: "pre",
    q: "",
    category: "all",
    chain: "all",
    sort: "rank",
    sandbox: { base: 0.25, growth: 1, maturity: 1 },
    openSlug: null
  };

  var DATA = null;

  function $(id) { return document.getElementById(id); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function chainList(row) {
    if (!row) return [];
    if (Array.isArray(row.chains)) return row.chains.slice();
    if (typeof row.chains === "string" && row.chains) return [row.chains];
    if (Array.isArray(row.chain_list)) return row.chain_list.slice();
    if (Array.isArray(row.chains_list)) return row.chains_list.slice();
    return [];
  }

  function chainCount(row) {
    var list = chainList(row);
    if (list.length) return list.length;
    if (typeof row.chains === "number") return row.chains;
    return 1;
  }

  function ageOf(row) {
    if (row.age_days !== null && row.age_days !== undefined) return row.age_days;
    if (row.model && row.model.age_days !== null && row.model.age_days !== undefined) return row.model.age_days;
    return 365;
  }

  function changeOf(row) {
    if (row.change_7d === null || row.change_7d === undefined) return 0;
    return row.change_7d;
  }

  function fmtMoney(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    var n = Number(v);
    if (n >= 1000000000) return "$" + (n / 1000000000).toFixed(2) + "B";
    if (n >= 1000000) return "$" + (n / 1000000).toFixed(2) + "M";
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function factors(row, params) {
    var change = clamp(changeOf(row), -50, 150);
    var growth = 1 + (change / 100 * 0.6) * params.growth;
    var age = ageOf(row);
    var maturity = 0.55 + (Math.min(age, 1460) / 1460 * 0.45) * params.maturity;
    var breadth = 1 + Math.min(Math.max(chainCount(row) - 1, 0), 6) * 0.02;
    return { base: params.base, growth: growth, maturity: maturity, breadth: breadth };
  }

  function pureImplied(row, params) {
    var f = factors(row, params);
    var tvl = Number(row.tvl_usd) || 0;
    return Math.round(tvl * f.base * f.growth * f.maturity * f.breadth);
  }

  function isOfficial(params) {
    return params.base === OFFICIAL.base && params.growth === OFFICIAL.growth && params.maturity === OFFICIAL.maturity;
  }

  function sandboxActive() { return !isOfficial(state.sandbox); }

  // Recomputed implied. Anchored on the board value so the official
  // parameters reproduce the board figure exactly, and doubling the
  // base multiple doubles the figure exactly. The anchor ratio is the
  // same formula ratio, so growth / maturity moves match the formula
  // to within the board rounding.
  function computeImplied(row, params) {
    var board = row.implied_value_usd;
    if (board === null || board === undefined || isNaN(board)) return pureImplied(row, params);
    if (isOfficial(params)) return Math.round(Number(board));
    var o = factors(row, OFFICIAL);
    var n = factors(row, params);
    var ratio = (n.base / o.base) * (n.growth / o.growth) * (n.maturity / o.maturity) * (n.breadth / o.breadth);
    return Math.round(Number(board) * ratio);
  }

  function boardImplied(row) {
    if (row.implied_value_usd !== null && row.implied_value_usd !== undefined) return Math.round(Number(row.implied_value_usd));
    return pureImplied(row, OFFICIAL);
  }

  function allRows() {
    if (!DATA) return [];
    var out = [];
    if (Array.isArray(DATA.rows)) out = out.concat(DATA.rows);
    if (Array.isArray(DATA.live)) out = out.concat(DATA.live);
    var sa = DATA.set_aside || DATA.setAside;
    if (Array.isArray(sa)) out = out.concat(sa);
    return out;
  }

  function dataset() {
    if (!DATA) return [];
    if (state.tab === "live") {
      if (Array.isArray(DATA.live) && DATA.live.length) return DATA.live.slice();
      return (DATA.rows || []).filter(function (r) { return r.token_status === "live"; });
    }
    if (state.tab === "set_aside") {
      var sa = DATA.set_aside || DATA.setAside;
      if (Array.isArray(sa) && sa.length) return sa.slice();
      return (DATA.rows || []).filter(function (r) { return r.set_aside_reason; });
    }
    return (DATA.rows || []).slice();
  }

  function filteredRows() {
    var rows = dataset();
    var q = state.q.trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) {
        var hay = [r.name, r.slug, r.symbol, r.category, r.gecko_id].filter(Boolean).join(" ").toLowerCase();
        return hay.indexOf(q) !== -1;
      });
    }
    if (state.category !== "all") {
      rows = rows.filter(function (r) { return r.category === state.category; });
    }
    if (state.chain !== "all") {
      rows = rows.filter(function (r) {
        var list = chainList(r);
        if (list.length) return list.indexOf(state.chain) !== -1;
        return String(chainCount(r)) === state.chain;
      });
    }
    if (sandboxActive()) {
      rows = rows.slice().sort(function (a, b) {
        var d = computeImplied(b, state.sandbox) - computeImplied(a, state.sandbox);
        if (d) return d;
        return (a.rank || 0) - (b.rank || 0);
      });
    } else if (state.sort === "tvl") {
      rows = rows.slice().sort(function (a, b) { return (Number(b.tvl_usd) || 0) - (Number(a.tvl_usd) || 0); });
    } else if (state.sort === "implied") {
      rows = rows.slice().sort(function (a, b) { return boardImplied(b) - boardImplied(a); });
    } else if (state.sort === "name") {
      rows = rows.slice().sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
    } else if (state.sort === "category") {
      rows = rows.slice().sort(function (a, b) { return String(a.category || "").localeCompare(String(b.category || "")); });
    } else {
      rows = rows.slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
    }
    return rows;
  }

  function renderMeta() {
    if (!DATA) return;
    if (DATA.as_of) $("as-of").textContent = "As of " + DATA.as_of;
    if (DATA.floor_usd !== null && DATA.floor_usd !== undefined) $("floor").textContent = "Floor " + fmtMoney(DATA.floor_usd);
    var ver = "";
    if (DATA.model) ver = typeof DATA.model === "string" ? DATA.model : (DATA.model.version || "");
    if (ver) $("model-ver").textContent = "Model " + ver;
  }

  function renderSpotlight() {
    var host = $("spotlight");
    host.textContent = "";
    if (!DATA || !Array.isArray(DATA.rows)) return;
    var top = DATA.rows.slice().sort(function (a, b) { return boardImplied(b) - boardImplied(a); }).slice(0, 3);
    top.forEach(function (row, i) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "spot-card";
      card.setAttribute("data-slug", row.slug || "");
      var rank = document.createElement("div");
      rank.className = "spot-rank";
      rank.textContent = "SPOTLIGHT #" + (i + 1) + " · RANK " + (row.rank || "");
      var name = document.createElement("div");
      name.className = "spot-name";
      name.textContent = row.name || row.slug || "";
      var imp = document.createElement("div");
      imp.className = "spot-implied";
      imp.textContent = fmtMoney(boardImplied(row));
      var sub = document.createElement("div");
      sub.className = "spot-sub";
      sub.textContent = (row.category || "") + " · TVL " + fmtMoney(row.tvl_usd);
      card.appendChild(rank);
      card.appendChild(name);
      card.appendChild(imp);
      card.appendChild(sub);
      card.addEventListener("click", function () { openDrawer(row.slug); });
      host.appendChild(card);
    });
  }

  function populateSelects() {
    var catSel = $("category");
    var chainSel = $("chain");
    var cats = {};
    var chains = {};
    allRows().forEach(function (r) {
      if (r.category) cats[r.category] = true;
      chainList(r).forEach(function (c) { chains[c] = true; });
      if (!chainList(r).length && typeof r.chains === "number") chains[String(r.chains)] = true;
    });
    var catKeys = Object.keys(cats).sort();
    var chainKeys = Object.keys(chains).sort();
    catSel.textContent = "";
    chainSel.textContent = "";
    var allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All categories";
    catSel.appendChild(allOpt);
    catKeys.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      catSel.appendChild(o);
    });
    var allChain = document.createElement("option");
    allChain.value = "all";
    allChain.textContent = "All chains";
    chainSel.appendChild(allChain);
    chainKeys.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      chainSel.appendChild(o);
    });
    if (state.category !== "all" && catKeys.indexOf(state.category) === -1) {
      var extra = document.createElement("option");
      extra.value = state.category;
      extra.textContent = state.category;
      catSel.appendChild(extra);
    }
    if (state.chain !== "all" && chainKeys.indexOf(state.chain) === -1) {
      var extra2 = document.createElement("option");
      extra2.value = state.chain;
      extra2.textContent = state.chain;
      chainSel.appendChild(extra2);
    }
    catSel.value = state.category;
    chainSel.value = state.chain;
  }

  function renderTable() {
    var tbody = $("rows");
    tbody.textContent = "";
    var rows = filteredRows();
    var showReason = state.tab === "set_aside";
    $("th-reason").hidden = !showReason;
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-slug", row.slug || "");
      tr.setAttribute("data-rank", String(row.rank || ""));
      tr.tabIndex = 0;
      var tvl = Number(row.tvl_usd) || 0;
      var imp = sandboxActive() ? computeImplied(row, state.sandbox) : boardImplied(row);
      var multiple = tvl ? imp / tvl : 0;

      var cRank = document.createElement("td");
      cRank.textContent = row.rank === null || row.rank === undefined ? "" : String(row.rank);
      tr.appendChild(cRank);

      var cName = document.createElement("td");
      cName.textContent = row.name || row.slug || "";
      if (row.symbol) {
        var sym = document.createElement("span");
        sym.className = "sym";
        sym.textContent = row.symbol;
        cName.appendChild(sym);
      }
      tr.appendChild(cName);

      var cCat = document.createElement("td");
      cCat.textContent = row.category || "";
      tr.appendChild(cCat);

      var cTvl = document.createElement("td");
      cTvl.textContent = fmtMoney(tvl);
      tr.appendChild(cTvl);

      var cImp = document.createElement("td");
      cImp.className = "implied";
      var num = document.createElement("span");
      num.className = "num";
      num.textContent = fmtMoney(imp);
      cImp.appendChild(num);
      tr.appendChild(cImp);

      var cMult = document.createElement("td");
      cMult.textContent = tvl ? multiple.toFixed(2) + "×" : "—";
      tr.appendChild(cMult);

      var cWatch = document.createElement("td");
      if (row.on_watchlist) {
        var badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "★ Watchlist";
        cWatch.appendChild(badge);
      }
      tr.appendChild(cWatch);

      if (showReason) {
        var cReason = document.createElement("td");
        cReason.className = "reason";
        cReason.textContent = row.set_aside_reason || "";
        tr.appendChild(cReason);
      }

      tr.addEventListener("click", function () { openDrawer(row.slug); });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter") openDrawer(row.slug);
      });
      tbody.appendChild(tr);
    });

    var count = $("count");
    var text = rows.length + " rows shown";
    if (sandboxActive()) text += " — sandbox what-if";
    count.textContent = text;
  }

  function renderTabs() {
    var tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-tab") === state.tab ? "true" : "false");
    });
  }

  function renderSandboxLabels() {
    $("sb-base").value = String(state.sandbox.base);
    $("sb-growth").value = String(state.sandbox.growth);
    $("sb-maturity").value = String(state.sandbox.maturity);
    $("sb-base-val").textContent = Number(state.sandbox.base).toFixed(2);
    $("sb-growth-val").textContent = Number(state.sandbox.growth).toFixed(2);
    $("sb-maturity-val").textContent = Number(state.sandbox.maturity).toFixed(2);
  }

  function renderAll() {
    renderMeta();
    populateSelects();
    renderSpotlight();
    renderTabs();
    renderSandboxLabels();
    renderTable();
  }

  function buildHash() {
    var parts = [];
    if (state.tab !== "pre") parts.push("tab=" + encodeURIComponent(state.tab));
    if (state.q) parts.push("q=" + encodeURIComponent(state.q));
    if (state.category !== "all") parts.push("category=" + encodeURIComponent(state.category));
    if (state.chain !== "all") parts.push("chain=" + encodeURIComponent(state.chain));
    if (state.sort !== "rank") parts.push("sort=" + encodeURIComponent(state.sort));
    if (state.openSlug) parts.push("p=" + encodeURIComponent(state.openSlug));
    return parts.join("&");
  }

  function syncHash() {
    var h = buildHash();
    var url = h ? "#" + h : "#";
    try { window.history.replaceState(null, "", url); } catch (e) { /* keep rendering even if hash write fails */ }
  }

  function parseHash() {
    var raw = window.location.hash ? window.location.hash.slice(1) : "";
    var out = { tab: "pre", q: "", category: "all", chain: "all", sort: "rank", p: null };
    if (!raw) return out;
    raw.split("&").forEach(function (pair) {
      var eq = pair.indexOf("=");
      if (eq === -1) return;
      var k = decodeURIComponent(pair.slice(0, eq));
      var v = decodeURIComponent(pair.slice(eq + 1));
      if (k === "tab" && (v === "pre" || v === "live" || v === "set_aside")) out.tab = v;
      else if (k === "q") out.q = v;
      else if (k === "category") out.category = v;
      else if (k === "chain") out.chain = v;
      else if (k === "sort") out.sort = v;
      else if (k === "p") out.p = v;
    });
    return out;
  }

  function applyHash() {
    var h = parseHash();
    state.tab = h.tab;
    state.q = h.q;
    state.category = h.category;
    state.chain = h.chain;
    state.sort = h.sort || "rank";
    state.openSlug = h.p;
    $("q").value = state.q;
    renderAll();
    if (state.openSlug) openDrawer(state.openSlug, true);
    else closeDrawer(true);
  }

  function findRow(slug) {
    if (!slug) return null;
    var found = null;
    allRows().forEach(function (r) { if (r.slug === slug && !found) found = r; });
    return found;
  }

  function openDrawer(slug, silent) {
    var row = findRow(slug);
    var drawer = $("drawer");
    var body = $("drawer-body");
    if (!row) {
      closeDrawer(silent);
      return;
    }
    state.openSlug = slug;
    var f = factors(row, state.sandbox);
    var board = boardImplied(row);
    var recomputed = computeImplied(row, state.sandbox);
    var diff = recomputed - board;
    var match = diff === 0;
    var tvl = Number(row.tvl_usd) || 0;

    body.textContent = "";
    var h3 = document.createElement("h3");
    h3.textContent = row.name || row.slug || "";
    body.appendChild(h3);
    var meta = document.createElement("p");
    meta.textContent = "Rank " + (row.rank || "") + " · " + (row.category || "") + " · " + (row.slug || "");
    body.appendChild(meta);

    var hMult = document.createElement("h4");
    hMult.textContent = "Model multipliers";
    body.appendChild(hMult);
    var dl = document.createElement("dl");
    var mults = [
      ["Base multiple", f.base],
      ["Growth multiplier", f.growth],
      ["Maturity multiplier", f.maturity],
      ["Breadth multiplier", f.breadth]
    ];
    mults.forEach(function (pair) {
      var dt = document.createElement("dt");
      dt.textContent = pair[0];
      var dd = document.createElement("dd");
      dd.textContent = Number(pair[1]).toFixed(4);
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    body.appendChild(dl);
    if (row.model) {
      var modelNote = document.createElement("p");
      modelNote.textContent = "Board model: base " + (row.model.base_multiple !== undefined ? row.model.base_multiple : "") +
        ", growth " + (row.model.growth_multiplier !== undefined ? row.model.growth_multiplier : "") +
        ", maturity " + (row.model.maturity_multiplier !== undefined ? row.model.maturity_multiplier : "") +
        ", breadth " + (row.model.breadth_multiplier !== undefined ? row.model.breadth_multiplier : "");
      body.appendChild(modelNote);
    }

    var hChain = document.createElement("h4");
    hChain.textContent = "Chains";
    body.appendChild(hChain);
    var list = chainList(row);
    if (list.length) {
      var ul = document.createElement("ul");
      ul.className = "chain-list";
      list.forEach(function (c) {
        var li = document.createElement("li");
        li.textContent = c;
        ul.appendChild(li);
      });
      body.appendChild(ul);
    } else {
      var chainP = document.createElement("p");
      chainP.textContent = chainCount(row) + " chain(s)";
      body.appendChild(chainP);
    }

    var hImp = document.createElement("h4");
    hImp.textContent = "Implied value check";
    body.appendChild(hImp);
    var formula = document.createElement("p");
    formula.textContent = "Recomputed with the page formula: implied = TVL × base × growth × maturity × breadth. TVL " + fmtMoney(tvl) + ", change 7d " + (row.change_7d === null || row.change_7d === undefined ? "n/a" : String(row.change_7d)) + ", age " + ageOf(row) + " days.";
    body.appendChild(formula);
    var dl2 = document.createElement("dl");
    var checks = [
      ["Board implied", fmtMoney(board)],
      ["Recomputed implied", fmtMoney(recomputed)],
      ["Difference", (diff >= 0 ? "+" : "-") + fmtMoney(Math.abs(diff))]
    ];
    checks.forEach(function (pair) {
      var dt = document.createElement("dt");
      dt.textContent = pair[0];
      var dd = document.createElement("dd");
      dd.textContent = pair[1];
      dl2.appendChild(dt);
      dl2.appendChild(dd);
    });
    body.appendChild(dl2);
    var verdict = document.createElement("p");
    verdict.className = match ? "match" : "mismatch";
    verdict.textContent = match ? "Match: recomputed implied matches the board value." : "Mismatch: recomputed implied differs from the board value by " + fmtMoney(Math.abs(diff)) + ".";
    body.appendChild(verdict);

    var hFarm = document.createElement("h4");
    hFarm.textContent = "Farm steps";
    body.appendChild(hFarm);
    var ol = document.createElement("ol");
    var steps = Array.isArray(row.farm_steps) ? row.farm_steps : [];
    steps.forEach(function (s) {
      var li = document.createElement("li");
      li.textContent = s;
      ol.appendChild(li);
    });
    body.appendChild(ol);
    if (row.set_aside_reason) {
      var hReason = document.createElement("h4");
      hReason.textContent = "Set aside reason";
      body.appendChild(hReason);
      var rp = document.createElement("p");
      rp.textContent = row.set_aside_reason;
      body.appendChild(rp);
    }

    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    if (!silent) syncHash();
  }

  function closeDrawer(silent) {
    state.openSlug = null;
    var drawer = $("drawer");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    if (!silent) syncHash();
  }

  function bindEvents() {
    $("q").addEventListener("input", function () {
      state.q = $("q").value;
      syncHash();
      renderTable();
    });
    $("category").addEventListener("change", function () {
      state.category = $("category").value;
      syncHash();
      renderTable();
    });
    $("chain").addEventListener("change", function () {
      state.chain = $("chain").value;
      syncHash();
      renderTable();
    });
    document.querySelectorAll(".tab").forEach(function (b) {
      b.addEventListener("click", function () {
        state.tab = b.getAttribute("data-tab");
        renderTabs();
        syncHash();
        renderTable();
      });
    });
    document.querySelectorAll(".sort").forEach(function (b) {
      b.addEventListener("click", function () {
        state.sort = b.getAttribute("data-sort");
        syncHash();
        renderTable();
      });
    });
    function onSlider() {
      state.sandbox.base = parseFloat($("sb-base").value);
      state.sandbox.growth = parseFloat($("sb-growth").value);
      state.sandbox.maturity = parseFloat($("sb-maturity").value);
      renderSandboxLabels();
      renderTable();
      if (state.openSlug) openDrawer(state.openSlug, true);
    }
    ["sb-base", "sb-growth", "sb-maturity"].forEach(function (id) {
      $(id).addEventListener("input", onSlider);
      $(id).addEventListener("change", onSlider);
    });
    $("sb-reset").addEventListener("click", function () {
      state.sandbox = { base: OFFICIAL.base, growth: OFFICIAL.growth, maturity: OFFICIAL.maturity };
      renderSandboxLabels();
      renderTable();
      if (state.openSlug) openDrawer(state.openSlug, true);
    });
    $("drawer-close").addEventListener("click", function () { closeDrawer(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDrawer(false);
    });
    window.addEventListener("hashchange", function () { applyHash(); });
  }

  function init() {
    bindEvents();
    var tries = 0;
    (function wait() {
      if (window.RADAR) {
        DATA = window.RADAR;
        applyHash();
        return;
      }
      tries += 1;
      if (tries < 40) {
        setTimeout(wait, 150);
      } else {
        DATA = { rows: [], live: [], set_aside: [] };
        applyHash();
      }
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
