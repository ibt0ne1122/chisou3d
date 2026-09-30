/*
 * 柄（もよう）で「まじっている物」を表す
 *   色＝どの層か（今までどおり）／柄＝その層に何がまじっているか
 *   砂→点　れき→丸　ねんど・シルト→横線　火山灰→Vの字　互層→2つの柄を重ねる
 *   「〇〇質」（かなりまじる）は こく、「〇〇混り」（少しまじる）は まばらに
 */
(function () {
  const C = (window.CHISOU = window.CHISOU || {});
  const IDS = { none: 0, dots: 1, circ: 2, dash: 3, vee: 4 };
  const OF_GRAIN = { sand: "dots", gravel: "circ", mud: "dash", ash: "vee" };
  const NAMES = { dots: "砂がまじる", circ: "れきがまじる", dash: "ねんど・シルトがまじる", vee: "火山灰がまじる", alt: "2種類が交互に重なる（互層）" };
  // 土の名前にふくまれる「つぶ」の言葉
  const GR = [
    ["gravel", /礫|れき|レキ|砂利|玉石/g],
    ["sand", /砂(?!岩)/g],
    ["mud", /シルト(?!岩)|粘土|粘性土|腐植|有機質/g],
    ["ash", /ローム|火山灰|凝灰|軽石|浮石|スコリア/g],
    ["rock", /泥岩|シルト岩|土丹|砂岩|固結/g],
  ];
  // 層そのものの色が表している つぶ（同じつぶの柄は出さない）
  const LAYER_GRAIN = { sand: "sand", gravel: "gravel", clay: "mud", mudstone: "rock", loam: "ash" };

  /** 土の名前 → { id:"dots"など, weak:少しだけか } または null */
  function ofSoil(soil, layer) {
    const s = String(soil || "");
    if (!s || /盛土|埋土|表土|客土|舗装|コンクリート/.test(s)) return null;
    if (/互層/.test(s)) {
      // 互層：ふくまれる2種類の柄を両方重ねる（例：砂・泥岩互層 → 点＋横線）。色の しま にはしない（細かい層と見まちがえるので）
      const ids = [];
      [["circ", /礫|れき|レキ|砂利/], ["dots", /砂/], ["dash", /シルト|粘土|粘性土|泥|土丹/], ["vee", /ローム|火山灰|凝灰|軽石|スコリア/]]
        .map(([id, re]) => ({ id, at: s.search(re) })).filter((o) => o.at >= 0).sort((a, b) => a.at - b.at)
        .forEach((o) => { if (!ids.includes(o.id)) ids.push(o.id); });
      if (!ids.length) return null;
      return { id: ids[0], id2: ids[1] || null, weak: false, alt: true };
    }
    // いちばん後ろに出てくる言葉が主なもの（砂質シルト → シルトが主）
    let main = null, mp = -1;
    const found = [];
    for (const [g, re] of GR) {
      re.lastIndex = 0;
      let m, last = -1;
      while ((m = re.exec(s))) last = m.index;
      if (last >= 0) { found.push({ g, at: last }); if (last > mp) { mp = last; main = g; } }
    }
    if (!main) return null;
    const own = LAYER_GRAIN[layer];
    if (main === "rock" && own === "mud") return null; // 泥岩は ねんどの仲間
    const cand = [];
    // 主なものが、層の色とちがうとき（沖積層の「砂」など）は、主なものの柄
    if (main !== own && OF_GRAIN[main] && !(own === "rock" && main === "mud")) cand.push({ g: main, rank: 3 });
    for (const f of found) {
      if (f.g === main || f.g === own || !OF_GRAIN[f.g]) continue;
      if (own === "rock" && f.g === "mud") continue;
      const after = s.slice(f.at, f.at + 8);
      const weak = /混|まじ|交/.test(after) && !/質/.test(after.slice(0, 5));
      cand.push({ g: f.g, rank: weak ? 1 : 2 });
    }
    if (!cand.length) return null;
    cand.sort((a, b) => b.rank - a.rank);
    return { id: OF_GRAIN[cand[0].g], weak: cand[0].rank === 1 };
  }

  /** 推定の地層（模型）の柄：その層になった資料の中で、いちばん多くまじっている物（25%以上のとき） */
  function ofLayers(layers, bores) {
    const tot = {}, by = {};
    for (const b of bores) for (const sg of b.segs || []) {
      if (!sg.layer || b.sample) continue;
      const t = sg.to - sg.from;
      tot[sg.layer] = (tot[sg.layer] || 0) + t;
      const p = ofSoil(sg.soil, sg.layer);
      if (!p || p.alt) continue;
      const k = sg.layer + ":" + p.id;
      by[k] = (by[k] || 0) + t * (p.weak ? 0.5 : 1);
    }
    return layers.map((l) => {
      if (l.mode === "cover" && l.origin === "human") return null;
      let best = null, bv = 0;
      for (const id in OF_GRAIN) { const k = l.id + ":" + OF_GRAIN[id], v = by[k] || 0; if (v > bv) { bv = v; best = OF_GRAIN[id]; } }
      const share = tot[l.id] ? bv / tot[l.id] : 0;
      return best && share >= 0.25 ? { id: best, weak: share < 0.5, share } : null;
    });
  }

  // ---------- 2D（キャンバス）の柄 ----------
  const cache = {};
  function tile(id, weak) {
    const k = id + (weak ? "w" : "");
    if (cache[k]) return cache[k];
    const n = weak ? 16 : 10, c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d");
    g.strokeStyle = g.fillStyle = "rgba(20,24,28,0.8)";
    g.lineWidth = 1.1;
    if (id === "dots") { g.beginPath(); g.arc(2.5, 2.5, 1.2, 0, 7); if (!weak) g.arc(7.5, 7.5, 1.2, 0, 7); g.fill(); }
    else if (id === "circ") { g.beginPath(); g.arc(n / 2, n / 2, 2.8, 0, 7); g.stroke(); }
    else if (id === "dash") { g.beginPath(); g.moveTo(1, 3); g.lineTo(6, 3); if (!weak) { g.moveTo(6, 8); g.lineTo(10, 8); } g.stroke(); }
    else if (id === "vee") { g.beginPath(); g.moveTo(2, 3); g.lineTo(5, 8); g.lineTo(8, 3); g.stroke(); }
    return (cache[k] = c);
  }
  /** いまのパス（または四角）を柄でぬる */
  function fill2d(ctx, p, rect) {
    if (!p) return;
    for (const id of [p.id, p.id2]) {
      if (!id) continue;
      ctx.save();
      ctx.fillStyle = ctx.createPattern(tile(id, p.weak), "repeat");
      if (rect) ctx.fillRect(rect[0], rect[1], rect[2], rect[3]); else ctx.fill();
      ctx.restore();
    }
  }

  // ---------- SVG の柄 ----------
  function svgDefs() {
    const mk = (id, w, body) => '<pattern id="pt-' + id + '" width="' + w + '" height="' + w + '" patternUnits="userSpaceOnUse">' + body + "</pattern>";
    const k = "#1f2a33";
    return "<defs>" +
      mk("dots", 8, '<circle cx="2" cy="2" r="1.2" fill="' + k + '"/><circle cx="6" cy="6" r="1.2" fill="' + k + '"/>') +
      mk("dotsw", 12, '<circle cx="3" cy="3" r="1.1" fill="' + k + '"/>') +
      mk("circ", 11, '<circle cx="5.5" cy="5.5" r="2.8" fill="none" stroke="' + k + '" stroke-width="1"/>') +
      mk("circw", 17, '<circle cx="5.5" cy="5.5" r="2.8" fill="none" stroke="' + k + '" stroke-width="1"/>') +
      mk("dash", 10, '<path d="M1 3H6M6 8H10" stroke="' + k + '" stroke-width="1.1"/>') +
      mk("dashw", 14, '<path d="M1 4H6" stroke="' + k + '" stroke-width="1.1"/>') +
      mk("vee", 11, '<path d="M2 3L5 8L8 3" fill="none" stroke="' + k + '" stroke-width="1"/>') +
      mk("veew", 16, '<path d="M2 3L5 8L8 3" fill="none" stroke="' + k + '" stroke-width="1"/>') +
      "</defs>";
  }
  /** SVG でぬる柄（互層は2つ） */
  const svgFills = (p) => [p.id, p.id2].filter(Boolean).map((id) => "url(#pt-" + id + (p.weak ? "w" : "") + ")");

  // ---------- 3D（シェーダー）の柄 ----------
  // 頂点に pat（柄の番号, まばらか）と puv（柄の座標：世界の長さ）を持たせ、面の上に柄をかく
  function material3d(base, cell) {
    base.userData.patCell = cell;
    base.onBeforeCompile = (sh) => {
      sh.uniforms.uCell = { value: cell };
      sh.uniforms.uPatOn = { value: 1 };
      base.userData.shader = sh;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 pat;\nattribute vec2 puv;\nvarying vec2 vPat;\nvarying vec2 vPuv;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPat = pat;\nvPuv = puv;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uCell;\nuniform float uPatOn;\nvarying vec2 vPat;\nvarying vec2 vPuv;\n" + GLSL)
        .replace("#include <color_fragment>", "#include <color_fragment>\nif (uPatOn > 0.5 && vPat.x > 0.5) { float id1 = mod(vPat.x + 0.5, 8.0) - 0.5; float id2 = floor((vPat.x + 0.5) / 8.0); diffuseColor.rgb = patApply(diffuseColor.rgb, vPuv / uCell, id1, vPat.y); if (id2 > 0.5) diffuseColor.rgb = patApply(diffuseColor.rgb, vPuv / uCell + vec2(0.25, 0.25), id2, vPat.y); }");
    };
    base.customProgramCacheKey = () => "pat";
    base.extensions = Object.assign(base.extensions || {}, { derivatives: true });
    return base;
  }
  const GLSL = `
float patMask(vec2 q, float id, float weak) {
  vec2 cell = floor(q), f = fract(q);
  if (weak > 0.5 && mod(cell.x + cell.y, 2.0) > 0.5 && id < 4.5) return 0.0;
  if (id < 1.5) { vec2 g = fract(q * 2.0) - 0.5; return 1.0 - smoothstep(0.16, 0.24, length(g)); }
  if (id < 2.5) { float r = length(f - 0.5); return 1.0 - smoothstep(0.03, 0.08, abs(r - 0.27)); }
  if (id < 3.5) { float row = fract(q.y * 2.0); float on = step(0.1, fract(q.x + (floor(q.y * 2.0)) * 0.5)) * step(fract(q.x + (floor(q.y * 2.0)) * 0.5), 0.6); return on * (1.0 - smoothstep(0.06, 0.12, abs(row - 0.5))); }
  if (id < 4.5) { vec2 g = f - vec2(0.5, 0.3); float x = abs(g.x); float d = abs(g.y - x * 1.4) ; return step(x, 0.22) * step(0.0, g.y) * (1.0 - smoothstep(0.04, 0.09, d)); }
  return 0.0;
}
vec3 patApply(vec3 c, vec2 q, float id, float weak) {
  float px = 1.0 / max(max(fwidth(q.x), fwidth(q.y)), 1e-4);
  float fade = smoothstep(5.0, 10.0, px);
  return mix(c, vec3(0.1, 0.12, 0.14), patMask(q, id, weak) * 0.8 * fade);
}`;
  function setOn(mat, on) { if (mat && mat.userData.shader) mat.userData.shader.uniforms.uPatOn.value = on ? 1 : 0; }
  // 3D の頂点にのせる番号：1つ目 + 8×2つ目
  const num = (p) => (p ? IDS[p.id] + 8 * (p.id2 ? IDS[p.id2] : 0) : 0);

  // SVG の柄は、ページに1回だけ置いて使い回す（凡例・柱状図の画面）
  function addDefs() { const d = document.createElement("div"); d.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + svgDefs() + "</svg>"; document.body.appendChild(d.firstChild); }
  if (document.body) addDefs(); else document.addEventListener("DOMContentLoaded", addDefs);

  C.Pattern = { ofSoil, ofLayers, fill2d, svgDefs, svgFills, material3d, setOn, num, NAMES, IDS };
})();
