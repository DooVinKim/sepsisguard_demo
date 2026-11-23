/* SepsisGuard 정적 시연 대시보드
 * - 데이터: data/data.js (window.DEMO_DATA, 작성자가 미리 계산. 이 파일에서 값을 만들거나 바꾸지 않는다)
 * - 화면은 조회·표시만 한다. 모르는 필드는 무시한다.
 */
(function () {
  "use strict";

  var D = window.DEMO_DATA;
  if (!D) { document.body.innerHTML = "<p style='padding:20px'>data/data.js 를 불러오지 못했습니다.</p>"; return; }
  var META = D.meta || {};
  var TH = META.thresholds || { high: 0.61, moderate: 0.39 };
  var AGENT_TH = (TH && TH.agent) || {};
  var HORIZON = META.horizon_hours || 4;
  var INFO = D.model_info || {};

  var TIER_LABEL = { HIGH: "고위험", MODERATE: "중간위험", LOW: "저위험" };
  var TIER_ACTION = { HIGH: "책임의사 즉시 확인", MODERATE: "관찰 목록", LOW: "일상 모니터링" };
  var TIER_COLOR = { HIGH: "#e5484d", MODERATE: "#f5a623", LOW: "#30a46c" };
  var VITAL_COLOR = "#6366f1", EMR_COLOR = "#0ea5e9", CULT_COLOR = "#a855f7";
  var STATUS_LABEL = { ack: "확인함", watch: "관찰 목록", dismiss: "기각" };

  // ── 상태 (브라우저 메모리에만 유지, 새로고침 시 초기화) ──
  var patients = D.patients || [];
  var PMAP = {};
  patients.forEach(function (p) { PMAP[p.id] = p; });
  var state = {
    tab: "ward",
    pid: patients.length ? patients[0].id : null,
    t: {},          // pid → 현재 시점
    status: {},     // pid → ack / watch / dismiss
    filter: "all"
  };

  // ── 유틸 ──
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function scoreInt(x) { return Math.round((+x || 0) * 100); }
  function tierLabel(t) { return TIER_LABEL[t] || t || "—"; }
  function pill(t, text) { return '<span class="pill ' + esc(t) + '">' + esc(text || tierLabel(t)) + "</span>"; }
  function fmt(x, nd) {
    if (x == null || isNaN(+x)) return "—";
    var v = +x;
    if (nd == null) nd = Math.abs(v) >= 100 ? 0 : 1;
    return v.toFixed(nd).replace(/\.0+$/, "");
  }
  function signed(x, nd) { var v = (+x).toFixed(nd == null ? 3 : nd); return (x > 0 ? "+" : x < 0 ? "−" : "±") + v.replace("-", ""); }
  function times(pid) {
    var tr = D.trajectories[pid] || {};
    return Object.keys(tr).map(Number).filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
  }
  function curT(pid) {
    pid = pid || state.pid;
    if (state.t[pid] == null) {
      var p = PMAP[pid], ts = times(pid);
      state.t[pid] = (p && p.default_t != null && ts.indexOf(p.default_t) >= 0) ? p.default_t : ts[ts.length - 1];
    }
    return state.t[pid];
  }
  function result(pid, t) { var tr = D.trajectories[pid] || {}; return tr[String(t)] || null; }
  function cur() { return result(state.pid, curT()); }
  function tierAction(tier) {
    var tiers = INFO.tiers || [];
    for (var i = 0; i < tiers.length; i++) if (tiers[i].tier === tier && tiers[i].action) return tiers[i].action;
    return TIER_ACTION[tier] || "";
  }
  function el(id) { return document.getElementById(id); }
  function widthOf(node, fallback) { var w = node && node.clientWidth; return w && w > 50 ? w : (fallback || 800); }

  // ── 상단 고지·하단 ──
  function renderChrome() {
    var disc = META.disclaimer || "가상 환자 · 미리 계산된 결과 · 연구용 (진단 대체 불가)";
    el("notice").innerHTML = "⚠ <b>가상 데이터</b> · " + esc(disc);
    var models = META.models || {};
    var mrows = Object.keys(models).map(function (k) { return esc(models[k]); }).join(" · ");
    el("foot").innerHTML =
      "<div>" + esc(disc) + "</div>" +
      "<div style='margin-top:4px'>모델: " + mrows + "</div>" +
      "<div style='margin-top:4px'>데이터 버전 " + esc(META.schema_version || "") + " · 계산일 " + esc(META.generated_at || "") +
      " · 모든 환자는 가상 환자이며 결과는 미리 계산된 값입니다. 화면의 확인·기각 상태는 저장되지 않습니다.</div>";
    // 휴대폰에서 고지 배지 높이만큼 아래에 환자·시점 막대를 고정
    document.documentElement.style.setProperty("--notice-h", el("notice").offsetHeight + "px");
  }

  // ── 탭 전환 ──
  function setTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll(".tabs button"), function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-tab") === tab ? "true" : "false");
    });
    ["ward", "process", "report", "about"].forEach(function (k) { el("tab-" + k).hidden = k !== tab; });
    el("ctx").hidden = !(tab === "process" || tab === "report");
    render();
    syncHash();
  }
  function selectPatient(pid, tab) {
    if (!PMAP[pid]) return;
    state.pid = pid;
    if (tab) setTab(tab); else render();
    syncHash();
  }
  function setT(t) {
    var ts = times(state.pid);
    if (ts.indexOf(t) < 0) return;
    state.t[state.pid] = t;
    render();
    syncHash();
  }
  function syncHash() {
    var h = "#" + state.tab + (state.tab === "process" || state.tab === "report" ? "/" + state.pid + "/" + curT() : "");
    try { history.replaceState(null, "", h); } catch (e) { /* file:// 일부 환경 */ }
  }
  function readHash() {
    var parts = (location.hash || "").replace(/^#/, "").split("/");
    if (["ward", "process", "report", "about"].indexOf(parts[0]) >= 0) state.tab = parts[0];
    if (parts[1] && PMAP[parts[1]]) {
      state.pid = parts[1];
      var t = parseInt(parts[2], 10);
      if (!isNaN(t) && times(state.pid).indexOf(t) >= 0) state.t[state.pid] = t;
    }
  }

  // ── 환자·시점 막대 ──
  function renderCtx() {
    var box = el("ctxPatients");
    box.innerHTML = patients.map(function (p) {
      var r = result(p.id, curT(p.id));
      var col = r ? TIER_COLOR[r.tier] : "#999";
      return '<button class="pchip" data-pid="' + esc(p.id) + '" aria-pressed="' + (p.id === state.pid) + '" title="' + esc(p.scenario) + '">' +
        '<span class="dot" style="background:' + col + '"></span>' + esc(p.id) + "</button>";
    }).join("");
    var ts = times(state.pid), t = curT();
    var s = el("tSlider");
    s.min = 0; s.max = Math.max(0, ts.length - 1); s.step = 1; s.value = ts.indexOf(t);
    var r = cur(), p = PMAP[state.pid];
    el("tLabel").innerHTML = "시점 T = <b>입실 후 " + t + "h</b>" +
      (p && t === p.default_t ? ' <span class="faint small">(기본)</span>' : "") +
      (r ? " " + pill(r.tier, tierLabel(r.tier) + " " + scoreInt(r.fusion_score)) : "");
    el("tPrev").disabled = ts.indexOf(t) <= 0;
    el("tNext").disabled = ts.indexOf(t) >= ts.length - 1;
  }

  // ── 위험 추이 그래프 (SVG) ──
  function trendSVG(pid, T, W) {
    var ts = times(pid);
    var H = W < 520 ? 190 : 220, L = 34, R = 12, TOP = 12, B = 26;
    var x0 = ts[0], x1 = ts[ts.length - 1];
    function x(t) { return L + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)) * (W - L - R); }
    function y(s) { return TOP + (1 - s / 100) * (H - TOP - B); }
    var hi = scoreInt(TH.high), mo = scoreInt(TH.moderate);
    var o = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="위험 점수 추이">';
    o += '<rect x="' + L + '" y="' + y(100) + '" width="' + (W - L - R) + '" height="' + (y(hi) - y(100)) + '" fill="' + TIER_COLOR.HIGH + '" opacity=".08"/>';
    o += '<rect x="' + L + '" y="' + y(hi) + '" width="' + (W - L - R) + '" height="' + (y(mo) - y(hi)) + '" fill="' + TIER_COLOR.MODERATE + '" opacity=".09"/>';
    o += '<rect x="' + L + '" y="' + y(mo) + '" width="' + (W - L - R) + '" height="' + (y(0) - y(mo)) + '" fill="' + TIER_COLOR.LOW + '" opacity=".07"/>';
    [0, 50, 100].forEach(function (v) { o += '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" font-size="10.5" text-anchor="end">' + v + "</text>"; });
    [[hi, TIER_COLOR.HIGH, "고위험 " + hi], [mo, TIER_COLOR.MODERATE, "중간위험 " + mo]].forEach(function (a) {
      o += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(a[0]) + '" y2="' + y(a[0]) + '" stroke="' + a[1] + '" stroke-dasharray="5 4" stroke-width="1.3"/>';
      o += '<text x="' + (L + 4) + '" y="' + (y(a[0]) - 4) + '" font-size="10.5" text-anchor="start" style="fill:' + a[1] + ';font-weight:700">' + a[2] + "</text>";
    });
    var step = (x1 - x0) > 30 ? 6 : 4;
    for (var tt = Math.ceil(x0 / step) * step; tt <= x1; tt += step) {
      o += '<text x="' + x(tt) + '" y="' + (H - 8) + '" font-size="10.5" text-anchor="middle">' + tt + "h</text>";
    }
    // 현재 시점
    o += '<line x1="' + x(T) + '" x2="' + x(T) + '" y1="' + TOP + '" y2="' + (H - B) + '" stroke="currentColor" stroke-width="1.5" opacity=".55"/>';
    var pts = ts.map(function (t) { var r = result(pid, t); return [x(t), y(scoreInt(r.fusion_score)), r, t]; });
    o += '<polyline fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="2" points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>';
    pts.forEach(function (p) {
      var isCur = p[3] === T;
      o += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (isCur ? 6.5 : 3.4) + '" fill="' + TIER_COLOR[p[2].tier] + '"' +
        (isCur ? ' stroke="currentColor" stroke-width="2.2"' : "") + '><title>' + p[3] + "h · 위험 점수 " + scoreInt(p[2].fusion_score) + " · " + tierLabel(p[2].tier) + "</title></circle>";
    });
    var rc = result(pid, T);
    var lx = Math.min(Math.max(x(T), L + 40), W - R - 40);
    o += '<text x="' + lx + '" y="' + Math.max(y(scoreInt(rc.fusion_score)) - 12, 11) + '" font-size="12" text-anchor="middle" style="fill:currentColor;font-weight:800">' + scoreInt(rc.fusion_score) + "</text>";
    o += "</svg>";
    return o;
  }
  function trendCard(pid, T, id) {
    return '<div class="card trend-card"><h4>위험 점수 추이 · 그래프를 눌러 시점 이동</h4><div class="chart-wrap" id="' + id + '" data-chart="trend"></div>' +
      '<div class="legend"><span><i style="background:' + TIER_COLOR.HIGH + '"></i>고위험 ≥ ' + scoreInt(TH.high) + '</span><span><i style="background:' + TIER_COLOR.MODERATE + '"></i>중간위험 ≥ ' + scoreInt(TH.moderate) +
      '</span><span><i style="background:' + TIER_COLOR.LOW + '"></i>저위험</span><span>세로선 = 현재 시점 T · 점수는 보정 전 상대 점수 (확률 아님)</span></div></div>';
  }
  function mountTrend(id) {
    var box = el(id);
    if (!box) return;
    var W = widthOf(box, 800);
    box.innerHTML = trendSVG(state.pid, curT(), W);
    var svg = box.querySelector("svg");
    svg.style.cursor = "pointer";
    svg.addEventListener("click", function (ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) * (W / rect.width);
      var ts = times(state.pid), best = ts[0], bd = 1e9, L = 34, R = 12, x0 = ts[0], x1 = ts[ts.length - 1];
      ts.forEach(function (t) { var xx = L + (t - x0) / Math.max(1, x1 - x0) * (W - L - R); var d = Math.abs(xx - px); if (d < bd) { bd = d; best = t; } });
      setT(best);
    });
  }

  // ── ① 입력 시간축 ──
  function labGroups(p) {
    var g = {}, out = [];
    ((p.inputs && p.inputs.labs) || []).forEach(function (l) {
      var k = l.t_drawn + "|" + l.t_result;
      if (!g[k]) { g[k] = { t_drawn: l.t_drawn, t_result: l.t_result, items: [] }; out.push(g[k]); }
      g[k].items.push(l);
    });
    return out.sort(function (a, b) { return a.t_drawn - b.t_drawn; });
  }
  function inputState(t0, t1, T) { return t1 <= T ? "used" : (t0 <= T ? "pending" : "future"); }
  function inputSVG(p, T, W) {
    var ts = times(p.id);
    var H = 186, L = 58, R = 14, TOP = 18, B = 24;
    var xmax = Math.max(ts[ts.length - 1], 1), xmin = 0;
    function x(t) { return L + (t - xmin) / (xmax - xmin) * (W - L - R); }
    var rows = { v: 44, l: 84, c: 120, i: 156 };
    var USED = "#0f766e", PEND = TIER_COLOR.MODERATE, FUT = "var(--unknown)";
    var o = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="시점 T 기준 입력 시간축">';
    // T 이후: 아직 모르는 정보
    if (T < xmax) {
      o += '<rect x="' + x(T) + '" y="' + (TOP - 6) + '" width="' + (x(xmax) - x(T) + 4) + '" height="' + (H - TOP - B + 10) + '" fill="var(--unknown-bg)"/>';
      o += '<text x="' + ((x(T) + x(xmax)) / 2) + '" y="' + (TOP + 2) + '" font-size="11" text-anchor="middle">아직 모르는 정보</text>';
    }
    [["바이탈", rows.v], ["검사", rows.l], ["배양", rows.c], ["영상", rows.i]].forEach(function (r) {
      o += '<text x="8" y="' + (r[1] + 4) + '" font-size="12" style="font-weight:700;fill:var(--text)">' + r[0] + "</text>";
      o += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + r[1] + '" y2="' + r[1] + '" stroke="var(--line)"/>';
    });
    for (var tt = 0; tt <= xmax; tt += (W < 520 ? 12 : 6)) o += '<text x="' + x(tt) + '" y="' + (H - 6) + '" font-size="10.5" text-anchor="middle">' + tt + "h</text>";
    // 바이탈 점
    ((p.inputs && p.inputs.vitals) || []).forEach(function (v) {
      var used = v.t <= T;
      o += '<circle cx="' + x(v.t).toFixed(1) + '" cy="' + rows.v + '" r="3.2" fill="' + (used ? VITAL_COLOR : FUT) + '"><title>바이탈 ' + fmt(v.t, 1) + "h" + (used ? "" : " · T 이후") + "</title></circle>";
    });
    // 검사 (채혈 → 결과 저장)
    labGroups(p).forEach(function (g) {
      var st = inputState(g.t_drawn, g.t_result, T), col = st === "used" ? USED : st === "pending" ? PEND : FUT;
      var names = g.items.map(function (i) { return i.name; }).join(", ");
      var tip = "채혈 " + fmt(g.t_drawn, 1) + "h → 결과 저장 " + fmt(g.t_result, 1) + "h · " + names + (st === "used" ? " · 판단에 사용" : st === "pending" ? " · 결과 대기 (사용 안 함)" : " · T 이후");
      o += '<g><title>' + esc(tip) + "</title>";
      o += '<line x1="' + x(g.t_drawn) + '" x2="' + x(g.t_result) + '" y1="' + rows.l + '" y2="' + rows.l + '" stroke="' + col + '" stroke-width="3"' + (st === "pending" ? ' stroke-dasharray="3 2"' : "") + "/>";
      o += '<circle cx="' + x(g.t_drawn) + '" cy="' + rows.l + '" r="4" fill="var(--panel)" stroke="' + col + '" stroke-width="2"/>';
      o += '<rect x="' + (x(g.t_result) - 5) + '" y="' + (rows.l - 5) + '" width="10" height="10" transform="rotate(45 ' + x(g.t_result) + " " + rows.l + ')" fill="' + (st === "pending" ? "var(--panel)" : col) + '" stroke="' + col + '" stroke-width="2"/>';
      if (st === "pending") o += '<text x="' + x(g.t_result) + '" y="' + (rows.l - 10) + '" font-size="10.5" text-anchor="middle" style="fill:' + PEND + ';font-weight:700">결과 대기</text>';
      o += "</g>";
    });
    // 배양 (채취 → 결과 저장). 채취 사실은 채취 시점부터 판단에 쓰이고, 균 결과는 결과 저장 후부터 쓰임
    ((p.inputs && p.inputs.cultures) || []).forEach(function (c, ci) {
      var res0 = cultRes(c);
      if (c.t_collected < xmin) {   // 입실 전 채취 (예: 병동에서 채취 후 ICU 전동)
        var inWin = T - c.t_collected <= 72, done0 = c.t_resulted != null && c.t_resulted <= T, col0 = inWin ? CULT_COLOR : FUT;
        var tip0 = "입실 전 배양 채취 (" + fmt(c.t_collected, 1) + "h) · " + c.specimen + (done0 ? " → 결과 " + fmt(c.t_resulted, 1) + "h: " + res0 : " · 결과 대기") +
          (inWin ? " · 최근 72h 안이라 판단에 사용" : " · 72h 이전 기록이라 이 시점 판단에는 쓰이지 않음");
        o += '<g><title>' + esc(tip0) + '</title><path d="M' + (x(xmin) + 1) + " " + rows.c + " l8 -6 v12 z" + '" fill="' + col0 + '"/>' +
          '<text x="' + (x(xmin) + 13) + '" y="' + (rows.c + 4) + '" font-size="10.5" style="fill:' + col0 + ';font-weight:700">입실 전 배양 ' + fmt(c.t_collected, 0) + "h · " + esc(done0 ? res0 : "결과 대기") + (inWin ? "" : " (72h 밖)") + "</text></g>";
        return;
      }
      if (c.t_collected > T) {
        o += '<g><title>' + esc("배양 채취 " + fmt(c.t_collected, 1) + "h · " + c.specimen + " · T 이후") + '</title><circle cx="' + x(c.t_collected) + '" cy="' + rows.c + '" r="4" fill="var(--panel)" stroke="' + FUT + '" stroke-width="2"/></g>';
        return;
      }
      var done = c.t_resulted != null && c.t_resulted <= T;
      var end = done ? c.t_resulted : (c.t_resulted != null ? Math.min(c.t_resulted, T) : T);
      var res = cultRes(c);
      var tip = "배양 채취 " + fmt(c.t_collected, 1) + "h · " + c.specimen + (done ? " → 결과 저장 " + fmt(c.t_resulted, 1) + "h: " + res + " · 판단에 사용" : " · 결과 대기 (채취 사실만 판단에 사용)");
      var yy = rows.c + (ci % 2 ? 5 : -5);
      o += '<g><title>' + esc(tip) + "</title>";
      o += '<line x1="' + x(c.t_collected) + '" x2="' + x(end) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + CULT_COLOR + '" stroke-width="3"' + (done ? "" : ' stroke-dasharray="3 2"') + "/>";
      o += '<circle cx="' + x(c.t_collected) + '" cy="' + yy + '" r="4" fill="var(--panel)" stroke="' + CULT_COLOR + '" stroke-width="2"/>';
      if (done) o += '<rect x="' + (x(c.t_resulted) - 5) + '" y="' + (yy - 5) + '" width="10" height="10" transform="rotate(45 ' + x(c.t_resulted) + " " + yy + ')" fill="' + CULT_COLOR + '" stroke="' + CULT_COLOR + '" stroke-width="2"/>';
      o += "</g>";
    });
    // 영상 (촬영 → 판독 저장)
    ((p.inputs && p.inputs.imaging) || []).forEach(function (im) {
      var st = inputState(im.t_exam, im.t_report, T), col = st === "used" ? EMR_COLOR : st === "pending" ? PEND : FUT;
      var tip = "촬영 " + fmt(im.t_exam, 1) + "h → 판독 저장 " + fmt(im.t_report, 1) + "h" + (st === "used" ? " · 판단에 사용" : st === "pending" ? " · 판독 대기 (사용 안 함)" : " · T 이후") + "\n" + (im.impression || "");
      o += '<g><title>' + esc(tip) + "</title>";
      o += '<line x1="' + x(im.t_exam) + '" x2="' + x(im.t_report) + '" y1="' + rows.i + '" y2="' + rows.i + '" stroke="' + col + '" stroke-width="3"' + (st === "pending" ? ' stroke-dasharray="3 2"' : "") + "/>";
      o += '<circle cx="' + x(im.t_exam) + '" cy="' + rows.i + '" r="4" fill="var(--panel)" stroke="' + col + '" stroke-width="2"/>';
      o += '<rect x="' + (x(im.t_report) - 5) + '" y="' + (rows.i - 5) + '" width="10" height="10" transform="rotate(45 ' + x(im.t_report) + " " + rows.i + ')" fill="' + (st === "pending" ? "var(--panel)" : col) + '" stroke="' + col + '" stroke-width="2"/>';
      if (st === "pending") o += '<text x="' + x(im.t_report) + '" y="' + (rows.i - 10) + '" font-size="10.5" text-anchor="middle" style="fill:' + PEND + ';font-weight:700">판독 대기</text>';
      o += "</g>";
    });
    // T 선
    o += '<line x1="' + x(T) + '" x2="' + x(T) + '" y1="' + (TOP - 6) + '" y2="' + (H - B + 4) + '" stroke="currentColor" stroke-width="2"/>';
    var tx = Math.min(Math.max(x(T), L + 20), W - R - 20);
    o += '<rect x="' + (tx - 24) + '" y="' + (TOP - 14) + '" width="48" height="16" rx="8" fill="currentColor"/>';
    o += '<text x="' + tx + '" y="' + (TOP - 2) + '" font-size="11" text-anchor="middle" style="fill:var(--panel);font-weight:800">T ' + T + "h</text>";
    o += "</svg>";
    return o;
  }
  function inputSummary(p, T) {
    var vit = ((p.inputs && p.inputs.vitals) || []).filter(function (v) { return v.t <= T; }).length;
    var groups = labGroups(p);
    var used = groups.filter(function (g) { return g.t_result <= T; });
    var pend = groups.filter(function (g) { return g.t_drawn <= T && g.t_result > T; });
    var imgs = ((p.inputs && p.inputs.imaging) || []);
    var imgUsed = imgs.filter(function (i) { return i.t_report <= T; });
    var imgPend = imgs.filter(function (i) { return i.t_exam <= T && i.t_report > T; });
    var culUsed = ((p.inputs && p.inputs.cultures) || []).filter(function (c) { return c.t_collected <= T && T - c.t_collected <= 72; });
    var o = '<div class="io-sum">' +
      "<div>바이탈 측정 <b>" + vit + "</b>회<br><span class='faint small'>T 까지 기록된 값</span></div>" +
      "<div>검사 결과 <b>" + used.length + "</b>회분 <span class='faint small'>(" + used.reduce(function (a, g) { return a + g.items.length; }, 0) + "항목)</span><br><span class='faint small'>결과 저장 시각 ≤ T 인 것만</span></div>" +
      "<div>배양 <b>" + culUsed.length + "</b>건 <span class='faint small'>(결과 " + culUsed.filter(function (c) { return c.t_resulted != null && c.t_resulted <= T; }).length + "건 · 대기 " + culUsed.filter(function (c) { return !(c.t_resulted != null && c.t_resulted <= T); }).length + "건)</span><br><span class='faint small'>최근 72h 채취 · 균 결과는 저장 후부터</span></div>" +
      "<div>영상 판독 <b>" + imgUsed.length + "</b>건<br><span class='faint small'>판독 저장 시각 ≤ T 인 것만</span></div></div>";
    pend.forEach(function (g) {
      o += '<div class="pending-box">⏳ <b>결과 대기</b> · ' + fmt(g.t_drawn, 1) + "h 채혈 " + g.items.length + "항목 (" + esc(g.items.map(function (i) { return i.name; }).join(", ")) +
        ") → 결과 저장 " + fmt(g.t_result, 1) + "h 예정. <b>T " + T + "h 에는 아직 모르는 정보라 판단에 쓰지 않습니다.</b></div>";
    });
    imgPend.forEach(function (i) {
      o += '<div class="pending-box">⏳ <b>판독 대기</b> · ' + fmt(i.t_exam, 1) + "h 촬영 → 판독 저장 " + fmt(i.t_report, 1) + "h 예정. T " + T + "h 에는 판단에 쓰지 않습니다.</div>";
    });
    // 이번 시점에 막 도착한 결과 (T-1 < t_result ≤ T)
    var arrived = groups.filter(function (g) { return g.t_result <= T && g.t_result > T - 1 && g.t_drawn < g.t_result; });
    arrived.forEach(function (g) {
      o += '<div class="arrived-box">✅ <b>이번 시점에 결과 저장</b> · ' + fmt(g.t_drawn, 1) + "h 채혈 검사 결과가 " + fmt(g.t_result, 1) + "h 에 저장되어 T " + T + "h 판단부터 반영됩니다 (" +
        esc(g.items.map(function (i) { return i.name + " " + fmt(i.value) + " " + (i.unit || ""); }).join(", ")) + ").</div>";
    });
    return o;
  }

  // ── ② 바이탈 에이전트 ──
  var VITAL_FEATS = [
    ["HR", "심박수", "/min"], ["SBP", "수축기 혈압", "mmHg"], ["RR", "호흡수", "/min"], ["SpO2", "산소포화도", "%"],
    ["Temp", "체온", "°C"], ["MAP", "평균 혈압", "mmHg"], ["DBP", "이완기 혈압", "mmHg"], ["SI", "쇼크 지수", "HR/SBP"]
  ];
  function attStats(r) {
    var a = r.vital_attention || [], max = 0, idx = [];
    a.forEach(function (v, i) { if (v != null && v > max) max = v; idx.push(i); });
    idx.sort(function (i, j) { return (a[j] || 0) - (a[i] || 0); });
    return { att: a, max: max || 1, top: idx.slice(0, 3).filter(function (i) { return (a[i] || 0) > 0 && r.vital_window[i]; }) };
  }
  function miniVitalSVG(r, key, st) {
    var w = r.vital_window || [], n = w.length || 24, W = 200, H = 46, P = 4;
    var vals = w.map(function (row) { return row && row[key] != null ? +row[key] : null; });
    var nn = vals.filter(function (v) { return v != null; });
    var o = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">';
    var cw = W / n;
    st.att.forEach(function (a, i) {
      if (w[i] == null) o += '<rect x="' + (i * cw) + '" y="0" width="' + cw + '" height="' + H + '" fill="var(--unknown-bg)"/>';
      else if (a) o += '<rect x="' + (i * cw) + '" y="0" width="' + cw + '" height="' + H + '" fill="' + VITAL_COLOR + '" opacity="' + (0.45 * a / st.max).toFixed(3) + '"/>';
    });
    if (nn.length) {
      var mn = Math.min.apply(null, nn), mx = Math.max.apply(null, nn);
      if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
      var pts = [];
      vals.forEach(function (v, i) { if (v != null) pts.push([(i + 0.5) * cw, P + (1 - (v - mn) / (mx - mn)) * (H - 2 * P)]); });
      o += '<polyline fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>';
      pts.forEach(function (p) { o += '<rect x="' + (p[0] - 1.2) + '" y="' + (p[1] - 1.2) + '" width="2.4" height="2.4" fill="currentColor"/>'; });
    }
    o += "</svg>";
    return o;
  }
  function vitalGrid(r, feats) {
    var st = attStats(r), w = r.vital_window || [];
    return '<div class="vgrid' + (feats.length === 6 ? ' v6' : '') + '">' + feats.map(function (f) {
      var vals = w.map(function (row) { return row && row[f[0]] != null ? row[f[0]] : null; });
      var nn = vals.filter(function (v) { return v != null; });
      var last = nn.length ? nn[nn.length - 1] : null;
      var miss = vals.filter(function (v, i) { return w[i] && v == null; }).length;
      return '<div class="vmini"><div class="h"><span>' + f[1] + '</span><b>' + (last == null ? "—" : fmt(last, f[0] === "SI" ? 2 : 1)) + '</b></div>' +
        miniVitalSVG(r, f[0], st) +
        '<div class="h"><span class="faint">' + esc(f[2]) + "</span><span class='faint'>" + (miss ? "측정 " + nn.length + "/" + w.filter(function (x) { return x; }).length + "칸" : "") + "</span></div></div>";
    }).join("") + "</div>";
  }
  function attStrip(r) {
    var st = attStats(r), w = r.vital_window || [], n = st.att.length || 24, W = 600, H = 54, B = 14;
    var cw = W / n;
    var o = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-label="시간대별 attention">';
    st.att.forEach(function (a, i) {
      var h = (H - B) * (a || 0) / st.max;
      var top = st.top.indexOf(i) >= 0;
      if (w[i] == null) o += '<rect x="' + (i * cw + 1) + '" y="0" width="' + (cw - 2) + '" height="' + (H - B) + '" fill="var(--unknown-bg)"/>';
      o += '<rect x="' + (i * cw + 1) + '" y="' + (H - B - h) + '" width="' + (cw - 2) + '" height="' + h + '" fill="' + VITAL_COLOR + '" opacity="' + (top ? 1 : 0.45) + '"><title>' + (w[i] ? w[i].h + "h" : "기록 없음") + " · attention " + fmt((a || 0) * 100, 1) + "</title></rect>";
    });
    o += "</svg>";
    return o;
  }
  function attLabels(r) {
    var w = r.vital_window || [], n = w.length;
    var first = null; for (var i = 0; i < n; i++) if (w[i]) { first = w[i].h; break; }
    var last = n && w[n - 1] ? w[n - 1].h : null;
    return '<div class="h small faint" style="display:flex;justify-content:space-between"><span>' + (first != null ? first + "h" : "") + "</span><span>← 직전 " + n + "개 측정 칸 →</span><span>" + (last != null ? (last === 0 ? "T (0h)" : last + "h") : "") + "</span></div>";
  }
  function vitalTopText(r) {
    var st = attStats(r);
    var hs = st.top.slice().sort(function (a, b) { return a - b; }).map(function (i) { var h = r.vital_window[i].h; return h === 0 ? "0h (T)" : h + "h"; });
    return hs.length ? hs.join(", ") : "—";
  }
  function agentThText(kind) {
    var a = AGENT_TH[kind];
    if (!a) return "";
    return "에이전트 자체 기준: 고위험 ≥ " + fmt(a.high, 3) + " · 중간 ≥ " + fmt(a.moderate, 3);
  }

  // ── ③ EMR 에이전트 ──
  function docHTML(txt) {
    var section = "";
    return String(txt || "").split("\n").map(function (line) {
      var e = esc(line);
      if (/^[A-Z][^:]*:\s*$/.test(line) || /^[A-Z][^-].*\):\s*$/.test(line)) { section = line; return '<span class="sec">' + e + "</span>"; }
      if (/^No /.test(line)) return '<span class="none">' + e + "</span>";
      if (/\(HIGH\b/.test(line)) return '<span class="hi">' + e + "</span>";
      if (/\(LOW\b/.test(line)) return '<span class="lo">' + e + "</span>";
      if (/imaging/i.test(section) && /^- /.test(line)) return '<span class="img">' + e + "</span>";
      return e;
    }).join("\n");
  }
  function sectionEffectHTML(r, p) {
    var se = r.emr_section_effect;
    var rows = [["labs", "검사"], ["cultures", "배양"], ["imaging", "영상"]].filter(function (k) { return se && se[k[0]] != null; });
    if (!rows.length) {
      var note = se ? "이 시점 문서에는 계산할 섹션(검사·배양·영상)이 없습니다." : "섹션 기여도는 각 환자의 기본 시점(" + p.default_t + "h)에서만 계산되어 있습니다.";
      var btn = (!se && p.default_t !== curT()) ? ' <button class="btn" data-goto-t="' + p.default_t + '" style="padding:2px 10px;font-size:12.5px">' + p.default_t + "h 로 이동</button>" : "";
      return '<div class="small muted">' + note + btn + "</div>";
    }
    var mx = Math.max.apply(null, rows.map(function (k) { return Math.abs(se[k[0]]); }).concat([0.05]));
    return rows.map(function (k) {
      var v = se[k[0]], drive = v < 0;
      var w = Math.max(2, Math.abs(v) / mx * 100);
      return '<div class="sect-row ' + (drive ? "drive" : "minor") + '"><span class="nm">' + k[1] + '</span><div class="bar"><span style="width:' + w + "%;background:" + (drive ? TIER_COLOR.HIGH : "var(--faint)") + '"></span></div>' +
        '<span class="txt num">' + (drive ? "점수를 올린 근거 · 빼면 " + signed(v) : "빼면 " + signed(v)) + "</span></div>";
    }).join("") + '<div class="small faint" style="margin-top:4px">섹션을 문서에서 빼고 다시 읽었을 때의 EMR 점수 변화. 음수(빼면 내려감) = 그 섹션이 점수를 올리고 있었음.</div>';
  }

  // ── ④ 합동 심문 해석 ──
  function isRisk(t) { return t === "HIGH" || t === "MODERATE"; }
  function jointSentence(r, p) {
    var labs = (p.inputs && p.inputs.labs) || [];
    var ft = tierLabel(r.tier);
    var josa = r.tier === "HIGH" ? "으로" : "으로";
    if (!labs.length) return "검사 기록이 없어 <b>바이탈 근거에 더 의존</b>했습니다 (근거 참고 비율 바이탈 " + Math.round(r.agent_dependency.vital * 100) + "%). 최종 " + ft + josa + " 판정했습니다.";
    if (r.conflict && r.vital_tier === "HIGH") {
      if (r.tier === "HIGH") return "바이탈만 보면 고위험이고 검사 소견은 정상이지만, 합동 심문이 두 근거를 함께 따져 <b>고위험을 유지</b>했습니다.";
      return "바이탈만 보면 고위험이지만 검사 소견이 정상이라, <b>합동 심문이 경보 수준을 낮췄습니다</b> (최종 " + ft + ").";
    }
    if (r.vital_tier === "LOW" && isRisk(r.emr_tier)) {
      if (r.tier === "LOW") return "EMR 이 검사 이상을 짚었지만 바이탈이 안정적이어서, 합동 심문이 두 근거를 함께 따져 저위험으로 판정했습니다.";
      return "바이탈은 아직 안정적이지만 <b>검사 악화를 EMR 이 잡아 위험을 올렸습니다</b> (최종 " + ft + ").";
    }
    if (isRisk(r.vital_tier) && isRisk(r.emr_tier)) return "바이탈과 EMR 이 <b>모두 위험 쪽</b>을 가리켜 " + ft + josa + " 판정했습니다.";
    if (!isRisk(r.vital_tier) && !isRisk(r.emr_tier)) return "바이탈과 EMR 이 <b>모두 안정 쪽</b>을 가리켜 " + ft + josa + " 판정했습니다.";
    return "바이탈은 " + tierLabel(r.vital_tier) + ", EMR 은 " + tierLabel(r.emr_tier) + " 쪽을 가리켜, 합동 심문이 두 근거를 함께 따져 " + ft + josa + " 판정했습니다.";
  }
  function depSplit(dep) {
    var v = Math.round((dep.vital || 0) * 100), e = 100 - v;
    return '<div class="dep-split" role="img" aria-label="근거 참고 비율 바이탈 ' + v + "%, EMR " + e + '%">' +
      '<span style="width:' + v + "%;background:" + VITAL_COLOR + '">바이탈 ' + v + "%</span>" +
      '<span style="width:' + e + "%;background:" + EMR_COLOR + ';justify-content:flex-end">EMR ' + e + "%</span></div>";
  }
  function relText(r) { return r.conflict ? '<span class="pill conflict">충돌</span>' : (r.vital_tier === r.emr_tier ? '<span class="pill agree">일치</span>' : '<span class="pill ghost">부분 일치</span>'); }

  // ── ⑤ 책임 의사 규칙 모듈 ──
  function ruleHTML(g) {
    g = g || {};
    var flags = g.lab_flags || [], q = g.qsofa_items || [];
    var sigCol = g.rule_signal === "강함" ? TIER_COLOR.HIGH : g.rule_signal === "약함" ? TIER_COLOR.MODERATE : "var(--faint)";
    var o = '<ul class="rule-list">';
    o += "<li><span class='" + (flags.length ? "ok" : "no") + "'>" + (flags.length ? "✔" : "–") + "</span><span><b>검사 플래그</b> (lab 5종) · " +
      (flags.length ? flags.map(function (f) { return esc(f.name) + " " + fmt(f.value) + " <span class='faint small'>(" + esc(f.meaning) + ")</span>"; }).join(", ") : "<span class='faint'>해당 없음</span>") + "</span></li>";
    o += "<li><span class='" + (q.length ? "ok" : "no") + "'>" + (q.length ? "✔" : "–") + "</span><span><b>qSOFA 항목</b> " + (g.qsofa_count != null ? g.qsofa_count : q.length) + "/2 · " +
      (q.length ? q.map(esc).join(", ") : "<span class='faint'>해당 없음</span>") + " <span class='faint small'>(의식 상태 미포함)</span></span></li>";
    o += "</ul>";
    o += '<div style="margin-top:8px">규칙 신호 <span class="chip" style="background:' + sigCol + ';color:#fff">' + esc(g.rule_signal || "—") + "</span></div>";
    if (g.note) o += '<div class="small faint" style="margin-top:4px">' + esc(g.note) + "</div>";
    return o;
  }

  // ── 탭 2: 판단 과정 ──
  function renderProcess() {
    var p = PMAP[state.pid], T = curT(), r = cur();
    var box = el("tab-process");
    if (!r) { box.innerHTML = "<p>결과 없음</p>"; return; }
    var dep = r.agent_dependency || { vital: 0.5, emr: 0.5 };
    var h = "";
    h += '<div class="tab-head"><h2>' + esc(p.id) + " · " + esc(p.scenario) + ' <span class="muted" style="font-size:14px;font-weight:500">' + esc(p.name) + " · " + p.age + "세 · " + (p.gender === "M" ? "남" : p.gender === "F" ? "여" : esc(p.gender)) + "</span></h2>" +
      "<p>" + esc(p.description) + "</p></div>";
    h += trendCard(p.id, T, "trendProcess");
    h += '<div class="flow">';
    // ①
    h += '<div class="card stage full"><div class="stage-head"><span class="stage-no">1</span><h3>시점 T 의 입력</h3><span class="what">T 이전에 저장된 정보만 사용 · 미래 정보 차단</span></div>' +
      '<div class="chart-wrap" id="inputChart"></div>' +
      '<div class="io-legend"><span><i style="background:' + VITAL_COLOR + '"></i>바이탈 측정</span><span><i style="background:#0f766e"></i>검사 (○ 채혈 → ◆ 결과 저장)</span><span><i style="background:' + CULT_COLOR + '"></i>배양 (○ 채취 → ◆ 결과 저장, 점선 = 결과 대기)</span><span><i style="background:' + EMR_COLOR + '"></i>영상 (○ 촬영 → ◆ 판독 저장)</span><span><i style="background:' + TIER_COLOR.MODERATE + '"></i>결과 대기 (사용 안 함)</span><span><i style="background:var(--unknown)"></i>T 이후 · 아직 모르는 정보</span></div>' +
      inputSummary(p, T) + "</div>";
    h += '<div class="arrow-down">▼ 같은 시점 T 의 입력이 두 에이전트에 각각 들어갑니다 ▼</div>';
    // ②
    h += '<div class="card stage vital"><div class="stage-head"><span class="stage-no">2</span><h3>바이탈 에이전트</h3><span class="what">시계열 모델 (LSTM + attention)</span>' +
      '<span class="right">' + pill(r.vital_tier) + "</span></div>" +
      '<div class="agent-score"><span class="n num">' + fmt(r.vital_score, 3) + '</span><span class="small muted">바이탈 점수 · ' + agentThText("vital") + "</span></div>" +
      '<div class="small muted" style="margin:8px 0 6px">직전 ' + (r.vital_window || []).length + "개 측정 칸 · 보라색 음영이 진할수록 모델이 더 주목한 시간대 · 회색 칸 = 기록 없음 (값을 채우지 않고 마스크로 처리)</div>" +
      vitalGrid(r, VITAL_FEATS) +
      '<div class="att-strip" style="margin-top:10px"><div class="small muted">시간대별 attention (결정적 시간대 강조)</div>' + attStrip(r) + attLabels(r) + "</div>" +
      '<div class="explain">결정적 시간대 (attention 상위): <b>' + vitalTopText(r) + "</b></div></div>";
    // ③
    h += '<div class="card stage emr"><div class="stage-head"><span class="stage-no">3</span><h3>EMR 에이전트</h3><span class="what">검사·배양·영상을 영문 문서 한 장으로 만들어 의료 언어모델이 읽음</span>' +
      '<span class="right">' + pill(r.emr_tier) + "</span></div>" +
      '<div class="agent-score"><span class="n num">' + fmt(r.emr_score, 3) + '</span><span class="small muted">EMR 점수 · ' + agentThText("emr") + "</span></div>" +
      '<div class="small muted" style="margin:8px 0 6px">모델에 실제로 들어간 문서 (가상) · <span class="c-HIGH">빨강 = HIGH</span> · <span style="color:var(--lo-mark)">파랑 = LOW</span></div>' +
      '<pre class="doc">' + docHTML(r.emr_document) + "</pre>" +
      '<h4 style="margin:14px 0 6px">섹션 기여도 · 어떤 섹션이 판단을 움직였나</h4>' + sectionEffectHTML(r, p) + "</div>";
    h += '<div class="arrow-down">▼ 두 에이전트의 판단을 합동 심문으로 교차 검증 ▼</div>';
    // ④
    h += '<div class="card stage joint full"><div class="stage-head"><span class="stage-no">4</span><h3>합동 심문</h3><span class="what">두 에이전트의 근거를 attention 으로 교차 참조 (단순 평균이 아님)</span>' +
      '<span class="right">' + relText(r) + "</span></div>" +
      '<div class="joint-grid">' +
      '<div class="agent-box vital"><div class="l">바이탈 에이전트</div><div class="t c-' + r.vital_tier + '">' + tierLabel(r.vital_tier) + '</div><div class="s num">점수 ' + fmt(r.vital_score, 3) + "</div></div>" +
      '<div class="merge">⟶</div>' +
      '<div class="agent-box emr"><div class="l">EMR 에이전트</div><div class="t c-' + r.emr_tier + '">' + tierLabel(r.emr_tier) + '</div><div class="s num">점수 ' + fmt(r.emr_score, 3) + "</div></div>" +
      '<div class="merge">⟶</div>' +
      '<div class="fused-box"><div class="small muted">합동 심문 결과</div><div class="t c-' + r.tier + '">위험 점수 ' + scoreInt(r.fusion_score) + '</div><div class="small">' + pill(r.tier) + "</div></div>" +
      "</div>" +
      '<h4 style="margin:14px 0 6px">근거 참고 비율 (attention)</h4>' + depSplit(dep) +
      '<div class="small faint" style="margin-top:4px">합동 심문이 각 에이전트의 근거를 참고한 비율입니다. 인과적 기여도가 아닙니다. 두 에이전트 점수는 크기 기준이 달라 각자의 기준으로 등급을 매겨 비교합니다.</div>' +
      '<div class="explain">' + jointSentence(r, p) + "</div></div>";
    h += '<div class="arrow-down">▼</div>';
    // ⑤
    h += '<div class="card stage rule"><div class="stage-head"><span class="stage-no">5</span><h3>책임 의사 모듈</h3><span class="what">규칙 모듈 · Sepsis-3 관련 지표와 한 번 더 대조</span></div>' +
      ruleHTML(r.guideline) + "</div>";
    // ⑥
    h += '<div class="card stage" style="border-top:4px solid ' + TIER_COLOR[r.tier] + '"><div class="stage-head"><span class="stage-no">6</span><h3>판정</h3><span class="what">' + HORIZON + "시간 이내 패혈증 발병 위험</span></div>" +
      '<div class="verdict-card"><div><div class="big c-' + r.tier + '">' + tierLabel(r.tier) + " · 위험 점수 " + scoreInt(r.fusion_score) + "</div>" +
      '<div class="muted">권고: <b style="color:var(--text)">' + esc(tierAction(r.tier)) + "</b></div></div>" +
      '<button class="btn primary" data-goto-tab="report" style="margin-left:auto">리포트 보기 →</button></div></div>';
    h += "</div>";
    box.innerHTML = h;
    mountTrend("trendProcess");
    var ic = el("inputChart");
    ic.innerHTML = inputSVG(p, T, widthOf(ic, 900));
  }

  // ── 탭 3: 의료진 리포트 ──
  function alertElapsed(pid, T) {
    var ts = times(pid), i = ts.indexOf(T);
    var r = result(pid, T);
    if (!r || r.tier !== "HIGH") return null;
    var start = T, j = i;
    while (j - 1 >= 0 && result(pid, ts[j - 1]).tier === "HIGH") { j--; start = ts[j]; }
    return { start: start, elapsed: T - start, fromBeginning: j === 0 };
  }
  function refRange(p, name) {
    var labs = (p.inputs && p.inputs.labs) || [];
    for (var i = 0; i < labs.length; i++) if (labs[i].name === name && labs[i].ref_low != null) return fmt(labs[i].ref_low) + "–" + fmt(labs[i].ref_high);
    return "";
  }
  function labsHTML(r, p) {
    var labs = r.abnormal_labs || [];
    if (!labs.length) return '<div class="small faint">T 이전에 결과가 저장된 이상 검사 없음</div>';
    var TR = { rising: "↑ 상승", falling: "↓ 하강", stable: "→ 유지" };
    return labs.map(function (l) {
      var hi = l.flag === "HIGH", col = hi ? "var(--high)" : "var(--lo-mark)";
      var rr = refRange(p, l.name);
      return '<div class="labrow"><span class="nm" style="color:' + col + '">' + (hi ? "▲ " : "▼ ") + esc(l.name) + '</span><span class="num">' + fmt(l.value) + " " + esc(l.unit || "") + "</span>" +
        (rr ? '<span class="rf">정상 ' + rr + "</span>" : "") + '<span class="ct">' + (l.trend ? TR[l.trend] || esc(l.trend) : "") + (l.hours_ago != null ? " · " + fmt(l.hours_ago) + "h 전" : "") + "</span></div>";
    }).join("");
  }
  function cultRes(c) {   // 화면 표시용 결과 문구 (모델 입력 문서는 영문 그대로)
    if (c.organisms) return c.organisms;
    var m = String(c.comment || "");
    if (/no growth/i.test(m)) return "균 자람 없음";
    if (/no mrsa/i.test(m)) return "MRSA 음성";
    return m || "균 보고 없음";
  }
  function culturesHTML(r) {
    return (r.cultures || []).map(function (c) {
      var res = c.status === "pending" ? "결과 대기" : (c.organisms || "균 보고 없음");
      return '<div class="labrow"><span class="nm" style="color:' + CULT_COLOR + '">◆ 배양 ' + esc(c.spec_type_desc) + "</span><span>" + esc(res) + '</span><span class="ct">' + fmt(c.hours_ago) + "h 전 채취</span></div>";
    }).join("");
  }
  function gaugeHTML(r) {
    var s = scoreInt(r.fusion_score), col = TIER_COLOR[r.tier];
    var hi = scoreInt(TH.high), mo = scoreInt(TH.moderate);
    return '<div class="gauge-num" style="color:' + col + '">위험 점수 ' + s + ' <small>· ' + tierLabel(r.tier) + "</small></div>" +
      '<div class="gauge"><div class="gauge-track"><div class="gauge-fill" style="width:' + s + "%;background:" + col + '"></div></div>' +
      '<div class="gauge-tick" style="left:' + mo + '%"><span>중간 ' + mo + "</span></div>" +
      '<div class="gauge-tick" style="left:' + hi + '%"><span>고위험 ' + hi + "</span></div></div>" +
      '<div class="small muted" style="margin-top:6px">' + HORIZON + "시간 이내 패혈증 발병 위험 (합동 심문) · 0–100 상대 점수, 확률 아님</div>";
  }
  function depRowsHTML(dep) {
    return [["바이탈", dep.vital || 0, VITAL_COLOR], ["EMR", dep.emr || 0, EMR_COLOR]].map(function (a) {
      return '<div class="dep-row"><span class="lab">' + a[0] + '</span><div class="dep-bar"><span style="width:' + Math.round(a[1] * 100) + "%;background:" + a[2] + '"></span></div><span class="val">' + Math.round(a[1] * 100) + "%</span></div>";
    }).join("") + '<div class="small faint">합동 심문이 각 에이전트 근거를 참고한 비율 (인과적 기여도 아님)</div>';
  }
  function renderReport() {
    var p = PMAP[state.pid], T = curT(), r = cur();
    var box = el("tab-report");
    if (!r) { box.innerHTML = "<p>결과 없음</p>"; return; }
    var s = scoreInt(r.fusion_score);
    var h = "";
    h += '<div class="banner ' + r.tier + '">[' + tierLabel(r.tier) + "] 위험 점수 " + s + " · " + HORIZON + "시간 이내 패혈증 발병 위험 · " + esc(TIER_ACTION[r.tier]) +
      '<span class="rec">' + esc(p.id) + " (" + esc(p.name) + ", " + p.age + "세 " + (p.gender === "M" ? "남" : "여") + ") · 입실 후 " + T + "h 기준 · 권고: " + esc(tierAction(r.tier)) + "</span></div>";
    h += '<div class="metrics">' +
      '<div class="metric"><div class="l">융합 위험 점수</div><div class="v c-' + r.tier + '">' + s + '</div><div class="d">' + tierLabel(r.tier) + " (고위험 ≥ " + scoreInt(TH.high) + ")</div></div>" +
      '<div class="metric"><div class="l">바이탈 에이전트</div><div class="v c-' + r.vital_tier + '">' + tierLabel(r.vital_tier) + '</div><div class="d num">점수 ' + fmt(r.vital_score, 3) + "</div></div>" +
      '<div class="metric"><div class="l">EMR 에이전트</div><div class="v c-' + r.emr_tier + '">' + tierLabel(r.emr_tier) + '</div><div class="d num">점수 ' + fmt(r.emr_score, 3) + "</div></div>" +
      '<div class="metric"><div class="l">판단 관계</div><div class="v">' + (r.conflict ? "충돌" : "일치") + '</div><div class="d">' + (r.conflict ? "한쪽 고위험 · 다른 쪽 저위험" : "큰 불일치 없음") + "</div></div></div>";
    h += trendCard(p.id, T, "trendReport");
    // 확인 버튼
    var stt = state.status[p.id];
    var ae = alertElapsed(p.id, T);
    var alertTxt = ae ? "고위험 경보 후 " + ae.elapsed + "시간 경과" + (ae.fromBeginning ? " (표시 구간 시작부터)" : " (" + ae.start + "h 경보)") + " · 경보 후 3시간 안 확인 권고" :
      (r.tier === "MODERATE" ? "중간위험 · 관찰 목록 등록 권장" : "저위험 · 일상 모니터링");
    var actions = '<div class="card"><div class="actions">' +
      '<button class="btn" data-status="ack" aria-pressed="' + (stt === "ack") + '">✔ 확인</button>' +
      '<button class="btn" data-status="watch" aria-pressed="' + (stt === "watch") + '">👁 관찰 목록</button>' +
      '<button class="btn" data-status="dismiss" aria-pressed="' + (stt === "dismiss") + '">✕ 기각</button>' +
      '<span class="ack-note">' + (stt ? "상태: <b>" + STATUS_LABEL[stt] + "</b> · " : "") + esc(alertTxt) + '</span></div><div class="small faint" style="margin-top:6px">시연용 버튼 · 상태는 이 브라우저 화면에만 유지되고 저장되지 않습니다 (새로고침 시 초기화).</div></div>';
    h += '<div class="report-grid"><div>';
    h += '<div class="card"><h4>위험 게이지</h4>' + gaugeHTML(r) + "</div>";
    h += '<div class="card"><h4>에이전트 의존도 · 근거 참고 비율</h4>' + depRowsHTML(r.agent_dependency || {}) + "</div>";
    h += '<div class="card"><h4>바이탈 · 직전 ' + (r.vital_window || []).length + "개 측정 칸 + attention 음영</h4>" + vitalGrid(r, VITAL_FEATS.slice(0, 4).concat([VITAL_FEATS[4]]).concat([VITAL_FEATS[7]])) +
      '<div class="small muted" style="margin-top:8px">결정적 시간대: <b>' + vitalTopText(r) + "</b></div></div>";
    h += '<div class="card"><h4>이상 검사 · EMR 근거</h4>' + labsHTML(r, p) + culturesHTML(r) +
      ((r.imaging && r.imaging.hours_ago != null) ? '<div class="labrow"><span class="nm" style="color:var(--emr)">◆ 영상 판독</span><span>있음</span><span class="ct">' + fmt(r.imaging.hours_ago) + "h 전 촬영</span></div>" : "") +
      '<h4 style="margin:14px 0 6px">EMR 섹션 기여도</h4>' + sectionEffectHTML(r, p) + "</div>";
    h += '<div class="card"><h4>Sepsis-3 관련 지표 대조 (규칙 모듈)</h4>' + ruleHTML(r.guideline) + "</div>";
    h += "</div><div>";
    h += actions;
    var mdParts = String(r.report_md || "").split("<!-- details -->");
    h += '<div class="report-pane"><div class="report-label">책임 의사 리포트 · 엔진이 생성한 원문</div>' + renderMd(mdParts[0]) +
      (mdParts[1] ? '<details class="doc-details" style="margin-top:10px"><summary>세부 수치 (왼쪽 카드와 같은 근거)</summary>' + renderMd(mdParts[1]) + "</details>" : "") + "</div>";
    h += '<div class="card" style="margin-top:14px"><details class="doc-details"><summary>EMR 에이전트 입력 문서 (가상) — 실제로 모델에 들어간 영문 문서</summary><pre class="doc" style="max-height:none">' + docHTML(r.emr_document) + "</pre></details></div>";
    h += "</div></div>";
    box.innerHTML = h;
    mountTrend("trendReport");
  }
  function renderMd(md) {
    if (window.marked && typeof window.marked.parse === "function") return window.marked.parse(String(md || ""));
    return "<pre>" + esc(md) + "</pre>";
  }

  // ── 탭 1: 병동 현황 ──
  function sparkSVG(pid, T) {
    var ts = times(pid), W = 260, H = 38, P = 3;
    var x0 = ts[0], x1 = ts[ts.length - 1];
    function x(t) { return P + (t - x0) / Math.max(1, x1 - x0) * (W - 2 * P); }
    function y(s) { return P + (1 - s / 100) * (H - 2 * P); }
    var o = '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">';
    [[TH.high, TIER_COLOR.HIGH], [TH.moderate, TIER_COLOR.MODERATE]].forEach(function (a) {
      o += '<line x1="0" x2="' + W + '" y1="' + y(scoreInt(a[0])) + '" y2="' + y(scoreInt(a[0])) + '" stroke="' + a[1] + '" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".7"/>';
    });
    o += '<polyline fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" points="' +
      ts.filter(function (t) { return t <= T; }).map(function (t) { return x(t).toFixed(1) + "," + y(scoreInt(result(pid, t).fusion_score)).toFixed(1); }).join(" ") + '"/>';
    o += '<polyline fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="1.2" vector-effect="non-scaling-stroke" points="' +
      ts.filter(function (t) { return t >= T; }).map(function (t) { return x(t).toFixed(1) + "," + y(scoreInt(result(pid, t).fusion_score)).toFixed(1); }).join(" ") + '"/>';
    var r = result(pid, T);
    o += '<circle cx="' + x(T) + '" cy="' + y(scoreInt(r.fusion_score)) + '" r="3" fill="' + TIER_COLOR[r.tier] + '"/>';
    return o + "</svg>";
  }
  function renderWard() {
    var box = el("tab-ward");
    var rows = patients.map(function (p) { var T = curT(p.id); return { p: p, T: T, r: result(p.id, T) }; });
    var nHigh = rows.filter(function (x) { return x.r.tier === "HIGH"; }).length;
    var nMod = rows.filter(function (x) { return x.r.tier === "MODERATE" || state.status[x.p.id] === "watch"; }).length;
    var nWait = rows.filter(function (x) { return x.r.tier === "HIGH" && !state.status[x.p.id]; }).length;
    var f = state.filter;
    var h = '<div class="tab-head"><h2>가상 병동</h2><p>매 시간 각 환자의 바이탈과 검사 기록으로 ' + HORIZON + '시간 이내 패혈증 발병 위험을 판단합니다. 카드를 누르면 판단 과정을 봅니다.</p></div>';
    h += '<div class="summary">' +
      '<button data-filter="all" aria-pressed="' + (f === "all") + '"><span class="l">전체 환자</span><span class="v">' + rows.length + "</span></button>" +
      '<button data-filter="HIGH" aria-pressed="' + (f === "HIGH") + '"><span class="l">고위험 · 책임의사 확인</span><span class="v c-HIGH">' + nHigh + "</span></button>" +
      '<button data-filter="watch" aria-pressed="' + (f === "watch") + '"><span class="l">관찰 목록 (중간위험 포함)</span><span class="v c-MODERATE">' + nMod + "</span></button>" +
      '<button data-filter="wait" aria-pressed="' + (f === "wait") + '"><span class="l">확인 대기</span><span class="v">' + nWait + "</span></button></div>";
    var shown = rows.filter(function (x) {
      if (f === "HIGH") return x.r.tier === "HIGH";
      if (f === "watch") return x.r.tier === "MODERATE" || state.status[x.p.id] === "watch";
      if (f === "wait") return x.r.tier === "HIGH" && !state.status[x.p.id];
      return true;
    });
    h += '<div class="ward">';
    shown.forEach(function (x) {
      var p = x.p, r = x.r, ts = times(p.id), i = ts.indexOf(x.T);
      var prev = result(p.id, ts[Math.max(0, i - 4)]);
      var d = scoreInt(r.fusion_score) - scoreInt(prev.fusion_score), span = x.T - ts[Math.max(0, i - 4)];
      var arrow = d > 2 ? "↑" : d < -2 ? "↓" : "→";
      var stt = state.status[p.id];
      h += '<div class="pcard ' + r.tier + '" role="button" tabindex="0" data-open="' + esc(p.id) + '">' +
        '<div class="row"><span class="id">' + esc(p.id) + '</span><span class="who">' + esc(p.name) + " · " + p.age + "세 " + (p.gender === "M" ? "남" : "여") + '</span><span style="margin-left:auto">' + pill(r.tier) + "</span></div>" +
        '<div class="scn">' + esc(p.scenario) + "</div>" +
        '<div class="row"><span class="score c-' + r.tier + '">위험 점수 ' + scoreInt(r.fusion_score) + '</span><span class="delta">' + (span ? arrow + " " + Math.abs(d) + " (" + span + "시간 전 대비)" : "") + "</span></div>" +
        sparkSVG(p.id, x.T) +
        '<div class="foot-row"><span>입실 후 ' + x.T + "h · " + esc(TIER_ACTION[r.tier]) + (stt ? ' <span class="status-tag">' + STATUS_LABEL[stt] + "</span>" : (r.tier === "HIGH" ? ' <span class="status-tag">확인 대기</span>' : "")) + "</span>" +
        '<button class="link" data-open-report="' + esc(p.id) + '">리포트 →</button></div></div>';
    });
    if (!shown.length) h += '<div class="muted">해당하는 환자가 없습니다.</div>';
    h += "</div>";
    box.innerHTML = h;
  }

  // ── 탭 4: 시스템 소개 ──
  function renderAbout() {
    var box = el("tab-about");
    var models = META.models || {};
    var h = '<div class="tab-head"><h2>시스템 소개</h2><p>SepsisGuard 가 시점 T 의 정보로 ' + HORIZON + "시간 이내 패혈증 발병 위험을 판단하고 리포트를 만드는 구조입니다.</p></div>";
    h += '<div class="card"><h4>구조</h4><div class="arch">' +
      '<div class="col"><div class="box"><b>시점 T 의 입력</b><span>T 이전에 저장된 바이탈·검사·배양·영상</span></div></div><div class="ar">→</div>' +
      '<div class="col"><div class="box vital"><b>바이탈 에이전트</b><span>' + esc(models.vital || "시계열 모델") + '</span></div><div class="box emr"><b>EMR 에이전트</b><span>' + esc(models.emr || "의료 언어모델") + "</span></div></div><div class=\"ar\">→</div>" +
      '<div class="col"><div class="box joint"><b>합동 심문</b><span>' + esc(models.fusion || "cross-attention") + "</span></div></div><div class=\"ar\">→</div>" +
      '<div class="col"><div class="box rule"><b>책임 의사 모듈</b><span>' + esc(models.physician || "규칙 모듈") + "</span></div></div><div class=\"ar\">→</div>" +
      '<div class="col"><div class="box out"><b>판정 · 의료진 리포트</b><span>등급 · 위험 점수 · 근거 · 권고</span></div></div></div>' +
      '<div class="explain">여기서 "에이전트" 는 각자 판단하는 <b>학습된 예측 모델</b>입니다. 대화형 LLM 이 아니며, 서로 문장으로 대화하지 않고 attention 으로 근거를 교차 참조합니다. 책임 의사 모듈은 정해진 규칙으로 지표를 대조하는 모듈입니다.</div></div>';
    h += '<div class="about-grid">';
    h += '<div class="card"><h4>작동 원리</h4><ol class="how">' + (INFO.how_it_works || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol></div>";
    h += '<div class="card"><h4>등급 기준 (융합 위험 점수)</h4><table class="tier-table"><thead><tr><th>등급</th><th>점수</th><th>조치</th></tr></thead><tbody>' +
      (INFO.tiers || []).map(function (t) {
        return "<tr><td>" + pill(t.tier) + "</td><td class='num'>" + (t.min_score ? "≥ " + scoreInt(t.min_score) : "< " + scoreInt(TH.moderate)) + "</td><td>" + esc(t.action || "") + (t.basis ? "<div class='small faint'>" + esc(t.basis) + "</div>" : "") + "</td></tr>";
      }).join("") + "</tbody></table><div class='small faint' style='margin-top:8px'>임계값은 기관 정책에 따라 조정할 수 있습니다. 점수는 0–100 의 보정 전 상대 점수이며 확률이 아닙니다.</div></div>";
    var test = INFO.test || {};
    h += '<div class="card"><h4>성능 (한 줄)</h4><div>' + esc(test.dataset || "평가") + (test.fusion_auroc != null ? " · 합동 심문 AUROC <b>" + fmt(test.fusion_auroc, 3) + "</b>" : "") + '</div><div class="small faint" style="margin-top:4px">가상 환자 시연 화면의 점수는 이 평가와 별개로 미리 계산된 값입니다.</div></div>';
    h += '<div class="card"><h4>한계 · 고지</h4><ul class="how">' + (INFO.limitations || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "<li>" + esc(META.disclaimer || "") + "</li></ul></div>";
    h += "</div>";
    box.innerHTML = h;
  }

  // ── 렌더 ──
  function render() {
    if (state.tab === "process" || state.tab === "report") renderCtx();
    if (state.tab === "ward") renderWard();
    else if (state.tab === "process") renderProcess();
    else if (state.tab === "report") renderReport();
    else renderAbout();
  }

  // ── 이벤트 ──
  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll(".tabs button"), function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
    });
    el("ctxPatients").addEventListener("click", function (e) {
      var b = e.target.closest("[data-pid]");
      if (b) selectPatient(b.getAttribute("data-pid"));
    });
    el("tSlider").addEventListener("input", function () { var ts = times(state.pid); setT(ts[+this.value]); });
    el("tPrev").addEventListener("click", function () { var ts = times(state.pid), i = ts.indexOf(curT()); if (i > 0) setT(ts[i - 1]); });
    el("tNext").addEventListener("click", function () { var ts = times(state.pid), i = ts.indexOf(curT()); if (i < ts.length - 1) setT(ts[i + 1]); });
    document.querySelector("main").addEventListener("click", function (e) {
      var t = e.target;
      var rep = t.closest("[data-open-report]");
      if (rep) { e.stopPropagation(); selectPatient(rep.getAttribute("data-open-report"), "report"); return; }
      var open = t.closest("[data-open]");
      if (open) { selectPatient(open.getAttribute("data-open"), "process"); window.scrollTo(0, 0); return; }
      var gt = t.closest("[data-goto-tab]");
      if (gt) { setTab(gt.getAttribute("data-goto-tab")); window.scrollTo(0, 0); return; }
      var gtt = t.closest("[data-goto-t]");
      if (gtt) { setT(parseInt(gtt.getAttribute("data-goto-t"), 10)); return; }
      var st = t.closest("[data-status]");
      if (st) { var k = st.getAttribute("data-status"); state.status[state.pid] = state.status[state.pid] === k ? undefined : k; render(); return; }
      var fl = t.closest("[data-filter]");
      if (fl) { state.filter = fl.getAttribute("data-filter"); render(); return; }
    });
    document.querySelector("main").addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open]")) { e.preventDefault(); selectPatient(e.target.getAttribute("data-open"), "process"); }
    });
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { renderChrome(); if (state.tab === "process" || state.tab === "report") render(); }, 150);
    });
  }

  readHash();
  renderChrome();
  bind();
  setTab(state.tab);
})();
