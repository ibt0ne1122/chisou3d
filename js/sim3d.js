/*
 * 土地のでき方シミュレーター 3D（6年理科「大地のつくり」「変わり続ける大地」＋中学校の内容）
 * 時間 t（0〜1）を下のつまみで動かすと、各場面のようすが変わる。図は指でまわせる。
 * 色と柄は 3D土地模型と同じ（砂＝点、れき＝丸、どろ＝横線、火山灰＝V）
 */
(function () {
  "use strict";
  // ================= 道具 =================
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const lerp = (a, b, u) => a + (b - a) * u;
  const frac = (x) => x - Math.floor(x);
  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const C3 = (h) => new THREE.Color(h);
  const mixC = (a, b, u) => C3(a).lerp(C3(b), clamp(u));
  // 2Dの図（横1000×たて600、下向き）→ 3Dの座標（横±100、上向き）
  const W = (x, y) => [(x - 500) / 5, (300 - y) / 5];
  const XS = (step = 10, a = -20, b = 1020) => { const o = []; for (let x = a; x <= b; x += step) o.push(x); return o; };
  const D = 70, Z0 = -35;
  // 地しん・噴火の「強調」：QI（0〜1）が大きいほど、画面のふちが赤く光り、大きな文字が出る
  let QI = 0, QTXT = "";
  function quake(t, times, amp = 3) {
    for (const q of times) if (t > q && t < q + 0.05) { const k = 1 - (t - q) / 0.05; QI = Math.max(QI, k); QTXT = "ぐらぐらっ！ 地しん"; return Math.sin(t * 1900) * amp * k; }
    return 0;
  }
  function boom(t, a, text) { if (t > a && t < a + 0.05) { QI = Math.max(QI, 1 - (t - a) / 0.05); QTXT = text; } }
  /** 「○万年前」の表し方（時間は むかし → 今 へ進む） */
  function ago(y) {
    if (y < 0.5) return "今";
    if (y >= 1e8) return "約" + (Math.round(y / 1e7) / 10) + "億年前";
    if (y >= 1e4) return "約" + Math.round(y / 1e4) + "万年前";
    if (y >= 1000) return "約" + Math.round(y / 1000) + "千年前";
    return "約" + Math.round(y) + "年前";
  }
  const agoSpan = (span) => (t) => ago(span * (1 - t));

  const COL = {
    gravel: "#c8955a", sand: "#e6cf7e", mud: "#9aa7a2", ash: "#c46a4a", mudstone: "#6b7b8c", rock: "#8b7f74", deep: "#6d625a",
    grass: "#7cb95c", soil: "#8a6a4a", sea: "#4f9fd6", river: "#4aa3df", lava: "#ff5a1f", basalt: "#3f4448", oldrock: "#a89a86",
  };
  const NAME = { gravel: "れき", sand: "砂", mud: "どろ", ash: "火山灰" };

  // ================= 3Dの準備 =================
  const stage = document.getElementById("stage");
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.localClippingEnabled = true;
  renderer.domElement.className = "gl";
  stage.insertBefore(renderer.domElement, stage.firstChild);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdff1fb);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 4000);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.maxPolarAngle = Math.PI * 0.96;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7c88, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.position.set(80, 160, 120); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-120, 60, -60); scene.add(fill);
  let root = new THREE.Group(); scene.add(root);

  // ---- 柄のテクスチャ ----
  const PAT = new Set(["sand", "gravel", "mud", "ash", "mudstone"]);
  const texCache = {};
  function patTex(type, color) {
    const k = type + color;
    if (texCache[k]) return texCache[k];
    const n = 64, c = document.createElement("canvas"); c.width = c.height = n;
    const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, n, n);
    g.strokeStyle = g.fillStyle = "rgba(25,30,35,.5)"; g.lineWidth = 3;
    if (type === "sand") { [[16, 16, 3.2], [48, 48, 3.2], [48, 14, 2.6], [14, 46, 2.6]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }); }
    if (type === "gravel") { g.beginPath(); g.arc(20, 20, 10, 0, 7); g.stroke(); g.beginPath(); g.arc(50, 48, 8, 0, 7); g.stroke(); }
    if (type === "mud" || type === "mudstone") { g.beginPath(); g.moveTo(4, 16); g.lineTo(28, 16); g.moveTo(36, 16); g.lineTo(60, 16); g.moveTo(18, 46); g.lineTo(46, 46); g.stroke(); }
    if (type === "ash") { g.beginPath(); g.moveTo(8, 12); g.lineTo(18, 30); g.lineTo(28, 12); g.moveTo(38, 38); g.lineTo(48, 56); g.lineTo(58, 38); g.stroke(); }
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(1 / 6, 1 / 6);
    tx.anisotropy = 4;
    return (texCache[k] = tx);
  }
  const matCache = {};
  function mat(type, color) {
    const col = color || COL[type] || type, k = type + "|" + col;
    if (matCache[k]) return matCache[k];
    const m = PAT.has(type) ? new THREE.MeshLambertMaterial({ map: patTex(type, col) }) : new THREE.MeshLambertMaterial({ color: col });
    return (matCache[k] = m);
  }
  // 丸い点（パーティクル用）
  const dotTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 32; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.beginPath(); g.arc(16, 16, 14, 0, 7); g.fill(); return new THREE.CanvasTexture(c); })();

  // ---- 場面ごとに作り直すもの ----
  const keyed = new Map(); let used = new Set();
  const labelsEl = document.getElementById("labels"), labels = new Map(); let usedL = new Set();
  function disposeAll(o) { o.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material && !Object.values(matCache).includes(c.material)) { (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose()); } }); }
  function clearScene() {
    disposeAll(root); scene.remove(root); root = new THREE.Group(); scene.add(root);
    keyed.clear(); labels.forEach((e) => e.remove()); labels.clear();
    document.getElementById("insets").innerHTML = "";
  }
  function K(key, make) { used.add(key); let o = keyed.get(key); if (!o) { o = make(); root.add(o); keyed.set(key, o); } o.visible = true; return o; }
  function label(key, text, pos, cls) {
    usedL.add(key); let e = labels.get(key);
    if (!e) { e = document.createElement("div"); labelsEl.appendChild(e); labels.set(key, e); }
    if (e._t !== text) { e.textContent = text; e._t = text; }
    const c = "lb " + (cls || ""); if (e.className !== c) e.className = c;
    e._p = pos;
  }
  const tmpV = new THREE.Vector3();
  /** 名札を置く：となりの名札や小窓（虫めがね）と重ならないように、上下にずらす */
  function placeLabels() {
    const w = stage.clientWidth, h = stage.clientHeight, sr = stage.getBoundingClientRect();
    const placed = [];
    document.querySelectorAll("#insets > div, #viewBtns").forEach((d) => { const r = d.getBoundingClientRect(); if (r.width) placed.push({ l: r.left - sr.left - 4, t: r.top - sr.top - 4, r: r.right - sr.left + 4, b: r.bottom - sr.top + 4 }); });
    const items = [];
    labels.forEach((e, k) => {
      if (!usedL.has(k)) { e.style.display = "none"; return; }
      tmpV.set(e._p[0], e._p[1], e._p[2]).applyMatrix4(root.matrixWorld).project(camera);
      if (tmpV.z > 1) { e.style.display = "none"; return; }
      e.style.display = "";
      items.push({ e, x: ((tmpV.x + 1) / 2) * w, y: ((1 - tmpV.y) / 2) * h, big: /big/.test(e.className) });
    });
    items.sort((a, b) => b.big - a.big); // 大きな名札を先に置く
    for (const it of items) {
      const ew = it.e.offsetWidth, eh = it.e.offsetHeight;
      let y = it.y, x = Math.max(ew / 2 + 2, Math.min(w - ew / 2 - 2, it.x));
      const hit = (yy) => placed.find((p) => x - ew / 2 < p.r && x + ew / 2 > p.l && yy - eh / 2 < p.b && yy + eh / 2 > p.t);
      for (let n = 0, d = 0; n < 16; n++) { const c = hit(y); if (!c) break; d = n % 2 === 0 ? c.b + eh / 2 + 2 - y : c.t - eh / 2 - 2 - y; const y2 = y + d; if (!hit(y2) || n > 10) { y = y2; break; } y = n % 2 === 0 ? y2 : y; }
      it.e.style.left = x + "px"; it.e.style.top = y + "px";
      placed.push({ l: x - ew / 2, t: y - eh / 2, r: x + ew / 2, b: y + eh / 2 });
    }
  }

  // ---- 部品 ----
  /** 2Dの多角形（横×たて）を、おく行きに押し出した形（地層ブロック） */
  function extruder(depth = D, z0 = Z0) {
    const ms = [];
    return {
      set(list) {
        list.forEach((L, i) => {
          let m = ms[i];
          if (!m) { m = new THREE.Mesh(new THREE.BufferGeometry(), mat("rock")); root.add(m); ms[i] = m; }
          m.material = L.mat || mat(L.type, L.color);
          m.geometry.dispose();
          const pts = L.pts;
          if (!pts || pts.length < 3) { m.visible = false; m.geometry = new THREE.BufferGeometry(); return; }
          m.visible = true;
          const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
          const g = new THREE.ExtrudeGeometry(sh, { depth: L.depth || depth, bevelEnabled: false });
          g.translate(0, 0, L.z0 !== undefined ? L.z0 : z0);
          m.geometry = g;
        });
        for (let i = list.length; i < ms.length; i++) ms[i].visible = false;
      },
    };
  }
  function cleanPts(pts) { const o = []; for (const p of pts) { const q = o[o.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 1e-4 || Math.abs(q[1] - p[1]) > 1e-4) o.push(p); } return o; }
  /** 2Dの上の線・下の線（下向きのy）→ 3Dの多角形 */
  function band2(xs, top, bot, type, color) {
    const pts = [];
    for (let k = 0; k < xs.length; k++) pts.push(W(xs[k], top[k]));
    for (let k = xs.length - 1; k >= 0; k--) pts.push(W(xs[k], Math.max(bot[k], top[k] + 0.02)));
    return { type, color, pts: cleanPts(pts) };
  }
  function bandRange2(xs, top, bot, a, b, type, color) {
    const ix = []; for (let k = 0; k < xs.length; k++) if (xs[k] >= a && xs[k] <= b) ix.push(k);
    if (ix.length < 2) return null;
    return band2(ix.map((k) => xs[k]), ix.map((k) => top[k]), ix.map((k) => bot[k]), type, color);
  }
  /** 多角形を、f(x,y)>=0 の側だけ残して切る（2Dの座標のまま） */
  function clipHalf(pts, f) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], fa = f(a[0], a[1]), fb = f(b[0], b[1]);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) { const u = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
    }
    return out;
  }
  function strata2(xs, bounds, types, surf, colors) {
    const out = [];
    for (let i = 0; i < types.length; i++) {
      const top = xs.map((x, k) => (surf ? Math.max(bounds[i][k], surf[k]) : bounds[i][k]));
      const bot = xs.map((x, k) => (surf ? Math.max(bounds[i + 1][k], surf[k]) : bounds[i + 1][k]));
      if (top.every((v, k) => bot[k] - v < 0.2)) continue;
      out.push(band2(xs, top, bot, types[i], colors && colors[i]));
    }
    return out;
  }
  function boxMesh(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
  function tree(s = 1) { const g = new THREE.Group(); const tr = boxMesh(1.2 * s, 5 * s, 1.2 * s, mat("trunk", "#7a5634")); tr.position.y = 2.5 * s; const lf = new THREE.Mesh(new THREE.SphereGeometry(3.6 * s, 12, 10), mat("leaf", "#3f8f3f")); lf.position.y = 7 * s; g.add(tr, lf); return g; }
  function house(s = 1) { const g = new THREE.Group(); const b = boxMesh(7 * s, 4.5 * s, 6 * s, mat("wall", "#efe7d6")); b.position.y = 2.25 * s; const r = new THREE.Mesh(new THREE.ConeGeometry(5.6 * s, 3.4 * s, 4), mat("roof", "#b5523b")); r.position.y = 6.2 * s; r.rotation.y = Math.PI / 4; g.add(b, r); return g; }
  function person(c = "#2f6fb0") { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 5.5, 12), mat("body" + c, c)); b.position.y = 4.2; const l = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 10), mat("legs", "#333")); l.position.y = 0.8; const h = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 12), mat("skin", "#f2c9a0")); h.position.y = 8.4; g.add(b, l, h); return g; }
  function shellMesh() { const g = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat("shell", "#f4ede0")); g.scale.set(2.4, 1, 2); return g; }
  function ammoniteMesh(color = "#d9b98a") {
    const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color });
    [[6, 1.7, 0], [3.7, 1.15, 1.9], [2.1, 0.75, 3.1], [1.1, 0.45, 3.8]].forEach(([r, tb, off]) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, tb, 10, 28), m); t.position.x = off; g.add(t); });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, rib = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.18, 6, 10), mat("rib", "#a07a4e")); rib.position.set(Math.cos(a) * 6, Math.sin(a) * 6, 0); rib.rotation.y = Math.PI / 2; rib.rotation.x = a; g.add(rib); }
    g.userData.m = m;
    return g;
  }
  function leafMesh(color = "#6b5a3a") {
    const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color });
    const b = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), m); b.scale.set(4.2, 2.2, 0.4); g.add(b);
    const vein = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 0.6), mat("vein", "#3c3222")); g.add(vein);
    for (let i = -2; i <= 2; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 0.6), mat("vein", "#3c3222")); v.position.set(i * 1.5, 0.7, 0); v.rotation.z = 0.6; g.add(v); const v2 = v.clone(); v2.position.y = -0.7; v2.rotation.z = -0.6; g.add(v2); }
    const st = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 0.5), m); st.position.x = -5.2; g.add(st);
    return g;
  }
  function boneFishMesh(color = "#8d8478") { // 魚の骨の化石
    const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color });
    const sp = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 0.6), m); g.add(sp);
    for (let i = -4; i <= 3; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.4 - Math.abs(i) * 0.3, 0.5), m); r.position.x = i * 1.1; g.add(r); }
    const hd = new THREE.Mesh(new THREE.ConeGeometry(1.8, 3, 3), m); hd.rotation.z = -Math.PI / 2; hd.position.x = 6.3; g.add(hd);
    const tl = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2.6, 3), m); tl.rotation.z = -Math.PI / 2; tl.position.x = -6; g.add(tl);
    return g;
  }
  function fishMesh(color) {
    const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color, transparent: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), m); body.scale.set(4, 1.8, 1.2); g.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3, 4), m); tail.rotation.z = Math.PI / 2; tail.position.x = -5; g.add(tail);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mat("eye", "#111")); eye.position.set(2.6, 0.4, 1.0); g.add(eye);
    g.userData.m = m; return g;
  }
  /** 昔の海：土地がおし上げられたあと、「ここは昔 海だった」ことがわかるように、うすい水色と点線で海面を残す */
  function oldSea(key, yTop, yBot, a, text) {
    const box = K(key, () => { const mm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x8fd0f2, transparent: true, opacity: 0.18, depthWrite: false })); mm.renderOrder = 4; return mm; });
    const line = K(key + "L", () => { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-100, 0, 35.5), new THREE.Vector3(100, 0, 35.5), new THREE.Vector3(100, 0, -35), new THREE.Vector3(-100, 0, -35), new THREE.Vector3(-100, 0, 35.5)]); const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x1565c0, dashSize: 3, gapSize: 2, transparent: true })); l.computeLineDistances(); return l; });
    if (a <= 0.01 || yTop - yBot < 0.5) { box.visible = line.visible = false; return; }
    box.scale.set(200, yTop - yBot, 69); box.position.set(0, (yTop + yBot) / 2, 0); box.material.opacity = 0.2 * a;
    line.position.y = yTop; line.material.opacity = a;
    label(key + "T", text || "昔の海面（ここまで海だった）", [-62, yTop + 3, 35], "big");
  }
  let _vm = null; function volcMat() { return _vm || (_vm = new THREE.MeshLambertMaterial({ color: 0x6f625a, side: THREE.DoubleSide })); }
  function arrow(key, from, to, color = 0xd0342c, r = 2.6) {
    const g = K(key, () => {
      const grp = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 14), m), hd = new THREE.Mesh(new THREE.ConeGeometry(r * 2.5, r * 5, 18), m);
      grp.add(sh, hd); grp.userData = { sh, hd, r }; return grp;
    });
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), dir = b.clone().sub(a), L = dir.length(); dir.normalize();
    const { sh, hd, r: rr } = g.userData, hl = rr * 5;
    sh.scale.set(1, Math.max(0.01, L - hl), 1); sh.position.set(0, (L - hl) / 2, 0); hd.position.set(0, L - hl / 2, 0);
    g.position.copy(a); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }
  function points(key, n, color, size = 1.2, opacity = 1) {
    return K(key, () => {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: dotTex, alphaTest: 0.4, transparent: opacity < 1, opacity })); p.frustumCulled = false; return p;
    });
  }
  function setPoints(p, arr) { const a = p.geometry.attributes.position.array; a.fill(0); for (let i = 0; i < arr.length && i * 3 < a.length; i++) { a[i * 3] = arr[i][0]; a[i * 3 + 1] = arr[i][1]; a[i * 3 + 2] = arr[i][2]; } p.geometry.setDrawRange(0, Math.min(arr.length, a.length / 3)); p.geometry.attributes.position.needsUpdate = true; }
  function waterBox(key, x0, x1, y0, y1, z0 = Z0, z1 = Z0 + D, color = COL.sea, op = 0.35) {
    const m = K(key, () => { const mm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: op, depthWrite: false })); mm.renderOrder = 5; return mm; });
    if (y1 - y0 < 0.05) { m.visible = false; return m; }
    const zi0 = z0 + 0.8, zi1 = z1 - 0.8;
    m.scale.set(x1 - x0, y1 - y0, zi1 - zi0); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (zi0 + zi1) / 2); return m;
  }
  function ribbon(pts, w, color) { // pts: [[x,y,z]] 中心線、幅 w（z方向）
    const pos = [], idx = [];
    pts.forEach((p, i) => { pos.push(p[0], p[1], p[2] - w / 2, p[0], p[1], p[2] + w / 2); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  }
  /** 2Dの小窓（虫めがね・けんび鏡）：list = [{key, cap, draw(g, n), wide}] */
  function insets(list) {
    const box = document.getElementById("insets");
    const keys = list.map((x) => x.key).join(",");
    if (box.dataset.k !== keys) { box.innerHTML = ""; box.dataset.k = keys; list.forEach((it) => { const d = document.createElement("div"); const c = document.createElement("canvas"); c.width = it.wide ? 520 : 300; c.height = it.wide ? 300 : 300; if (it.wide) { c.style.width = "330px"; c.style.height = "190px"; c.style.borderRadius = "12px"; } const p = document.createElement("div"); p.className = "cap"; d.append(c, p); box.appendChild(d); it._c = c; it._p = p; }); }
    const kids = box.children;
    // 小窓の大きさ：数が多いときや画面がせまいときは小さく
    const sw = stage.clientWidth, sh = stage.clientHeight, n = list.length;
    const size = Math.round(Math.max(84, Math.min(n > 2 ? 132 : 190, (sw * 0.62) / Math.max(1, n) - 12, sh * 0.34)));
    list.forEach((it, i) => { const c = kids[i].firstChild; if (!it.wide) { c.style.width = c.style.height = size + "px"; kids[i].style.width = size + "px"; } });
    list.forEach((it, i) => { const c = kids[i].firstChild, p = kids[i].lastChild; const g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.save(); if (!it.wide) { g.beginPath(); g.arc(150, 150, 148, 0, 7); g.clip(); } it.draw(g, c.width, c.height); g.restore(); if (!it.wide) { g.strokeStyle = "#1f7a8c"; g.lineWidth = 8; g.beginPath(); g.arc(150, 150, 146, 0, 7); g.stroke(); } if (p.textContent !== it.cap) p.textContent = it.cap; });
  }

  // ---- つぶ・岩石の絵（テクスチャ・小窓） ----
  function drawGrains(g, n, type, cement, seed) {
    const r = rng(seed || 3);
    const bgLoose = { gravel: "#7d6a55", sand: "#b8a26c", mud: "#8b9592", ash: "#8a5a48" }[type];
    const bgRock = { gravel: "#a89a86", sand: "#cdb98a", mud: "#7f8a87", ash: "#b78a73" }[type];
    g.fillStyle = cement ? bgRock : bgLoose; g.fillRect(0, 0, n, n);
    const S = n / 256;
    if (type === "mud") { for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? "rgba(70,80,78,.55)" : "rgba(190,198,195,.5)"; g.fillRect(r() * n, r() * n, 2.2 * S, 2.2 * S); } return; }
    const cfg = { gravel: [30, 16, 30], sand: [520, 4, 6.5], ash: [260, 4, 11] }[type];
    for (let i = 0; i < cfg[0]; i++) {
      const x = r() * n, y = r() * n, s = lerp(cfg[1], cfg[2], r()) * S;
      g.fillStyle = type === "ash" ? ["#e6e1d6", "#2f2c2a", "#b48a74", "#cfc7bb", "#f6f3ec"][Math.floor(r() * 5)] : type === "gravel" ? ["#c8955a", "#a98a66", "#d8c39b", "#8e7a62", "#b9a27a"][Math.floor(r() * 5)] : ["#e6cf7e", "#d6c08a", "#c9b37a", "#efe0a8"][Math.floor(r() * 4)];
      g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 1.2 * S;
      g.beginPath();
      if (type === "ash") { const nv = 4 + Math.floor(r() * 3), a0 = r() * 6.3; for (let v = 0; v < nv; v++) { const a = a0 + (v / nv) * 6.28, rad = s * (0.5 + r() * 0.8); v ? g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad) : g.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); } g.closePath(); }
      else g.ellipse(x, y, s, s * (0.7 + r() * 0.3), r() * 3, 0, 7);
      g.fill(); g.stroke();
    }
  }
  const grainTexCache = {};
  function grainTex(type, cement) {
    const k = type + (cement ? "c" : "");
    if (grainTexCache[k]) return grainTexCache[k];
    const c = document.createElement("canvas"); c.width = c.height = 256; drawGrains(c.getContext("2d"), 256, type, cement, 7);
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(3, 1);
    return (grainTexCache[k] = tx);
  }
  // 火成岩の絵
  function xtal(g, x, y, s, rot, c) { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = c; g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(-s, -s * 0.45); g.lineTo(-s * 0.6, -s * 0.7); g.lineTo(s * 0.9, -s * 0.55); g.lineTo(s, s * 0.4); g.lineTo(s * 0.5, s * 0.7); g.lineTo(-s * 0.9, s * 0.55); g.closePath(); g.fill(); g.stroke(); g.restore(); }
  function drawIgneous(g, n, kind, tone, seed) { // kind: "volc"（斑状）/"plut"（等粒状）、tone: 0白っぽい〜2黒っぽい
    const r = rng(seed || 9), S = n / 256;
    if (kind === "volc") {
      g.fillStyle = ["#cfc8bd", "#8f8a84", "#45423f"][tone]; g.fillRect(0, 0, n, n);
      for (let i = 0; i < 1800; i++) { g.fillStyle = r() < 0.5 ? "rgba(30,30,30,.35)" : "rgba(240,236,228,.35)"; g.fillRect(r() * n, r() * n, 2 * S, 1.4 * S); }
      for (let i = 0; i < 14; i++) xtal(g, r() * n, r() * n, (8 + r() * 10) * S, r() * 3, r() < [0.25, 0.4, 0.55][tone] ? "#2d2a26" : "#f2efe8");
    } else {
      g.fillStyle = "#ccc"; g.fillRect(0, 0, n, n);
      const pal = [["#f2efe8", "#f2efe8", "#e9d3c4", "#f6f4ef", "#2d2a26"], ["#f2efe8", "#d9d6cf", "#2d2a26", "#3a3633", "#e9e6df"], ["#2d2a26", "#3a3633", "#4a4642", "#d9d6cf", "#1f1d1b"]][tone];
      for (let gy = 0; gy < 9; gy++) for (let gx = 0; gx < 9; gx++) xtal(g, (gx + 0.5) * n / 9 + (r() - 0.5) * 14 * S, (gy + 0.5) * n / 9 + (r() - 0.5) * 14 * S, (16 + r() * 8) * S, r() * 3, pal[Math.floor(r() * pal.length)]);
    }
  }
  const igTexCache = {};
  function igTex(kind, tone) { const k = kind + tone; if (igTexCache[k]) return igTexCache[k]; const c = document.createElement("canvas"); c.width = c.height = 256; drawIgneous(c.getContext("2d"), 256, kind, tone, 11 + tone); const tx = new THREE.CanvasTexture(c); return (igTexCache[k] = tx); }

  // ================= 場面 =================
  const SCENES = [];

  // ---- ① 流れる水のはたらき（水そうの実験） ----
  SCENES.push({
    id: "tank", group: "地層のでき方", title: "流れる水のはたらき（水そうの実験）", short: "🧪 水そうの実験", dur: 28,
    cam: { pos: [55, 70, 150], target: [-5, 28, 0] },
    stages: [
      { t: 0, s: "土をのせる", text: "川に見立てたといに、れき・砂・どろがまざった土をのせます。水そうは海や湖、流す水は大雨に見立てています。" },
      { t: 0.08, s: "1回目", text: "水を流すと、土が水そうに運ぱんされます。つぶの大きいれきは先に、流れこんだ所の近くにしずみ、つぶの小さいどろはゆっくり、遠くまで広がってしずみます。" },
      { t: 0.4, s: "分かれた", text: "下から「れき→砂→どろ」の順に、つぶの大きさごとに分かれてたい積しました。流れこんだ側が厚く、ななめ（けいしゃ）に積もっています。" },
      { t: 0.47, s: "2回目", text: "土がしずんだら、もう一度土をのせて水を流します。" },
      { t: 0.86, s: "2組の層", text: "2回流すと、1回目の層の上に2回目の層ができました。地層も、流れる水のはたらきでたい積することが何度もくり返されてできます。" },
    ],
    build() {
      const X0 = -50, X1 = 50, ZD = 20, BOT = 0, WT = 62, IN = [-49, 61, 0];
      const pours = [{ t0: 0.08, t1: 0.17 }, { t0: 0.5, t1: 0.59 }];
      const ORD = ["gravel", "sand", "mud"], SINK = { gravel: 0.04, sand: 0.1, mud: 0.24 };
      const NUM = { gravel: 55, sand: 150, mud: 240 }, RAD = { gravel: 1.4, sand: 0.75, mud: 0.45 }, FALL = 0.014, SPREAD = { gravel: 2.4, sand: 1.2, mud: 0.8 };
      // 積もる厚さ：流れこんだ側（左）ほど厚い。れきは左にかたまり、どろは全体にうすく広がる
      const prof = { gravel: (u) => 15 * Math.pow(1 - u, 1.8) + 0.4, sand: (u) => 9 * (1.25 - u) + 0.4, mud: (u) => 3.4 + 1.6 * u };
      const xs = []; for (let x = X0 + 0.4; x <= X1 - 0.4 + 1e-6; x += 2) xs.push(x);
      const uOf = (x) => clamp((x - X0) / (X1 - X0));
      const r = rng(7), parts = [];
      pours.forEach((p, pi) => ORD.forEach((ty, ti) => { for (let i = 0; i < NUM[ty]; i++) parts.push({ k: pi * 3 + ti, ty, te: lerp(p.t0, p.t1, r()), x: X0 + 2 + Math.pow(r(), SPREAD[ty]) * (X1 - X0 - 4), z: (r() - 0.5) * (2 * ZD - 4), j: r(), w: r() * 6.3 }); }));
      const tot = new Array(6).fill(0); parts.forEach((p) => tot[p.k]++);
      const landed = (p, t) => t >= p.te + FALL + SINK[p.ty];
      // できあがりの面（k番目の層の上の面）
      const finTop = []; { let base = xs.map(() => BOT); for (let k = 0; k < 6; k++) { const f = prof[ORD[k % 3]]; base = xs.map((x, i) => base[i] + f(uOf(x))); finTop.push(base); } }
      const finAt = (k, x) => { if (k < 0) return BOT; const i = clamp(Math.round((x - xs[0]) / 2), 0, xs.length - 1); return finTop[k][i]; };
      // 机・水そう・とい
      const table = boxMesh(170, 4, 70, mat("table", "#c9b38f")); table.position.set(-20, -2, 0); root.add(table);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0 + 1, 70, 2 * ZD + 1), new THREE.MeshLambertMaterial({ color: 0xbfe3f2, transparent: true, opacity: 0.12, depthWrite: false })); glass.position.set(0, 35, 0); glass.renderOrder = 8; root.add(glass);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0x5f8ea3 })); edges.position.copy(glass.position); root.add(edges);
      const trough = new THREE.Group();
      const tb = boxMesh(80, 1.2, 9, mat("tr", "#b9c3c9")); trough.add(tb);
      const s1 = boxMesh(80, 3, 0.8, mat("tr", "#b9c3c9")); s1.position.set(0, 1.5, 4.5); const s2 = s1.clone(); s2.position.z = -4.5; trough.add(s1, s2);
      trough.position.set(-86, 76, 0); trough.rotation.z = -0.38; root.add(trough);
      const stand = boxMesh(2, 76, 2, mat("st", "#8a8f93")); stand.position.set(-118, 38, 0); root.add(stand);
      const ex = extruder(2 * ZD - 0.6, -ZD + 0.3);
      const water = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x9fd8f5, transparent: true, opacity: 0.32, depthWrite: false })); water.renderOrder = 6; root.add(water);
      const inst = {}, dummy = new THREE.Object3D();
      ORD.forEach((ty) => { const n = parts.filter((p) => p.ty === ty).length; const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, ty === "mud" ? 5 : 8, ty === "mud" ? 4 : 6), mat("g" + ty, COL[ty]), n); im.frustumCulled = false; root.add(im); inst[ty] = im; });
      const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat("gravel", "#9b7b55")); root.add(mound);
      const stream = ribbon([[-122, 92, 0], [-50, 64, 0]], 5, 0x5aa9de); stream.material.transparent = true; root.add(stream);
      const fallW = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 6, 10), new THREE.MeshLambertMaterial({ color: 0x5aa9de, transparent: true, opacity: 0.7 })); fallW.position.set(-48, 60, 0); root.add(fallW);
      return (t) => {
        const fr = new Array(6).fill(0); for (const p of parts) if (landed(p, t)) fr[p.k]++;
        const list = []; let base = xs.map(() => BOT);
        for (let k = 0; k < 6; k++) {
          const f = prof[ORD[k % 3]], q = fr[k] / tot[k]; if (q <= 0) continue;
          const top = xs.map((x, i) => base[i] + f(uOf(x)) * q);
          const pts = xs.map((x, i) => [x, top[i]]); for (let i = xs.length - 1; i >= 0; i--) pts.push([xs[i], base[i]]);
          list.push({ type: ORD[k % 3], pts: cleanPts(pts) }); base = top;
        }
        ex.set(list);
        const minTop = Math.min(...base);
        water.scale.set(X1 - X0 - 0.4, WT - minTop, 2 * ZD - 0.8); water.position.set(0, (WT + minTop) / 2, 0);
        let turb = 0; for (const p of pours) turb = Math.max(turb, seg(t, p.t0 + 0.005, p.t0 + 0.04) * (1 - seg(t, p.t0 + 0.08, p.t0 + 0.32)));
        water.material.color.copy(mixC("#9fd8f5", "#9a7a55", turb * 0.8)); water.material.opacity = 0.32 + 0.4 * turb;
        const idx = { gravel: 0, sand: 0, mud: 0 };
        for (const p of parts) {
          const im = inst[p.ty], i = idx[p.ty]++;
          const vis = t >= p.te && !landed(p, t); let x = 0, yy = 0, z = 0;
          if (vis) {
            const tf = t - p.te;
            if (tf < FALL) { x = IN[0] + 2; yy = lerp(IN[1] + 4, WT - 1, tf / FALL); z = p.z * 0.1; }
            else {
              const u = (tf - FALL) / SINK[p.ty];
              const land = lerp(finAt(p.k - 1, p.x), finAt(p.k, p.x), p.j);
              yy = lerp(WT - 1, land, u); x = lerp(IN[0] + 3, p.x, Math.min(1, u * 1.6)) + (p.ty === "mud" ? Math.sin(p.w + t * 60) * 0.8 : 0); z = lerp(0, p.z, Math.min(1, u * 1.6));
            }
          }
          const sc = vis ? RAD[p.ty] : 0.0001;
          dummy.position.set(x, yy, z); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
        }
        ORD.forEach((ty) => (inst[ty].instanceMatrix.needsUpdate = true));
        let m = 0, pouring = 0;
        pours.forEach((p, pi) => { const mm = (pi === 0 ? 1 - seg(t, 0.3, 0.31) : seg(t, 0.44, 0.49)) * (1 - seg(t, p.t0, p.t1)); m = Math.max(m, pi === 0 && t > 0.3 ? 0 : mm); pouring = Math.max(pouring, seg(t, p.t0 - 0.01, p.t0 + 0.005) * (1 - seg(t, p.t1, p.t1 + 0.03))); });
        mound.visible = m > 0.02; mound.scale.set(9 * Math.sqrt(m), 4 * m, 6 * Math.sqrt(m)); mound.position.set(-112, 89 + 2 * m, 0);
        stream.visible = fallW.visible = pouring > 0.02; stream.material.opacity = 0.8 * pouring;
        if (parts.some((p) => t > p.te && !landed(p, t))) label("hint", "つぶが大きく重いものほど、早く・近くにしずむ", [0, 82, 0], "big");
        label("toi", "川", [-90, 74, 8], "big");
        label("tank", "海や湖", [30, 68, ZD], "big");
        if (pouring > 0.05) label("rain", "大雨", [-125, 102, 0]);
        if (t >= 0.4) {
          const L = { gravel: ["れき", 0.12], sand: ["砂", 0.5], mud: ["どろ", 0.85] }, n = t >= 0.86 ? 6 : 3;
          for (let k = 0; k < n; k++) { const ty = ORD[k % 3], x = lerp(X0, X1, L[ty][1]); label("b" + k, L[ty][0], [x, (finAt(k - 1, x) + finAt(k, x)) / 2, ZD + 1]); }
          if (t >= 0.86) { label("p1", "1回目", [X0 - 10, finAt(1, X0 + 1), ZD], "big"); label("p2", "2回目", [X0 - 10, finAt(4, X0 + 1), ZD], "big"); }
        }
      };
    },
  });

  // ---- ② 海の底に地層ができる ／ ③ 火山灰（共通） ----
  function seaBuild(cfg) {
    return () => {
      const SL = 240, COAST = 380, xs = XS(4), r = rng(cfg.seed || 11);
      const land = (x) => { const pts = cfg.volcano ? [[-20, 225], [300, 225], [COAST, SL]] : [[-20, 120], [80, 74], [160, 118], [250, 186], [COAST, SL]]; for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0])); return SL; };
      const floor0 = (x) => (x < COAST ? land(x) : lerp(SL, 290, clamp((x - COAST) / 40)) + Math.max(0, x - COAST - 40) * 0.26);
      const evs = cfg.events;
      const thick = (e, x) => (e.kind === "ash" ? 8 : x < COAST ? 0 : 13 * Math.pow(clamp((x - COAST) / 170), 0.8));
      const ex = extruder();
      // 川の通り道（2Dの座標）
      const riverAt = (u) => (cfg.volcano ? [lerp(250, COAST, u), land(lerp(250, COAST, u)) - 1] : [lerp(150, COAST, u), (1 - u) * (1 - u) * 116 + 2 * (1 - u) * u * 190 + u * u * SL]);
      const riverPts = []; for (let i = 0; i <= 30; i++) { const q = riverAt(i / 30), w = W(q[0], q[1]); riverPts.push([w[0], w[1] + 0.4, 5]); }
      const river = ribbon(riverPts, 6, COL.river); root.add(river);
      const parts = []; for (let i = 0; i < 220; i++) parts.push({ ph: r(), ty: ["gravel", "sand", "sand", "mud", "mud", "mud"][i % 6], j: r(), z: (r() - 0.5) * 60 });
      const ashFall = []; for (let i = 0; i < 500; i++) ashFall.push({ x: 60 + r() * 940, z: (r() - 0.5) * 68, ph: r() });
      let vol = null;
      if (cfg.volcano) {
        // 平らな陸の上に、円すいの火山（緑の土地にかくれないように、地面の上にのせる）
        const prof = [new THREE.Vector2(0.001, 38)]; for (let i = 0; i <= 20; i++) { const rr = 3.5 + (i / 20) * 30.5; prof.push(new THREE.Vector2(rr, 42 * (1 - rr / 34) + (i === 0 ? -3 : 0))); }
        prof.push(new THREE.Vector2(0.001, 0));
        vol = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), volcMat()); vol.position.set(-66, W(0, 225)[1] - 0.5, -8); root.add(vol);
      }
      return (t) => {
        const f0 = xs.map(floor0), list = [band2(xs, f0, xs.map(() => 640), "rock")];
        let base = f0.slice(); const tops = [];
        evs.forEach((e) => {
          const gk = seg(t, e.t0, e.t1), th = xs.map((x) => thick(e, x) * gk), top = base.map((b, i) => b - th[i]);
          if (gk > 0) {
            if (e.kind === "ash") list.push(band2(xs, top, base, "ash"));
            else {
              // れき→砂→どろの境目は、ななめにゆるやかに変わる（となりの層とも なめらかにつながる）
              const z1 = COAST + 90 + (e.shift || 0), z2 = COAST + 270 + (e.shift || 0), ib = (x) => base[clamp(Math.round((x + 20) / 4), 0, xs.length - 1)];
              const raw = []; xs.forEach((x, k) => raw.push([x, top[k]])); for (let k = xs.length - 1; k >= 0; k--) raw.push([xs[k], Math.max(base[k], top[k] + 0.02)]);
              const f1 = (x, y) => x - (z1 + (ib(z1) - y) * 4), f2 = (x, y) => x - (z2 + (ib(z2) - y) * 4);
              [["gravel", clipHalf(raw, (x, y) => -f1(x, y))], ["sand", clipHalf(clipHalf(raw, f1), (x, y) => -f2(x, y))], ["mud", clipHalf(raw, f2)]].forEach(([ty, pp]) => { if (pp.length > 2) list.push({ type: ty, pts: cleanPts(pp.map((q) => W(q[0], q[1]))) }); });
            }
          }
          tops.push(top); base = top;
        });
        // 陸の草
        const lx = xs.filter((x) => x <= COAST + 4); list.push(band2(lx, lx.map((x, i) => base[i] - 2.5), lx.map((x, i) => base[i]), "grass"));
        ex.set(list);
        waterBox("sea", W(COAST - 10, 0)[0], 100.5, W(0, 640)[1], W(0, SL)[1]);
        // 化石（貝）
        (cfg.fossils || []).forEach((f, fi) => { const k = f.ev; if (t >= evs[k].t1 - 0.01) { const i = Math.round((f.x + 20) / 4); [-22, -4, 14].forEach((z, zi) => { const s = K("shell" + fi + "_" + zi, () => shellMesh()); const w = W(f.x + zi * 14, tops[k][i] - 0.2); s.position.set(w[0], w[1], z + f.x * 0.01); }); } });
        // 運ばれる土砂
        const cur = evs.find((e) => e.kind !== "ash" && t > e.t0 && t < e.t1);
        if (cur) {
          const pts = { gravel: [], sand: [], mud: [] };
          for (const p of parts) {
            const s = frac(p.ph + t * 3.2); let w, z;
            const tgt = (p.ty === "gravel" ? COAST + 20 + p.j * 70 : p.ty === "sand" ? COAST + 100 + p.j * 170 : COAST + 280 + p.j * 330) + (cur.shift || 0);
            if (s < 0.45) { const q = riverAt(s / 0.45); w = W(q[0], q[1]); w[1] += 1.2; z = 5 + (p.j - 0.5) * 4; }
            else { const u = (s - 0.45) / 0.55, i = clamp(Math.round((tgt + 20) / 4), 0, xs.length - 1); w = W(lerp(COAST, tgt, Math.min(1, u * 1.6)), lerp(SL + 2, base[i] - 1, u)); z = lerp(5, p.z, Math.min(1, u * 1.6)); }
            pts[p.ty].push([w[0], w[1], z]);
          }
          setPoints(points("pg", 80, 0x9b6a35, 3.2), pts.gravel); setPoints(points("ps", 80, 0xd8b850, 2.2), pts.sand); setPoints(points("pm", 120, 0x6f7a77, 1.5), pts.mud);
        }
        if (cfg.volcano) {
          const er = cfg.erupt, on = t > er[0] && t < er[1] + 0.06, fade = 1 - seg(t, er[1], er[1] + 0.06);
          boom(t, er[0], "ドカーン！ 噴火");
          const VX = -66, VY = W(0, 225)[1] + 40, VZ = -8;
          if (on) {
            for (let i = 0; i < 8; i++) { const a = seg(t, er[0] + i * 0.012, er[0] + i * 0.012 + 0.06); if (a <= 0) continue; const s = K("plume" + i, () => new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshLambertMaterial({ color: 0x5f5550, transparent: true, opacity: 0.6 }))); s.material.opacity = 0.6 * fade; const rad = 7 + i * 2.2; s.scale.set(rad, rad * 0.8, rad); s.position.set(VX + i * 7 * a + i * 9 * seg(t, er[0], er[1]), VY + 4 + i * 3.4 + 10 * a, VZ); }
            const fall = [];
            for (const p of ashFall) { const s = frac(p.ph + t * 6), x = p.x + Math.sin(s * 9) * 8, y = lerp(-10, 560, s), i = clamp(Math.round((x + 20) / 4), 0, xs.length - 1); if (y > base[i] - 1) continue; const w = W(x, y); fall.push([w[0], w[1], p.z]); }
            setPoints(points("ashfall", 500, 0x8a3d2a, 0.9, fade), fall);
            const glow = K("glow", () => new THREE.Mesh(new THREE.SphereGeometry(3, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff7a30 }))); glow.position.set(VX, VY - 1, VZ); glow.visible = seg(t, er[0], er[1]) < 1;
          }
          label("vol", "火山", [-66, W(0, 225)[1] + 48, -8]);
        }
        label("umi", "海", [80, 14, 35]);
        label("kawa", "川", [-50, 26, 5]);
        if (cfg.draw) cfg.draw(t, { tops, xs, base });
      };
    };
  }
  SCENES.push({
    id: "sea", group: "地層のでき方", title: "海の底に地層ができる", short: "🌊 海の底で積もる", dur: 30,
    cam: { pos: [70, 70, 175], target: [10, -8, 0] },
    age: agoSpan(600000),
    stages: [
      { t: 0, s: "運ぱん", text: "川の水は、山をしん食した石や土（れき・砂・どろ）を運ぱんします。運ばれるうちに角がとれて丸みを帯びます。" },
      { t: 0.1, s: "たい積", text: "海に出ると流れがゆるやかになり、運ばれてきたものがしずんでたい積します。重いれきは岸の近くに、軽いどろは遠くまで運ばれます。" },
      { t: 0.4, s: "重なる", text: "長い年月の間に同じことがくり返され、海の底に層が何枚も積み重なります。海の深さが変わると、同じ場所でも積もるものが変わります。" },
      { t: 0.65, s: "うもれる", text: "死んだ貝などが砂やどろにうもれると、化石になることがあります。" },
      { t: 0.9, s: "地層", text: "下の層ほど古く、上の層ほど新しい層です。地層は、手前だけでなくおくにも広がっています。" },
    ],
    build: seaBuild({
      seed: 11,
      events: [{ t0: 0.1, t1: 0.22, shift: 0 }, { t0: 0.22, t1: 0.34, shift: -60 }, { t0: 0.34, t1: 0.46, shift: 50 }, { t0: 0.46, t1: 0.58, shift: 110 }, { t0: 0.58, t1: 0.7, shift: -20 }, { t0: 0.7, t1: 0.82, shift: 60 }, { t0: 0.82, t1: 0.92, shift: -40 }],
      fossils: [{ ev: 2, x: 690 }, { ev: 4, x: 830 }],
      draw(t) { if (t > 0.9) { label("old", "下ほど古い ↓", [95, -40, 36]); label("new", "上ほど新しい ↑", [95, -18, 36]); } },
    }),
  });
  SCENES.push({
    id: "ash", group: "地層のでき方", title: "火山のはたらきでできる地層", short: "🌋 火山灰の層", dur: 28,
    cam: { pos: [60, 85, 200], target: [0, 8, 0] },
    age: agoSpan(400000),
    stages: [
      { t: 0, s: "水の層", text: "海の底に、流れる水のはたらきで運ばれたれき・砂・どろがたい積しています。" },
      { t: 0.36, s: "噴火", text: "火山が噴火すると、火山灰などがふき出されます。火山灰は風に乗って遠くまで運ばれ、降り積もります。" },
      { t: 0.48, s: "火山灰の層", text: "火山灰は、陸にも海にも広い範囲に積もって、火山灰の層になります。" },
      { t: 0.6, s: "また積もる", text: "その上に、また流れる水のはたらきで層が積もります。" },
      { t: 0.86, s: "つぶ比べ", text: "流れる水で運ばれたつぶは丸みを帯びていますが、火山灰のつぶは角ばっていて、ガラスのようなものもあります。" },
    ],
    build: seaBuild({
      seed: 21, volcano: true, erupt: [0.36, 0.55],
      events: [{ t0: 0.04, t1: 0.2, shift: 0 }, { t0: 0.2, t1: 0.35, shift: 60 }, { t0: 0.38, t1: 0.56, kind: "ash" }, { t0: 0.6, t1: 0.73, shift: -40 }, { t0: 0.73, t1: 0.86, shift: 40 }],
      draw(t) {
        if (t > 0.52) label("ashL", "火山灰の層", [70, -22, 36], "big");
        if (t > 0.86) insets([
          { key: "round", cap: "流れる水で運ばれたつぶ（丸い）", draw: (g, n) => drawGrains(g, n, "gravel", false, 5) },
          { key: "ang", cap: "火山灰のつぶ（角ばっている）", draw: (g, n) => drawGrains(g, n, "ash", false, 9) },
        ]);
        else insets([]);
      },
    }),
  });

  // ---- ④ 岩石のでき方くらべ（れき岩・砂岩・でい岩・ぎょう灰岩） ----
  SCENES.push({
    id: "rocks", group: "地層のでき方", title: "地層が固まって岩石になる（4つの岩石のちがい）", short: "🪨 4つの岩石", dur: 30,
    cam: { pos: [-8, 64, 215], target: [-14, 24, 0] },
    age: agoSpan(3000000),
    stages: [
      { t: 0, s: "2つのでき方", text: "左の3つ（れき・砂・どろ）は「流れる水のはたらき」で、川に運ばれて海の底に積もります。右の火山灰は「火山のはたらき」で、火山からふき出されて空から降り積もります。でき方がちがいます。" },
      { t: 0.06, s: "たい積", text: "水の中では、大きくて重いつぶほど早くしずみます。水に運ばれたれき・砂・どろは角がとれて丸く、水に運ばれていない火山灰は角ばっています。" },
      { t: 0.36, s: "おし固め", text: "上に次々と地層がたい積すると、その重みで下の層がおし固められ、つぶの間の水がしぼり出されます。" },
      { t: 0.6, s: "くっつく", text: "つぶとつぶの間に、水にとけていたものがしみこんで固まり、つぶどうしをくっつけます。" },
      { t: 0.8, s: "4つの岩石", text: "長い年月をかけて固まると、かたい岩石になります。つぶの大きさや形、でき方のちがいで、岩石の名前も変わります。" },
    ],
    build() {
      const R = 11, Hmax = 20, xs = [-68, -38, -8, 52], types = ["gravel", "sand", "mud", "ash"];
      const VC = [86, 0.15, -10]; // 火山の位置
      const rockName = { gravel: "れき岩", sand: "砂岩", mud: "でい岩", ash: "ぎょう灰岩（凝灰岩）" };
      const where = { gravel: "川の近くの海\n（流れが速い）", sand: "少しはなれた海", mud: "遠くて深い海\n（流れがゆるやか）", ash: "火山の近く\n（火山灰が降る）" };
      const feat = { gravel: "つぶ 2mm以上\n丸みを帯びている", sand: "つぶ 0.06〜2mm\n大きさがそろっている", mud: "つぶ 0.06mm以下\nけずると粉のよう", ash: "火山灰が固まった\nつぶが角ばっている" };
      const r = rng(5), cols = [];
      // 台を2つに分ける：水のはたらき（青）と火山のはたらき（だいだい）
      const baseW = boxMesh(96, 3, 40, mat("plateW", "#b9dcf0")); baseW.position.set(-38, -1.5, 0); root.add(baseW);
      const baseV = boxMesh(66, 3, 40, mat("plateV", "#f3c7a6")); baseV.position.set(70, -1.5, 0); root.add(baseV);
      const vprof = [new THREE.Vector2(0.001, 28)]; for (let i = 0; i <= 12; i++) { const rr = 2.5 + (i / 12) * 15.5; vprof.push(new THREE.Vector2(rr, 30 * (1 - rr / 18))); } vprof.push(new THREE.Vector2(0.001, 0));
      const vol = new THREE.Mesh(new THREE.LatheGeometry(vprof, 32), volcMat()); vol.position.set(VC[0], VC[1], VC[2]); root.add(vol);
      const plumeM = new THREE.MeshLambertMaterial({ color: 0x5f5550, transparent: true, opacity: 0.55 });
      // 左から川が流れこみ、れき・砂・どろを運んでくる
      const RV = [[-142, 74], [-118, 66], [-96, 56], [-84, 50]];
      const riverR = ribbon(RV.map(([x, y]) => [x, y, 0]), 9, COL.river); root.add(riverR);
      const bank = new THREE.Mesh(new THREE.BoxGeometry(70, 1, 24), mat("grass")); bank.position.set(-118, 60, 0); bank.rotation.z = -0.32; root.add(bank);
      const seaS = new THREE.Mesh(new THREE.BoxGeometry(86, 0.6, 30), new THREE.MeshLambertMaterial({ color: 0x7cc0e6, transparent: true, opacity: 0.35, depthWrite: false })); seaS.position.set(-38, 49.5, 0); seaS.renderOrder = 7; root.add(seaS);
      const riverAt = (v) => { const L = RV.length - 1, f = Math.min(L - 1e-6, v * L), i = Math.floor(f), u = f - i; return [lerp(RV[i][0], RV[i + 1][0], u), lerp(RV[i][1], RV[i + 1][1], u) + 1.2]; };
      const plumes = []; for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), plumeM); root.add(m); plumes.push(m); }
      types.forEach((ty, i) => {
        const x = xs[i];
        const glass = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.6, R + 0.6, 44, 32, 1, true), new THREE.MeshLambertMaterial({ color: 0xbfe3f2, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); glass.position.set(x, 22, 0); glass.renderOrder = 8; root.add(glass);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.6, 0.35, 8, 40), new THREE.MeshLambertMaterial({ color: 0x7aa7bd, transparent: true })); rim.rotation.x = Math.PI / 2; rim.position.set(x, 44, 0); root.add(rim);
        const loose = new THREE.MeshLambertMaterial({ map: grainTex(ty, false) }), hard = new THREE.MeshLambertMaterial({ map: grainTex(ty, true) });
        const sed = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1, 40), loose); root.add(sed);
        const water = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.1, R - 0.1, 1, 32), new THREE.MeshLambertMaterial({ color: 0x9fd8f5, transparent: true, opacity: 0.3, depthWrite: false })); water.renderOrder = 6; root.add(water);
        if (ty === "ash") water.material.opacity = 0; // 火山灰は水に運ばれない（空から降る）
        const weight = boxMesh(24, 6, 24, mat("mudstone")); root.add(weight);
        const n = { gravel: 26, sand: 70, mud: 110, ash: 70 }[ty];
        const geo = ty === "ash" ? new THREE.IcosahedronGeometry(1, 0) : new THREE.SphereGeometry(1, 10, 8);
        const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n); im.frustumCulled = false; root.add(im);
        const gr = [];
        for (let k = 0; k < n; k++) {
          const c = ty === "ash" ? ["#e6e1d6", "#2f2c2a", "#b48a74", "#cfc7bb"][k % 4] : ty === "gravel" ? ["#c8955a", "#a98a66", "#d8c39b", "#8e7a62"][k % 4] : ty === "sand" ? ["#e6cf7e", "#d6c08a", "#c9b37a"][k % 3] : ["#7f8a87", "#9aa7a2"][k % 2];
          im.setColorAt(k, C3(c));
          const a = r() * 6.3, d = Math.sqrt(r()) * (R - 2);
          gr.push({ x: x + Math.cos(a) * d, z: Math.sin(a) * d, s: { gravel: 2.2 + r(), sand: 0.7 + r() * 0.3, mud: 0.28, ash: 0.7 + r() * 0.6 }[ty], te: lerp(0.06, 0.28, r()), dur: { gravel: 0.03, sand: 0.07, mud: 0.14, ash: 0.09 }[ty], rot: r() * 6 });
        }
        cols.push({ ty, x, glass, rim, sed, water, weight, im, gr, loose, hard });
      });
      const dummy = new THREE.Object3D();
      return (t) => {
        const dep = ease(seg(t, 0.06, 0.34)), c = ease(seg(t, 0.36, 0.6)), cm = seg(t, 0.6, 0.78), fin = ease(seg(t, 0.8, 0.95));
        cols.forEach((o, i) => {
          const h = Math.max(0.05, Hmax * (o.ty === "mud" ? seg(t, 0.06, 0.36) : dep) * (1 - 0.3 * c)), lift = 10 * fin;
          o.sed.scale.y = h; o.sed.position.set(o.x, h / 2 + lift, 0); o.sed.rotation.y = fin * t * 6;
          o.sed.material = cm > 0.5 ? o.hard : o.loose;
          const wl = 42 * (1 - 0.6 * c);
          o.water.visible = wl - h > 0.3 && fin < 0.5; o.water.scale.y = Math.max(0.01, wl - h); o.water.position.set(o.x, (wl + h) / 2, 0);
          o.glass.material.opacity = 0.18 * (1 - fin); o.rim.material.opacity = 1 - fin; o.rim.visible = o.glass.visible = fin < 0.98;
          const wy = lerp(62, h + 3, c) + 40 * fin;
          o.weight.visible = t > 0.33 && fin < 0.95; o.weight.position.set(o.x, wy, 0);
          o.gr.forEach((g, k) => {
            const TR = 0.05, u = seg(t, g.te, g.te + g.dur), vis = t > g.te - (o.ty === "ash" ? 0 : TR) && u < 1;
            let px = g.x, y = lerp(49, Math.max(h, 1), u), pz = g.z;
            if (o.ty !== "ash" && t < g.te) { // 川を流れてきて、海（つつの上）を横に進む
              const v = seg(t, g.te - TR, g.te);
              if (v < 0.55) { const q = riverAt(v / 0.55); px = q[0]; y = q[1]; pz = (g.z / R) * 3; }
              else { const w = (v - 0.55) / 0.45; px = lerp(-84, g.x, w); y = 50 + Math.sin(w * 9 + g.rot) * 0.5; pz = lerp((g.z / R) * 3, g.z, w); }
            }
            if (o.ty === "ash") { // 火口からふき上がって、空から降ってくる
              px = lerp(VC[0], g.x, u); pz = lerp(VC[2], g.z, u); y = lerp(VC[1] + 30, Math.max(h, 1), u) + 40 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.3);
            }
            dummy.position.set(px, y, pz); const s = vis ? g.s : 0.0001; dummy.scale.set(s, s, s); dummy.rotation.set(g.rot, g.rot, 0); dummy.updateMatrix(); o.im.setMatrixAt(k, dummy.matrix);
          });
          o.im.instanceMatrix.needsUpdate = true;
          label("w" + i, where[o.ty], [o.x, 54 + 40 * fin, 0]);
          if (t > 0.33 && t < 0.62) label("wt" + i, "重み", [o.x, wy + 6, 0], "red");
          label("n" + i, fin > 0.4 ? rockName[o.ty] : NAME[o.ty], [o.x, -6, 14], fin > 0.4 ? "big" : "");
          if (fin > 0.6) label("f" + i, feat[o.ty], [o.x, 40, 0]);
        });
        // 噴火のけむり
        const erupt = seg(t, 0.06, 0.34) > 0 && t < 0.4;
        boom(t, 0.06, "ドカーン！ 噴火");
        plumes.forEach((m, i) => { const s2 = frac(t * 5 + i / 5); m.visible = erupt; const rad = 3 + 8 * s2; m.scale.set(rad, rad * 0.8, rad); m.position.set(VC[0] - 10 * s2, VC[1] + 30 + 34 * s2, VC[2]); });
        label("kW", "💧 流れる水のはたらき\n（水に運ばれる → つぶが丸い）", [-38, -12, 22], "big");
        label("kV", "🌋 火山のはたらき\n（ふき出されて降る → 角ばる）", [70, -12, 22], "big red");
        label("vol", "火山", [VC[0], VC[1] + 33, VC[2]]);
        if (c > 0.05 && c < 0.95) label("sq", "つぶの間の水が しぼり出される", [0, 64, 0], "big");
        label("riv", "川（れき・砂・どろを運ぶ）", [-120, 80, 0], "big");
        if (t > 0.08 && t < 0.36) label("hy", "大きくて重いつぶほど 川の近くで早くしずむ", [-38, 70, 0], "big");
        if (t > 0.6 && t < 0.8) label("cm", "つぶの間を うめて固める", [0, 64, 0], "big");
        insets(t > 0.36 && t < 0.8 ? cols.map((o) => ({ key: "lens" + o.ty, cap: NAME[o.ty] + "（虫めがね）", draw: (g, n) => drawGrains(g, n, o.ty, cm > 0.5, 3 + o.ty.length) })) : []);
      };
    },
  });

  // ---- ⑤ 化石ができるまで ----
  SCENES.push({
    id: "fossil", group: "地層のでき方", title: "化石ができるまで", short: "🐚 化石ができるまで", dur: 28,
    cam: { pos: [35, 40, 175], target: [0, -12, 0] },
    age: agoSpan(100000000),
    stages: [
      { t: 0, s: "生きていた", text: "大昔の海には、アンモナイトや魚など、たくさんの生き物がすんでいました。" },
      { t: 0.13, s: "しずむ", text: "1ぴきのアンモナイトが死んで、海の底にしずみます。やわらかい部分はなくなり、かたい殻が残ります。" },
      { t: 0.28, s: "うもれる", text: "川が運んできた砂やどろが、海の中を雪のようにしずんで、殻の上に1枚ずつ積もっていきます。積もるたびに、殻はどんどん深くうもれていきます。" },
      { t: 0.55, s: "化石に", text: "長い年月の間に、殻は地層の中で石のようにかたくなります。大昔の生き物のからだや、生き物がいたあとなどが残った物を化石といいます。" },
      { t: 0.68, s: "おし上げ", text: "大きな力が加わって大地がおし上げられ、陸になります。雨や川の水にしん食されていきます。" },
      { t: 0.86, s: "見つかる", text: "がけの地層から、アンモナイト・貝・魚・木の葉などの化石が見つかります。海の生き物の化石が出てくるので、昔そこが海だったことがわかります。木の葉は、川に運ばれてきて、どろといっしょにうもれたものです。" },
    ],
    build() {
      const xs = XS(8), SL = 170, ex = extruder();
      const am = ammoniteMesh(); root.add(am);
      // ほかの生き物（泳いでいる）
      const rr = rng(77), crowd = [];
      for (let i = 0; i < 9; i++) {
        const isFish = i % 3 !== 0, o = isFish ? fishMesh(["#5b8fb9", "#e0a040", "#7aa35a", "#c46a6a"][i % 4]) : ammoniteMesh(["#c9a674", "#e2c49a", "#b98f5c"][i % 3]);
        o.scale.setScalar(isFish ? 1.1 + rr() * 0.5 : 0.55 + rr() * 0.25); root.add(o);
        crowd.push({ o, isFish, x0: -95 + rr() * 170, y0: 0 + rr() * 26, z: -25 + rr() * 50, sp: (rr() < 0.5 ? 1 : -1) * (0.6 + rr() * 0.6), ph: rr() * 6 });
      }
      const rs = rng(91), snow = []; for (let i = 0; i < 260; i++) snow.push({ x: -98 + rs() * 196, z: -33 + rs() * 66, ph: rs(), sp: 0.7 + rs() * 0.6 });
      // ほかにも化石になる物（貝・魚の骨・木の葉・小さなアンモナイト）：k＝何まい目の層にうもれるか
      const FOS = [
        { k: 0, x: -72, name: "貝の化石", make: () => { const m = shellMesh(); m.scale.set(4, 2, 3.4); m.rotation.x = Math.PI / 2; return m; } },
        { k: 1, x: 62, name: "魚の化石", make: () => boneFishMesh() },
        { k: 2, x: -48, name: "木の葉の化石", make: () => leafMesh() },
        { k: 3, x: 82, name: "アンモナイトの化石", make: () => { const a = ammoniteMesh("#a08d70"); a.scale.setScalar(0.55); return a; } },
        { k: 4, x: -85, name: "貝の化石", make: () => { const m = shellMesh(); m.scale.set(3.4, 1.8, 3); m.rotation.x = Math.PI / 2; return m; } },
      ];
      const FT = ["sand", "mud", "sand", "gravel", "mud", "sand"], NM = { sand: "砂", mud: "どろ", gravel: "れき" }, PC = { sand: 0xd8b850, mud: 0x6f7a77, gravel: 0x9b6a35 };
      return (t) => {
        const U = 190 * ease(seg(t, 0.68, 0.8)), sh = quake(t, [0.7, 0.74, 0.78]);
        root.position.x = sh;
        const fl0 = 470 - U, n = 6, th = 26, grow = seg(t, 0.28, 0.6) * n, tops = [];
        for (let i = 0; i <= n; i++) { const k = n - i; tops[i] = fl0 - th * (k - 1) - th * clamp(grow - (k - 1)); }
        const er = ease(seg(t, 0.8, 0.9)), valley = (x) => 175 * er * Math.pow(Math.max(0, 1 - Math.abs(x - 470) / 230), 1.2);
        const surf = t > 0.8 ? xs.map((x) => tops[0] + valley(x)) : null;
        const B = []; for (let i = 0; i <= n; i++) B.push(xs.map(() => Math.min(tops[i], fl0)));
        const list = [band2(xs, xs.map(() => fl0), xs.map(() => 700), "mudstone")].concat(strata2(xs, B, FT, surf));
        // 積もっていく砂やどろ（海の中をしずんでくる）と、何枚目かの番号
        if (t > 0.27 && t < 0.62) {
          const gi = Math.min(n - 1, Math.floor(grow)), li = n - 1 - gi, ty = FT[li], topNow = W(0, tops[0])[1], wt = W(0, SL)[1];
          const pts = snow.map((p) => [p.x, lerp(wt - 1, topNow + 0.5, frac(p.ph + t * 14 * p.sp)), p.z]);
          const pp = points("snow", 260, PC[ty], ty === "gravel" ? 2.6 : ty === "sand" ? 1.8 : 1.3); pp.material.color.setHex(PC[ty]); setPoints(pp, pts);
          label("now", (gi + 1) + "まい目：" + NM[ty] + "が積もる", [0, wt - 6, 30], "big");
        }
        for (let k = 0; k < n; k++) { const li = n - 1 - k; if (grow >= k + 0.6 && t < 0.66) label("no" + k, "①②③④⑤⑥"[k] + " " + NM[FT[li]], [92, W(0, (B[li][0] + B[li + 1][0]) / 2)[1], 36]); }
        const gg = seg(t, 0.8, 0.9); // 陸になってから、だんだん草が生える
        if (gg > 0) { const s2 = xs.map((x, k) => (surf ? Math.max(tops[0], surf[k]) : tops[0])); list.push(band2(xs, s2.map((v) => v - 2.5 * gg), s2, "grass")); }
        ex.set(list);
        [[-82, -15, 1.1], [78, 12, 1.2], [-66, 18, 0.9]].forEach(([x, z, sc], k) => { const g2 = seg(t, 0.88 + k * 0.02, 0.98); if (g2 <= 0) return; const tr = K("tree" + k, () => tree(1)); tr.scale.setScalar(sc * g2); tr.position.set(x, W(0, tops[0])[1], z); });
        oldSea("old", W(0, SL - U)[1], W(0, tops[0])[1], seg(t, 0.74, 0.84), "昔の海面（ここは海の底だった）");
        waterBox("sea", -100.5, 100.5, W(0, 700)[1], W(0, SL)[1]).material.opacity = 0.32 * (1 - seg(t, 0.7, 0.8));
        // アンモナイト
        let p;
        // ほかの生き物：泳ぎ回り、やがて画面の外へ
        crowd.forEach((c) => {
          const leave = ease(seg(t, 0.14, 0.3)), x = c.x0 + Math.sin(t * 9 * c.sp + c.ph) * 22 + leave * 160 * Math.sign(c.sp), dir = Math.cos(t * 9 * c.sp + c.ph) * c.sp + leave * Math.sign(c.sp) * 3;
          c.o.visible = t < 0.32; c.o.position.set(x, c.y0 + Math.sin(t * 20 + c.ph) * 1.5, c.z);
          c.o.rotation.set(c.isFish ? 0 : Math.PI * 0.05, dir < 0 ? Math.PI : 0, 0);
        });
        // 化石になるアンモナイトは、手前の切り口のところにしずむ（うもれていく様子が見えるように）
        if (t < 0.13) p = [lerp(-70, -5, t / 0.13) + Math.sin(t * 40) * 6, 18 + Math.sin(t * 60) * 2, lerp(5, 30, t / 0.13)];
        else if (t < 0.28) { const u = seg(t, 0.13, 0.26); p = [lerp(-5, 4, u), lerp(18, W(0, fl0)[1] + 1.6, ease(u)), lerp(30, 33.5, u)]; }
        else p = [4, W(0, fl0)[1] + 1.6, 33.5];
        am.position.set(p[0], p[1], p[2]);
        am.rotation.set(0, 0, -0.3 * seg(t, 0.13, 0.26));
        am.scale.setScalar(0.9);
        am.userData.m.color.copy(mixC("#d9b98a", "#8d8478", seg(t, 0.5, 0.65)));
        am.scale.setScalar(1.25);
        if (t > 0.8) am.userData.m.color.copy(mixC("#8d8478", "#e2c08a", seg(t, 0.86, 0.92))); // 見つかると、よく見えるように明るく
        if (t > 0.3 && t < 0.86) label("um", t > 0.55 ? "化石になった殻" : "うもれていく殻", [p[0] - 20, p[1], 36]);
        // ほかの化石：k まい目の層が積もったときに、その層の中（手前の切り口）にうもれる
        FOS.forEach((f, i) => {
          const li = n - 1 - f.k; if (grow < f.k + 0.5) return;
          const o = K("fos" + i, f.make), i2 = clamp(Math.round((f.x * 5 + 500 + 20) / 8), 0, xs.length - 1);
          const y = W(0, (B[li][i2] + B[li + 1][i2]) / 2)[1];
          o.position.set(f.x, y, 35.6);
          if (t > 0.86) label("fn" + i, f.name, [f.x, y + 7, 36], "big");
        });
        if (t > 0.86) {
          label("um", "アンモナイトの化石", [p[0], p[1] + 9, 36], "big");
          // 見つかった化石を光る輪でかこむ
          [[p[0], p[1]]].concat(FOS.map((f, i) => { const o = keyed.get("fos" + i); return o ? [o.position.x, o.position.y] : null; }).filter(Boolean)).forEach(([x, y], i) => {
            const ring = K("ring" + i, () => new THREE.Mesh(new THREE.TorusGeometry(8, 0.7, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd400 })));
            ring.position.set(x, y, 36.2); ring.scale.setScalar(1 + 0.08 * Math.sin(t * 120));
          });
          const pp = K("person", () => person()); pp.position.set(18, p[1] - 1, 10); label("found", "化石が いくつも見つかった！", [0, W(0, tops[0])[1] + 14, 30], "big");
        }
        if (U < 60) label("umi", "海", [80, 30, 35]);
      };
    },
  });

  // ---- ⑥ 土地がもち上がり、地層が見えるまで ----
  SCENES.push({
    id: "uplift", group: "土地の変化", title: "土地がおし上げられ、地層が見えるまで", short: "⛰ おし上げられて陸に", dur: 26,
    cam: { pos: [70, 70, 170], target: [0, 0, 0] },
    age: agoSpan(1000000),
    stages: [
      { t: 0, s: "海の底", text: "海や湖の底で、地層が積み重なっています。" },
      { t: 0.08, s: "おし上げ", text: "長い年月の間に大きな力が加わり、大地がおし上げられます（地しんのたびに少しずつ）。海の底だった所が陸になります。" },
      { t: 0.3, s: "草や木", text: "海から出たばかりの土地には、はじめは何も生えていません。長い年月の間に、だんだん草が生え、やがて木が育ちます。点線は、昔の海面です。" },
      { t: 0.48, s: "しん食", text: "陸になった土地を、雨や川の流れる水がしん食して、谷ができます。" },
      { t: 0.85, s: "がけの地層", text: "けずられたがけに、海の底でできた地層がしま模様になって見えます。ヒマラヤ山脈の山頂近くでも、海でできた地層やアンモナイトの化石が見つかります。" },
    ],
    build() {
      const xs = XS(8), SL = 230, n = 7, th = 32, top0 = 330, types = ["gravel", "sand", "mud", "ash", "sand", "mud", "gravel"], ex = extruder();
      const riv = boxMesh(1, 1.2, D, mat("river", COL.river)); root.add(riv);
      return (t) => {
        const qs = [0.12, 0.2, 0.28, 0.36, 0.43], U = 200 * ease(seg(t, 0.08, 0.45));
        root.position.x = quake(t, qs);
        const top = top0 - U, e = ease(seg(t, 0.48, 0.85)), valley = (x) => 185 * e * Math.pow(Math.max(0, 1 - Math.abs(x - 520) / 260), 1.4);
        const surf = xs.map((x) => top + valley(x));
        const B = []; for (let i = 0; i <= n; i++) B.push(xs.map(() => top + th * i));
        const list = [band2(xs, xs.map((x, k) => Math.max(top + th * n, surf[k])), xs.map(() => 700), "mudstone")].concat(strata2(xs, B, types, surf));
        const gg = seg(t, 0.3, 0.45); // 海から出てしばらくは土がむき出し → だんだん草が生える
        if (top < SL && gg > 0) list.push(band2(xs, surf.map((v) => v - 2.5 * gg), surf, "grass"));
        ex.set(list);
        oldSea("old", W(0, SL - U)[1], W(0, top)[1], seg(t, 0.28, 0.4), "昔の海面（ここは海の底だった）");
        waterBox("sea", -100.5, 100.5, W(0, top + 4)[1], W(0, SL)[1]);
        [[300, 2], [760, 4]].forEach(([x, i], k) => { const s = K("sh" + k, () => shellMesh()); const w = W(x, top + th * i + 18); s.position.set(w[0], w[1], 35.3); s.rotation.x = Math.PI / 2; });
        [[-80, 10, 1], [70, -10, 1.2], [86, 20, 0.9], [-70, -22, 1.1]].forEach(([x, z, s], k) => { const g2 = seg(t, 0.45 + k * 0.04, 0.62 + k * 0.04); if (g2 <= 0) return; const tr = K("tree" + k, () => tree(1)); tr.scale.setScalar(s * g2); tr.position.set(x, W(0, top)[1], z); });
        riv.visible = e > 0.05; const yb = W(0, top + valley(520))[1]; riv.scale.set(6 + 8 * e, 1, 1); riv.position.set(W(520, 0)[0], yb + 0.4, 0);
        if (t > 0.08 && t < 0.45) { for (let i = 0; i < 3; i++) arrow("up" + i, [-60 + i * 60, -90, 42], [-60 + i * 60, -50, 42]); label("upf", "大地をおし上げる 大きな力", [0, -96, 42], "big red"); }
        if (top > SL) label("umi", "海", [70, W(0, SL)[1] + 3, 35]);
        if (t > 0.85) { const pp = K("person", () => person()); pp.position.set(W(470, 0)[0], W(0, top + valley(470))[1], 22); label("see", "がけに しま模様が見える！", [4, W(0, top + valley(520) - 110)[1], 30], "big"); }
      };
    },
  });

  // ---- ⑦ しゅう曲 ----
  SCENES.push({
    id: "fold", group: "土地の変化", title: "しゅう曲（地層が曲がる）〔中学校で学ぶ〕", short: "〰 しゅう曲", dur: 22,
    cam: { pos: [50, 55, 205], target: [0, 0, 0] },
    age: agoSpan(2000000),
    stages: [
      { t: 0, s: "水平な地層", text: "海の底でできた地層は、はじめは水平に積み重なっています。" },
      { t: 0.1, s: "おす力", text: "大地の動きによって、地層に両側からおす大きな力が、長い間はたらき続けます。" },
      { t: 0.45, s: "曲がる", text: "地層はこわれずに、波のように曲がっていきます。これを「しゅう曲」といいます。" },
      { t: 0.85, s: "山形と谷形", text: "山のように盛り上がった所を「背斜（はいしゃ）」、谷のように下がった所を「向斜（こうしゃ）」といいます。" },
    ],
    build() {
      const N = 7, th0 = 34, top0 = 230, types = ["sand", "mud", "ash", "gravel", "sand", "mud", "sand"], ex = extruder();
      return (t) => {
        const s = ease(seg(t, 0.1, 0.85)), Wd = 800 - 230 * s, cx = 500, A = 88 * s, th = th0 * (1 + 0.22 * s);
        const us = []; for (let i = 0; i <= 80; i++) us.push(i / 80);
        const xs = us.map((u) => cx + (u - 0.5) * Wd), fold = (u) => Math.cos(2 * Math.PI * (u - 0.5) * 1.25);
        const B = []; for (let i = 0; i <= N; i++) B.push(us.map((u) => top0 - (th - th0) * N * 0.5 + th * i - A * fold(u)));
        const list = strata2(xs, B, types);
        list.push(band2(xs, B[N], xs.map(() => 640), "deep"));
        ex.set(list);
        if (t > 0.08) { const L = 42, x0 = W(xs[0], 0)[0], x1 = W(xs[80], 0)[0], p = 1 + 0.15 * Math.sin(t * 80) * (s < 1 ? 1 : 0); arrow("l", [x0 - L * p - 4, -12, 20], [x0 - 2, -12, 20], 0xd0342c, 5); arrow("r", [x1 + L * p + 4, -12, 20], [x1 + 2, -12, 20], 0xd0342c, 5); label("lf", "おす力", [x0 - 26, 6, 20], "big red"); label("rf", "おす力", [x1 + 26, 6, 20], "big red"); }
        if (t > 0.85) { label("ant", "背斜（山形）", [0, W(0, B[0][40])[1] + 8, 35], "big"); label("syn1", "向斜（谷形）", [W(xs[8], 0)[0], W(0, B[0][8])[1] + 8, 35]); label("syn2", "向斜（谷形）", [W(xs[72], 0)[0], W(0, B[0][72])[1] + 8, 35]); }
      };
    },
  });

  // ---- ⑧⑨ 断層 ----
  function faultBuild(kind) {
    return () => {
      const N = 8, th = 36, top0 = 200, types = ["sand", "mud", "gravel", "ash", "sand", "mud", "sand", "mudstone"];
      const tanA = 0.577, xf = (y) => 430 + (y - top0) * tanA, slips = [0.25, 0.5, 0.75], DD = 26;
      const exF = extruder(), exH = extruder();
      const hang = new THREE.Group(); root.add(hang);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xd0342c, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })); root.add(plane);
      const tF = tree(1.2), hF = house(1.2), tH = tree(1.2), hH = house(1.2); root.add(tF, hF); hang.add(tH, hH);
      return (t) => {
        let d = 0; for (const q of slips) d += DD * ease(seg(t, q, q + 0.03));
        const dir = kind === "normal" ? 1 : -1, dx = dir * d * 0.5, dy = dir * d * 0.866;
        root.position.set(quake(t, slips, 1.5), quake(t, slips, 0.5), 0);
        const ys = []; for (let i = 0; i <= N; i++) ys.push(top0 + th * i); ys[N] = 900;
        const lf = [], lh = [];
        for (let i = 0; i < N; i++) {
          lf.push({ type: types[i], pts: [[-120, ys[i]], [xf(ys[i]), ys[i]], [xf(ys[i + 1]), ys[i + 1]], [-120, ys[i + 1]]].map((p) => W(p[0], p[1])) });
          lh.push({ type: types[i], pts: [[xf(ys[i]) + dx, ys[i] + dy], [1150, ys[i] + dy], [1150, ys[i + 1] + dy], [xf(ys[i + 1]) + dx, ys[i + 1] + dy]].map((p) => W(p[0], p[1])) });
        }
        lf.push({ type: "grass", pts: [[-120, top0 - 3], [xf(top0 - 3), top0 - 3], [xf(top0), top0], [-120, top0]].map((p) => W(p[0], p[1])) });
        lh.push({ type: "grass", pts: [[xf(top0 - 3) + dx, top0 - 3 + dy], [1150, top0 - 3 + dy], [1150, top0 + dy], [xf(top0) + dx, top0 + dy]].map((p) => W(p[0], p[1])) });
        exF.set(lf); exH.set(lh);
        const ty = W(0, top0)[1];
        tF.position.set(-60, ty + 0.6, -10); hF.position.set(-38, ty + 0.6, 12);
        tH.position.set(55, ty + 0.6 - dy / 5, -10); tH.position.x = 55 + dx / 5; hH.position.set(78 + dx / 5, ty + 0.6 - dy / 5, 12);
        // 断層面
        const a = W(xf(top0 - 40), top0 - 40), b = W(xf(700), 700), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        plane.scale.set(len, D + 2, 1); plane.position.set(mid[0], mid[1], 0);
        plane.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])));
        plane.rotateX(Math.PI / 2);
        if (t > 0.05) {
          if (kind === "normal") { arrow("l", [-18, 50, 30], [-95, 50, 30], 0xd0342c, 5); arrow("r", [18, 50, 30], [95, 50, 30], 0xd0342c, 5); label("f", "引っぱる力", [0, 70, 30], "big red"); }
          else { arrow("l", [-105, 50, 30], [-25, 50, 30], 0xd0342c, 5); arrow("r", [105, 50, 30], [25, 50, 30], 0xd0342c, 5); label("f", "おす力", [0, 70, 30], "big red"); }
        }
        if (d > 1) label("dan", "断層", [W(xf(420), 420)[0] + 6, W(0, 420)[1], 36], "red");
        if (t > 0.82) {
          label("res", kind === "normal" ? "上盤がずり下がった → 正断層" : "上盤がずり上がった → 逆断層", [-55, 30, 30], "big");
          label("uw", "上盤（断層面の上側）", [60 + dx / 5, W(0, 330)[1] - dy / 5, 36]);
          label("lw", "下盤（断層面の下側）", [-60, W(0, 330)[1], 36]);
        }
      };
    };
  }
  SCENES.push({
    id: "normal", group: "土地の変化", title: "断層：正断層（引っぱる力でずれる）", short: "↔ 正断層", dur: 22,
    cam: { pos: [60, 65, 190], target: [0, 8, 0] },
    age: (t) => ago(30000 * (1 - t)) + "（地しん1回で 数十cm〜数m ずれる）",
    stages: [
      { t: 0, s: "引っぱる力", text: "地層に、左右に引っぱる大きな力がはたらいています。" },
      { t: 0.24, s: "ずれる", text: "力にたえられなくなると、地層が割れてずれます。このとき地しんが起きます。地層がずれている部分を「断層」といいます。" },
      { t: 0.5, s: "くり返す", text: "ずれは、地しんのたびにくり返されて大きくなります。地面に段差ができることもあります。" },
      { t: 0.82, s: "正断層", text: "引っぱる力で、断層面の上側（上盤）がずり下がったずれを「正断層」といいます（中学校で学ぶ言葉）。同じ層が、断層の所で食いちがっています。" },
    ],
    build: faultBuild("normal"),
  });
  SCENES.push({
    id: "reverse", group: "土地の変化", title: "断層：逆断層（おす力でずれる）", short: "→← 逆断層", dur: 22,
    cam: { pos: [60, 65, 190], target: [0, 8, 0] },
    age: (t) => ago(30000 * (1 - t)) + "（地しん1回で 数十cm〜数m ずれる）",
    stages: [
      { t: 0, s: "おす力", text: "地層に、左右からおす大きな力がはたらいています。日本列島には、このおす力がはたらいている所が多くあります。" },
      { t: 0.24, s: "ずれる", text: "力にたえられなくなると、地層が割れてずれ、地しんが起きます。" },
      { t: 0.5, s: "くり返す", text: "地しんのたびにずれが大きくなり、土地がもり上がっていきます。" },
      { t: 0.82, s: "逆断層", text: "おす力で、断層面の上側（上盤）がずり上がったずれを「逆断層」といいます（中学校で学ぶ言葉）。" },
    ],
    build: faultBuild("reverse"),
  });

  // ---- ⑩ 横ずれ断層 ----
  SCENES.push({
    id: "strike", group: "土地の変化", title: "断層：横ずれ断層（地面が横にずれる）", short: "⇅ 横ずれ断層", dur: 22,
    cam: { pos: [40, 130, 120], target: [0, -5, 0] },
    age: (t) => ago(30000 * (1 - t)) + "（地しん1回で 数十cm〜数m ずれる）",
    stages: [
      { t: 0, s: "ようす", text: "道路・川・並木が、断層をまたいでいます。" },
      { t: 0.24, s: "ずれる", text: "地しんが起きると、断層の両側の土地が、横（水平）にずれます。" },
      { t: 0.5, s: "くり返す", text: "地しんのたびにずれが大きくなり、道路や川が食いちがっていきます。" },
      { t: 0.82, s: "横ずれ断層", text: "このように横にずれる断層を「横ずれ断層」といいます。1995年の兵庫県南部地しんでは、淡路島で野島断層が地面に現れました。熊本地しん（2016年）でも、地面が約2mずれました。" },
    ],
    build() {
      const slips = [0.25, 0.5, 0.75], DD = 9;
      function side(x0, x1) {
        const g = new THREE.Group(), w = x1 - x0, cx = (x0 + x1) / 2;
        [["soil", 0, -5], ["sand", -5, -18], ["mud", -18, -32], ["gravel", -32, -45]].forEach(([ty, a, b]) => { const m = boxMesh(w, a - b, 110, mat(ty)); m.position.set(cx, (a + b) / 2, 0); g.add(m); });
        const gr = boxMesh(w, 0.6, 110, mat("grass")); gr.position.set(cx, 0.3, 0); g.add(gr);
        const road = boxMesh(w, 0.5, 11, mat("road", "#6f7478")); road.position.set(cx, 0.8, 0); g.add(road);
        for (let x = x0 + 4; x < x1 - 4; x += 9) { const d = boxMesh(4.5, 0.2, 0.9, mat("white", "#ffffff")); d.position.set(x, 1.1, 0); g.add(d); }
        const rv = boxMesh(w, 0.5, 9, mat("river", COL.river)); rv.position.set(cx, 0.75, 32); g.add(rv);
        for (let x = x0 + 6; x < x1; x += 12) { const tr = tree(0.9); tr.position.set(x, 0.6, -30); g.add(tr); }
        for (let x = x0 + 10; x < x1; x += 24) { const h = house(0.9); h.position.set(x, 0.6, 15); g.add(h); }
        return g;
      }
      const L = side(-90, 0), R = side(0, 90); root.add(L, R);
      const line = boxMesh(0.8, 0.4, 112, new THREE.MeshBasicMaterial({ color: 0xd0342c })); line.position.set(0, 1.4, 0); root.add(line);
      return (t) => {
        let d = 0; for (const q of slips) d += DD * ease(seg(t, q, q + 0.03));
        const sh = quake(t, slips, 1.3);
        L.position.set(sh, 0, -d / 2); R.position.set(sh, 0, d / 2);
        if (t > 0.2) { arrow("al", [-45, 14, 30], [-45, 14, -20], 0xd0342c, 4); arrow("ar", [45, 14, -30], [45, 14, 20], 0xd0342c, 4); }
        label("dan", "断層", [0, 6, -50], "red");
        if (t > 0.82) label("res", "道路も川も 食いちがった！", [0, 18, 40], "big");
      };
    },
  });

  // ---- ⑪ 不整合 ----
  SCENES.push({
    id: "unconf", group: "土地の変化", title: "不整合（地層の重なりの切れ目）〔中学校で学ぶ〕", short: "⚡ 不整合", dur: 30,
    cam: { pos: [60, 55, 165], target: [0, -5, 0] },
    age: agoSpan(5000000),
    stages: [
      { t: 0, s: "積もる", text: "海の底で、地層が積み重なります。" },
      { t: 0.25, s: "おし上げ", text: "大地の動きで、地層がおし上げられ、かたむいて陸になります。" },
      { t: 0.45, s: "しん食", text: "陸になった地層の上の方が、雨や風、流れる水で長い間けずられます。" },
      { t: 0.62, s: "しずむ", text: "土地がしずんで、ふたたび海の底になります。" },
      { t: 0.72, s: "また積もる", text: "けずられた面の上に、新しい地層が水平に積もります。いちばん下には、けずられた石（れき）がたまります。" },
      { t: 0.93, s: "不整合", text: "下のかたむいた地層と上の地層の間の、けずられた面を「不整合」といいます。ここで長い時間がぬけていることがわかります。" },
    ],
    build() {
      const xs = XS(8), SL = 300, nL = 6, thL = 30, baseL = 560, nU = 4, thU = 26, ex = extruder();
      const lowT = ["sand", "mud", "gravel", "sand", "ash", "mud"], upT = ["gravel", "sand", "mud", "sand"];
      const wav = (x) => Math.sin(x * 0.045) * 7 + Math.sin(x * 0.013 + 1) * 6;
      const redLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd0342c })); root.add(redLine);
      return (t) => {
        const tilt = Math.tan((12 * Math.PI / 180) * ease(seg(t, 0.25, 0.45))), U = 200 * ease(seg(t, 0.25, 0.45)), Dn = 210 * ease(seg(t, 0.62, 0.72));
        root.position.x = quake(t, [0.29, 0.35, 0.41, 0.65]);
        const grow = seg(t, 0.03, 0.25) * nL, Bl = [];
        for (let i = 0; i <= nL; i++) { const lvl = Math.min(i, grow); Bl[i] = xs.map((x) => baseL - thL * lvl + (x - 500) * tilt - U + Dn); }
        const topLow = Bl[nL], ePost = lerp(Math.min(...topLow.map((v) => v - Dn)), 255, ease(seg(t, 0.45, 0.62)));
        const surf = xs.map((x, k) => (t > 0.45 ? Math.max(topLow[k], ePost + Dn + wav(x)) : topLow[k]));
        const list = [band2(xs, Bl[0], xs.map(() => 760), "mudstone")].concat(strata2(xs, Bl.slice().reverse(), lowT.slice().reverse(), surf));
        const gu = seg(t, 0.72, 0.93) * nU;
        if (gu > 0) { let below = surf.slice(); const flat = ePost + Dn; for (let j = 0; j < nU; j++) { const f = clamp(gu - j); if (f <= 0) break; const top = xs.map((x, k) => Math.min(below[k], flat - thU * (j + f) + (j === 0 ? 4 : 0))); list.push(band2(xs, top, below, upT[j])); below = top; } }
        if (t > 0.3 && t < 0.66 && Math.min(...surf) < SL) { const lx = []; const idx = []; xs.forEach((x, k) => { if (surf[k] < SL) { lx.push(x); idx.push(k); } }); if (lx.length > 2) list.push(band2(lx, idx.map((k) => surf[k] - 2.5), idx.map((k) => surf[k]), "grass")); }
        ex.set(list);
        waterBox("sea", -100.5, 100.5, -90, W(0, SL)[1]);
        redLine.visible = t > 0.93;
        if (redLine.visible) { const p = []; xs.forEach((x, k) => { const w = W(x, surf[k]); p.push(new THREE.Vector3(w[0], w[1], 35.3)); }); redLine.geometry.setFromPoints(p); label("un", "不整合（けずられた面）", [10, W(0, surf[65])[1] - 8, 36], "big red"); }
        if (t > 0.4 && t < 0.64) oldSea("old", W(0, SL - U + Dn)[1], W(0, Math.min(...surf))[1], seg(t, 0.4, 0.45) * (1 - seg(t, 0.6, 0.63)), "昔の海面（ここは海の底だった）");
        if (t > 0.25 && t < 0.45) { arrow("up", [0, -95, 42], [0, -50, 42]); label("upf", "大地をおし上げる力", [0, -100, 42], "big red"); }
        if (t > 0.62 && t < 0.72) { arrow("dn", [0, 60, 42], [0, 20, 42], 0x2a77a8); label("dnf", "土地がしずむ", [0, 66, 42], "big"); }
      };
    },
  });

  // ---- 火山（半分に切った火山）共通 ----
  function volcanoParts(opt) {
    const G0 = 0;
    // 地面（おくの半分）
    const ex = extruder(80, -80);
    ex.set([{ type: "sand", pts: [[-110, G0], [110, G0], [110, -16], [-110, -16]] }, { type: "mudstone", pts: [[-110, -16], [110, -16], [110, -75], [-110, -75]] }, { type: "grass", pts: [[-110, G0 + 0.8], [110, G0 + 0.8], [110, G0], [-110, G0]] }]);
    const chamberMat = new THREE.MeshLambertMaterial({ color: 0xff7b2c, emissive: 0xff4a00, emissiveIntensity: 0.7 });
    const chamber = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, Math.PI, Math.PI), chamberMat); chamber.scale.set(42, 10, 26); chamber.position.set(0, -52, 0); root.add(chamber);
    const cap = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(new THREE.EllipseCurve(0, 0, 42, 10).getPoints(40))), chamberMat); cap.position.set(0, -52, 0.15); root.add(cap);
    const pipeMat = new THREE.MeshLambertMaterial({ color: 0xff7b2c, emissive: 0xff4a00, emissiveIntensity: 0.6 });
    const pipe = boxMesh(5, 1, 3, pipeMat); root.add(pipe);
    return { ex, chamber, chamberMat, cap, pipe, pipeMat };
  }
  /** 円すいの層（おく半分）を回して作る：profFn(r) 上の面、botFn(r) 下の面 */
  function coneLayer(topFn, botFn, R, m, existing) {
    const pts = [];
    const n = 40;
    for (let i = 0; i <= n; i++) { const r = (i / n) * R; pts.push(new THREE.Vector2(Math.max(0.001, r), topFn(r))); }
    for (let i = n; i >= 0; i--) { const r = (i / n) * R; pts.push(new THREE.Vector2(Math.max(0.001, r), Math.min(botFn(r), topFn(r) - 0.01))); }
    pts.push(pts[0].clone());
    const g = new THREE.LatheGeometry(pts, 36, Math.PI / 2, Math.PI);
    const capPts = []; for (let i = n; i >= 0; i--) { const r = (i / n) * R; capPts.push(new THREE.Vector2(-r, topFn(r))); } for (let i = 1; i <= n; i++) { const r = (i / n) * R; capPts.push(new THREE.Vector2(r, topFn(r))); }
    for (let i = n; i >= 1; i--) { const r = (i / n) * R; capPts.push(new THREE.Vector2(r, Math.min(botFn(r), topFn(r) - 0.01))); } for (let i = 0; i <= n; i++) { const r = (i / n) * R; capPts.push(new THREE.Vector2(-r, Math.min(botFn(r), topFn(r) - 0.01))); }
    const cg = new THREE.ShapeGeometry(new THREE.Shape(capPts)); cg.translate(0, 0, 0.05);
    const merged = existing || new THREE.Group();
    if (!existing) { merged.add(new THREE.Mesh(g, m), new THREE.Mesh(cg, m)); root.add(merged); }
    else { merged.children[0].geometry.dispose(); merged.children[0].geometry = g; merged.children[1].geometry.dispose(); merged.children[1].geometry = cg; merged.children[0].material = merged.children[1].material = m; }
    return merged;
  }

  // ---- ⑫ 火山の噴火で土地が変わる ----
  SCENES.push({
    id: "volcano", group: "土地の変化", title: "火山の噴火で土地が変わる（マグマ・溶岩・火山灰）", short: "🌋 火山の噴火", dur: 32,
    cam: { pos: [90, 50, 215], target: [0, 10, -12] },
    age: agoSpan(100000),
    stages: [
      { t: 0, s: "マグマ", text: "地下深くには、岩石がどろどろにとけた「マグマ」があります。火山を半分に切って、中を見てみましょう。" },
      { t: 0.08, s: "噴火・溶岩", text: "マグマが上がってきて火口からふき出すのが「噴火」です。地表に流れ出たマグマを「溶岩」といいます。真っ赤な溶岩が山のしゃ面を流れ下ります。" },
      { t: 0.16, s: "固まる", text: "流れ出た溶岩は、空気にふれて冷え、黒っぽい岩石に固まっていきます。大地が溶岩でおおわれます。" },
      { t: 0.22, s: "火山灰", text: "火山灰や軽石などもふき出され、まわりに降り積もって層になります。" },
      { t: 0.36, s: "くり返す", text: "噴火がくり返されると、溶岩と火山灰の層が交互に重なって、山がどんどん高くなります（富士山もこうしてできた火山です）。" },
      { t: 0.9, s: "新しい土地", text: "噴火によって新しい山ができたり（長崎県の平成新山）、海の中で島が広がったり（東京都の西之島）、土地のようすが変わります。" },
    ],
    build() {
      const vp = volcanoParts();
      const erup = [[0.08, 0.2, "lava"], [0.22, 0.34, "ash"], [0.36, 0.48, "lava"], [0.5, 0.62, "ash"], [0.64, 0.76, "lava"], [0.78, 0.9, "ash"]];
      const h = (k) => 16 + 10 * k, Rk = (k) => 34 + 11 * k;
      const prof = (k, r) => (k < 0 ? 0 : Math.max(0, h(k) * (1 - r / Rk(k))) - (r < 3.5 ? 3 : 0));
      const layers = erup.map(() => null), mats = erup.map(([, , kind]) => (kind === "ash" ? mat("ash") : new THREE.MeshLambertMaterial({ color: 0xff5a1f, emissive: 0xff3300, emissiveIntensity: 0.8 })));
      const r = rng(31), bombs = []; for (let i = 0; i < 60; i++) bombs.push({ a: r() * Math.PI - Math.PI, v: 0.5 + r() * 0.6, ph: r() });
      const ashF = []; for (let i = 0; i < 400; i++) ashF.push({ x: (r() - 0.5) * 200, z: -r() * 78, ph: r() });
      return (t) => {
        let last = -1;
        erup.forEach(([a, , kind]) => boom(t, a, kind === "lava" ? "ドカーン！ 噴火（溶岩）" : "ドカーン！ 噴火（火山灰）"));
        erup.forEach(([a, b, kind], k) => {
          const g = seg(t, a, b); if (g <= 0) { if (layers[k]) layers[k].visible = false; return; }
          last = k;
          let top;
          if (kind === "lava") { const front = Rk(k) * ease(g) * 1.05; top = (rr) => (rr <= front ? Math.max(prof(k, rr), prof(k - 1, rr) + 0.01) : prof(k - 1, rr) + 0.01); }
          else top = (rr) => lerp(prof(k - 1, rr), Math.max(prof(k, rr), prof(k - 1, rr)), ease(g)) + 0.01;
          layers[k] = coneLayer(top, (rr) => prof(k - 1, rr), Math.max(Rk(k), Rk(k - 1 < 0 ? 0 : k - 1)), mats[k], layers[k]);
          layers[k].visible = true;
          if (kind === "lava") { const cool = seg(t, a + 0.05, b + 0.1); mats[k].color.copy(mixC("#ff5a1f", "#4d4440", cool)); mats[k].emissive.copy(mixC("#ff3300", "#000000", cool)); mats[k].emissiveIntensity = 0.8 * (1 - cool); }
        });
        const peak = Math.max(0, prof(last, 0) + 3);
        vp.pipe.scale.y = 52 + peak; vp.pipe.position.set(0, (-42 + peak) / 2, -1.5);
        const now = erup.find(([a, b]) => t > a && t < b);
        if (now && now[2] === "lava") {
          const pts = []; for (const p of bombs) { const s = frac(p.ph + t * 14); pts.push([Math.cos(p.a) * 30 * s * p.v, peak + Math.sin(-p.a) * 40 * s * p.v - 60 * s * s, Math.sin(p.a) * 12 * s - 5]); }
          setPoints(points("bomb", 60, 0xff6a20, 2.2), pts);
          label("lava", "溶岩が流れ出す", [-30, peak * 0.5 + 6, -20], "big red");
        }
        if (now && now[2] === "ash") {
          for (let i = 0; i < 7; i++) { const s = frac(t * 8 + i / 7); const m = K("pl" + i, () => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshLambertMaterial({ color: 0x5f5550, transparent: true, opacity: 0.55 }))); const rad = 5 + 12 * s; m.scale.set(rad, rad * 0.8, rad); m.position.set(25 * s, peak + 6 + 60 * s, -10); m.material.opacity = 0.55 * (1 - s * 0.6); }
          const fall = []; for (const p of ashF) { const s = frac(p.ph + t * 7), y = lerp(90, 0, s); const rr = Math.hypot(p.x, p.z); if (y < prof(last, rr)) continue; fall.push([p.x, y, p.z]); }
          setPoints(points("ashf", 400, 0x8a3d2a, 0.9), fall);
          label("ashL", "火山灰がふき出す", [30, peak + 30, -10], "big");
        }
        label("mg", "マグマだまり", [52, -52, 2]);
        if (last >= 0) label("kako", "火口", [0, peak + 2, 2]);
        if (t > 0.9) label("res", "溶岩の層と火山灰の層が\n交互に重なっている", [60, 40, 2], "big");
      };
    },
  });

  // ---- ⑬ 火山岩と深成岩 ----
  SCENES.push({
    id: "igneous", group: "岩石", title: "マグマが冷えて岩石に（火山岩と深成岩）〔中学校で学ぶ〕", short: "💎 火山岩と深成岩", dur: 30,
    cam: { pos: [95, 70, 180], target: [10, -5, -10] },
    stages: [
      { t: 0, s: "マグマ", text: "マグマが冷えて固まった岩石を「火成岩」といいます。どこで冷えるかによって、2つのなかまに分かれます。" },
      { t: 0.06, s: "ゆっくり", text: "地下深くのマグマは、まわりが熱いので何万年もかけてゆっくり冷えます。つぶ（結晶）が大きく育ち、大きなつぶがそろって組み合わさります。" },
      { t: 0.42, s: "噴火", text: "とちゅうまで冷えて、少し大きなつぶができたマグマが、噴火で地表に出てきます（溶岩）。" },
      { t: 0.53, s: "急に冷える", text: "地表では急に冷えるので、残りはとても小さなつぶやガラスになります。大きなつぶ（はん晶）が、細かいつぶ（石基）の中に散らばったつくりになります。" },
      { t: 0.72, s: "2つの岩石", text: "地表や地表近くで急に冷えた岩石を「火山岩」、地下深くでゆっくり冷えた岩石を「深成岩」といいます。" },
      { t: 0.86, s: "なかま", text: "火成岩は、白っぽいものから黒っぽいものまであります。花こう岩（みかげ石）は、建物や石がきにも使われています。" },
    ],
    build() {
      const vp = volcanoParts();
      const h = (k) => 13 + 9.5 * k, Rk = (k) => 30 + 11 * k, prof = (k, r) => (k < 0 ? 0 : Math.max(0, h(k) * (1 - r / Rk(k))) - (r < 3.5 ? 3 : 0));
      for (let k = 0; k < 5; k++) coneLayer((r) => Math.max(prof(k, r), prof(k - 1, r) + 0.01), (r) => prof(k - 1, r), Rk(k), k % 2 ? mat("ash") : mat("basalt"));
      const lavaM = new THREE.MeshLambertMaterial({ color: 0xff5a1f, emissive: 0xff3300, emissiveIntensity: 0.8 });
      let lava = null;
      const sV = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshLambertMaterial({ map: igTex("volc", 1) })); sV.position.set(-70, 55, 10); root.add(sV);
      const sP = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshLambertMaterial({ map: igTex("plut", 0) })); sP.position.set(75, -30, 25); root.add(sP);
      const graniteM = new THREE.MeshLambertMaterial({ map: igTex("plut", 0) });
      // 小窓（けんび鏡）
      const r = rng(51), deep = [], phen = [], fine = [];
      for (let gy = -3; gy <= 3; gy++) for (let gx = -3; gx <= 3; gx++) { const x = gx * 40 + (r() - 0.5) * 20, y = gy * 40 + (r() - 0.5) * 20; if (x * x + y * y < 140 * 140) deep.push({ x, y, s: 26 + r() * 14, rot: r() * 3, c: r() < 0.3 ? "#2d2a26" : r() < 0.55 ? "#f2efe8" : "#e9d3c4", st: 0.08 + r() * 0.4 }); }
      for (let i = 0; i < 8; i++) phen.push({ x: (r() - 0.5) * 200, y: (r() - 0.5) * 200, s: 18 + r() * 12, rot: r() * 3, c: i % 3 === 0 ? "#2d2a26" : "#f2efe8", st: 0.06 + r() * 0.2 });
      for (let i = 0; i < 900; i++) { const a = r() * 6.3, d = Math.sqrt(r()) * 145; fine.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, c: r() < 0.4 ? "#1f1f1f" : "#d8d4cc", st: 0.53 + r() * 0.1 }); }
      return (t) => {
        const cool = seg(t, 0.06, 0.9);
        vp.chamberMat.color.copy(mixC("#ff7b2c", "#d9d2c6", cool)); vp.chamberMat.emissiveIntensity = 0.7 * (1 - cool);
        if (cool > 0.95) { vp.chamber.material = vp.cap.material = graniteM; } else { vp.chamber.material = vp.cap.material = vp.chamberMat; }
        const peak = prof(4, 0) + 3;
        vp.pipe.scale.y = 52 + peak; vp.pipe.position.set(0, (-42 + peak) / 2, -1.5);
        vp.pipeMat.emissiveIntensity = t > 0.42 && t < 0.6 ? 0.8 : 0.1; vp.pipeMat.color.copy(t > 0.42 && t < 0.6 ? C3("#ff7b2c") : C3("#7a6a5e"));
        boom(t, 0.42, "ドカーン！ 噴火");
        const g = seg(t, 0.42, 0.53);
        if (g > 0) { const front = Rk(5) * ease(g); lava = coneLayer((rr) => (rr <= front ? Math.max(prof(5, rr), prof(4, rr) + 0.01) : prof(4, rr) + 0.01), (rr) => prof(4, rr), Rk(5), lavaM, lava); lava.visible = true; const c2 = seg(t, 0.53, 0.65); lavaM.color.copy(mixC("#ff5a1f", "#5a5652", c2)); lavaM.emissiveIntensity = 0.8 * (1 - c2); }
        else if (lava) lava.visible = false;
        sV.visible = t > 0.72; sP.visible = t > 0.72; sV.rotation.y = sP.rotation.y = t * 8;
        label("A", "A 地表（急に冷える）", [-40, peak + 14, 2], "big");
        label("B", "B 地下深く（ゆっくり冷える）", [0, -38, 4], "big");
        if (t > 0.72) { label("sV", "火山岩（例：安山岩）", [-70, 69, 10], "big"); label("sP", "深成岩（例：花こう岩）", [75, -14, 25], "big"); }
        const tbl = t > 0.86;
        insets(tbl ? [{ key: "table", wide: true, cap: "火成岩のなかま（左ほど白っぽい・右ほど黒っぽい）", draw: (gg, w, hh) => {
          gg.fillStyle = "#fff"; gg.fillRect(0, 0, w, hh);
          const rows = [["火山岩", ["流紋岩", "安山岩", "玄武岩"]], ["深成岩", ["花こう岩", "せん緑岩", "はんれい岩"]]];
          rows.forEach(([nm, list], ri) => { gg.fillStyle = "#1f2a33"; gg.font = "bold 22px sans-serif"; gg.fillText(nm, 8, 80 + ri * 140); list.forEach((rk, ci) => { const x = 100 + ci * 140, y = 20 + ri * 140; const c = document.createElement("canvas"); c.width = c.height = 120; drawIgneous(c.getContext("2d"), 120, ri ? "plut" : "volc", ci, 20 + ri * 3 + ci); gg.drawImage(c, x, y, 120, 100); gg.fillStyle = "rgba(255,255,255,.9)"; gg.fillRect(x, y + 100, 120, 28); gg.fillStyle = "#1f2a33"; gg.font = "bold 18px sans-serif"; gg.fillText(rk, x + 8, y + 121); }); });
        } }] : [
          { key: "A", cap: t > 0.72 ? "A 火山岩：はん晶＋石基" : "A のつぶ（けんび鏡）", draw: (gg, n) => {
            const q = seg(t, 0.53, 0.65); gg.fillStyle = q > 0 ? (q > 0.99 ? "#6e6a66" : "#c48354") : "#ff9b4a"; gg.fillRect(0, 0, n, n);
            for (const f of fine) if (t > f.st) { gg.fillStyle = f.c; gg.fillRect(150 + f.x, 150 + f.y, 3, 2); }
            for (const p of phen) { const s = p.s * ease(seg(t, p.st, 0.45)); if (s > 0.5) xtal(gg, 150 + p.x, 150 + p.y, s, p.rot, p.c); }
          } },
          { key: "B", cap: t > 0.72 ? "B 深成岩：大きなつぶがそろう" : "B のつぶ（けんび鏡）", draw: (gg, n) => {
            gg.fillStyle = cool > 0.5 ? "#d9d2c6" : "#ff9b4a"; gg.fillRect(0, 0, n, n);
            for (const p of deep) { const s = p.s * ease(seg(t, p.st, 0.85)); if (s > 0.5) xtal(gg, 150 + p.x, 150 + p.y, s, p.rot, p.c); }
          } },
        ]);
      };
    },
  });

  // ---- ⑭ 柱状節理 ----
  // 熱い溶岩が上と下から冷える → 冷えた所がちぢもうとして割れ目が入る（どろがかわいてひび割れるのと同じしくみ）
  // → 割れ目は冷えた面に直角に、冷えた部分がふえるにつれて内側へのびる → 上下からの割れ目が出会い、六角形の柱になる
  function drawCracks(g, n, prog, regular, seed) {
    const r = rng(seed), R = n / 7, cells = [];
    for (let q = -1; q <= 9; q++) for (let k = -1; k <= 9; k++) { const x = q * R * 1.5, y = (k + (q % 2 ? 0.5 : 0)) * R * Math.sqrt(3); cells.push([x + (regular ? 0 : (r() - 0.5) * R * 0.5), y + (regular ? 0 : (r() - 0.5) * R * 0.5)]); }
    g.fillStyle = regular ? (prog > 0 ? "#45494d" : "#ff6a2a") : "#8a6a4a"; g.fillRect(0, 0, n, n);
    if (!regular) { g.fillStyle = "rgba(255,255,255," + 0.25 * (1 - prog) + ")"; g.fillRect(0, 0, n, n); }
    g.strokeStyle = regular ? "#121314" : "#3a2a1c"; g.lineCap = "round";
    const rr = rng(seed + 1);
    cells.forEach(([cx, cy]) => {
      for (let e = 0; e < 6; e++) {
        const th = rr(); if (prog < th) continue;
        const a1 = (e / 6) * Math.PI * 2, a2 = ((e + 1) / 6) * Math.PI * 2, w = Math.min(1, (prog - th) * 4);
        g.lineWidth = (regular ? 3 : 4) * w + 0.5;
        g.beginPath(); g.moveTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); g.lineTo(cx + Math.cos(a2) * R, cy + Math.sin(a2) * R); g.stroke();
      }
    });
  }
  SCENES.push({
    id: "column", group: "岩石", title: "柱状節理（六角形の柱の岩）〔発展〕　例：兵庫県の玄武洞", short: "⬡ 柱状節理", dur: 40,
    cam: { pos: [95, 70, 200], target: [0, -18, 12] },
    age: (t) => (t < 0.16 ? "噴火した日（約160万年前）" : t < 0.62 ? "冷えていく（何年〜何十年もかけて）" : ago(1600000 * Math.pow(1 - seg(t, 0.62, 0.97), 1.5))),
    stages: [
      { t: 0, s: "溶岩がたまる", text: "約160万年前、火山の噴火で流れ出たとても熱い溶岩（約1100℃）が、低い所に流れこんで、厚くたまりました。" },
      { t: 0.16, s: "熱がにげる", text: "溶岩は、空気にふれる上の面と、地面にふれる下の面から熱がにげて、外側から冷えて固まっていきます。" },
      { t: 0.24, s: "ちぢんで割れる", text: "冷えて固まった岩は、少しちぢもうとします。でも、まわりとくっついているので引っぱられ、たえきれずに割れ目ができます。どろ水がかわくと、ちぢんでひび割れるのと にた しくみです。" },
      { t: 0.34, s: "割れ目がのびる", text: "割れ目は、冷える面（上の面・下の面）に直角に入ります。冷えた部分がふえるにつれて、割れ目も少しずつ内側へのびていきます。上から見ると、六角形に近い形に分かれます。" },
      { t: 0.54, s: "柱になる", text: "上からのびた割れ目と、下からのびた割れ目が真ん中で出会うと、岩全体が六角形の柱に分かれます。でも、このときはまだ地面の中で、外からは見えません。" },
      { t: 0.62, s: "川が流れる", text: "それから長い年月がたちます。手前にも同じ岩が続いていて、そのふちに川が流れるようになりました（玄武洞では円山川）。" },
      { t: 0.7, s: "川がけずる", text: "川の流れる水が、岩の下の方を少しずつけずります（しん食）。大雨で川の水がふえたときは、とくに強くけずります。雨水も、岩の割れ目にしみこんで、すき間を広げます。" },
      { t: 0.8, s: "柱ごとくずれる", text: "岩はもともと柱の形に割れているので、下がけずられると、割れ目にそって柱ごとくずれ落ちます。くずれた岩は、川の水に運ばれていきます（運ぱん）。これが何度もくり返されて、がけが おくへ下がっていきます。" },
      { t: 0.93, s: "柱状節理", text: "こうして、柱が並んだがけが現れました。これを「柱状節理」といいます。玄武洞は、円山川などにけずられて約6000年前に柱が現れ、そのあと江戸時代に人が石を切り出して、今のような洞になりました。福井県の東尋坊は、日本海の波がけずってできたがけです。" },
    ],
    build() {
      const H = 40, XL = -70, XR = 70, ZB = -35, ZF = 35, ZF2 = 62, Rh = 3.4;
      const base = boxMesh(1, 1, 1, mat("mudstone")); root.add(base);
      const wallL = boxMesh(1, 1, 1, mat("sand", COL.oldrock)); const wallR = boxMesh(1, 1, 1, mat("sand", COL.oldrock)); root.add(wallL, wallR);
      const grassL = boxMesh(1, 1, 1, mat("grass")); const grassR = boxMesh(1, 1, 1, mat("grass")); root.add(grassL, grassR);
      const lavaM = new THREE.MeshLambertMaterial({ color: 0xff5a1f, emissive: 0xff3300, emissiveIntensity: 0.9 });
      const lava = boxMesh(1, 1, 1, lavaM); root.add(lava);
      const cells = [];
      for (let q = -30; q <= 30; q++) for (let k = -12; k <= 22; k++) { const x = q * Rh * 1.5, z = (k + (q % 2 ? 0.5 : 0)) * Rh * Math.sqrt(3); if (x > XL + Rh * 0.8 && x < XR - Rh * 0.8 && z > ZB + Rh * 0.8 && z < ZF2 - Rh * 0.8) cells.push({ x, z }); }
      const ZC0 = Math.min(...cells.map((c) => c.z)) - Rh * 0.95, ZC1 = cells.filter((c) => c.z < ZF - Rh * 0.8).reduce((m, c) => Math.max(m, c.z), -1e9) + Rh * 0.95;
      const XC0 = Math.min(...cells.map((c) => c.x)) - Rh, XC1 = Math.max(...cells.map((c) => c.x)) + Rh;
      const geo = new THREE.CylinderGeometry(1, 1, 1, 6);
      const topM = new THREE.MeshLambertMaterial({ color: 0x3f4448 }), botM = new THREE.MeshLambertMaterial({ color: 0x4a4f53 }), fallM = new THREE.MeshLambertMaterial({ color: 0x55595d });
      const imT = new THREE.InstancedMesh(geo, topM, cells.length), imB = new THREE.InstancedMesh(geo, botM, cells.length), imF = new THREE.InstancedMesh(geo, fallM, cells.length);
      imT.frustumCulled = imB.frustumCulled = imF.frustumCulled = false; root.add(imT, imB, imF);
      const crackBg = boxMesh(1, 1, 1, new THREE.MeshLambertMaterial({ color: 0x141516 })); root.add(crackBg);
      const front = boxMesh(1, 1, 1, mat("mudstone")); root.add(front); // 川の下の地面
      const river = boxMesh(1, 1, 1, new THREE.MeshLambertMaterial({ color: COL.river, transparent: true, opacity: 0.85 })); river.renderOrder = 5; root.add(river);
      const rr0 = rng(13), flowP = []; for (let i = 0; i < 90; i++) flowP.push({ ph: rr0(), w: rr0() });
      const rainP = []; for (let i = 0; i < 300; i++) rainP.push({ x: -100 + rr0() * 200, z: -30 + rr0() * 110, ph: rr0() });
      const dummy = new THREE.Object3D();
      const setBox = (m, x0, x1, y0, y1, z0, z1) => { m.visible = x1 - x0 > 0.01 && y1 - y0 > 0.01 && z1 - z0 > 0.01; m.scale.set(Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0), Math.max(0.01, z1 - z0)); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); };
      const hide = (im, i) => { dummy.position.set(0, -999, 0); dummy.scale.set(0.0001, 0.0001, 0.0001); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); };
      return (t) => {
        const flow = ease(seg(t, 0.02, 0.16)), cool = ease(seg(t, 0.16, 0.58)), crack = seg(t, 0.24, 0.4);
        const ext = ease(seg(t, 0.6, 0.66)), cut = ease(seg(t, 0.68, 0.94)), riv = seg(t, 0.62, 0.66);
        // 手前にも岩が続いている（ext）→ 川がけずって、がけが おくへ下がる（cut）
        const zFront = lerp(ZF, ZF2, ext), zCut = Math.min(zFront, lerp(ZF2, 6, cut));
        const riverY = lerp(-6, -H - 3, Math.min(1, cut * 1.6)), RW = 16;
        const dT = (H / 2) * cool, dB = (H / 2) * cool;
        setBox(base, -100, 100, -H - 40, -H, ZB, zCut);
        setBox(wallL, -100, XL, -H, 0, ZB, zCut); setBox(wallR, XR, 100, -H, 0, ZB, zCut);
        setBox(grassL, -100, XL, 0, 1.2, ZB, zCut); setBox(grassR, XR, 100, 0, 1.2, ZB, zCut);
        setBox(K("wb", () => boxMesh(1, 1, 1, mat("sand", COL.oldrock))), XL, XR, -H, 0, ZB, ZC0);
        const xFront = lerp(XC0, XC1, flow);
        setBox(lava, XC0, Math.min(XC1, xFront), -H + dB, -dT, ZC0, Math.min(ZC1, zCut));
        lavaM.emissiveIntensity = 0.9 * (1 - 0.5 * cool);
        // 川と、川の下の地面
        if (riv > 0) {
          setBox(front, -100, 100, -H - 40, riverY - 1.5, zCut, zCut + RW + 12);
          setBox(river, -100, 100, riverY - 1.5, riverY, zCut + 0.2, zCut + RW);
          river.material.opacity = 0.85 * riv;
          const fp = flowP.map((p) => [-100 + frac(p.ph + t * 6) * 200, riverY + 0.3, zCut + 1 + p.w * (RW - 2)]);
          const pts = points("flow", 90, 0xffffff, 1.6, 0.9); setPoints(pts, fp);
          label("riv", "川（流れる水）", [-80, riverY + 4, zCut + RW], "big");
        } else { front.visible = river.visible = false; }
        if (t > 0.68 && t < 0.92) {
          const rp = rainP.map((p) => [p.x, lerp(60, -H, frac(p.ph + t * 30)), p.z]);
          setPoints(points("rain", 300, 0x5aa9de, 1.0, 0.7), rp);
        }
        const gap = 1 - 0.13 * crack, rr = Rh * gap, solid = cool > 0.001;
        const zIn = Math.min(ZC1, zCut) - Rh * 1.3;
        setBox(crackBg, XC0 + Rh * 1.3, XC1 - Rh * 1.3, -H + 0.2, -0.2, ZC0 + Rh * 1.3, zIn); crackBg.visible = solid && crack > 0 && t < 0.6;
        if (crackBg.visible) { crackBg.scale.y = Math.max(0.01, dT - 0.4); crackBg.position.y = -dT / 2; }
        const cb2 = K("cb2", () => boxMesh(1, 1, 1, new THREE.MeshLambertMaterial({ color: 0x141516 }))); setBox(cb2, XC0 + Rh * 1.3, XC1 - Rh * 1.3, -H + 0.2, -H + dB - 0.2, ZC0 + Rh * 1.3, zIn); cb2.visible = solid && crack > 0 && dB > 0.5 && t < 0.6;
        cells.forEach((c, i) => {
          const inLava = c.x < xFront && solid && c.z < zFront - Rh * 0.8;
          const vis = inLava && c.z < zCut;
          if (vis) {
            dummy.rotation.set(0, Math.PI / 6, 0);
            dummy.position.set(c.x, -dT / 2, c.z); dummy.scale.set(rr * 1.155, Math.max(0.01, dT), rr * 1.155); dummy.updateMatrix(); imT.setMatrixAt(i, dummy.matrix);
            dummy.position.set(c.x, -H + dB / 2, c.z); dummy.scale.set(rr * 1.155, Math.max(0.01, dB), rr * 1.155); dummy.updateMatrix(); imB.setMatrixAt(i, dummy.matrix);
          } else { hide(imT, i); hide(imB, i); }
          // がけのふちの柱：割れ目にそって たおれて、川に落ち、流されていく
          const f0 = (c.z - zCut) / 12, f = f0 + seg(t, 0.93, 0.99) * 1.3; // さいごは、くずれた岩もすべて流されていく
          if (inLava && cut > 0 && f0 >= 0 && f < 1 && c.x + Math.pow(Math.max(0, f - 0.45) / 0.55, 2) * 70 < 98) {
            const fall = Math.min(1, f * 2.2), carry = Math.max(0, f - 0.45) / 0.55;
            dummy.rotation.set(fall * 1.45, Math.PI / 6, 0);
            dummy.position.set(c.x + carry * carry * 70, lerp(-H / 2, riverY - 0.8, fall), c.z + fall * 10);
            const sc = rr * 1.155 * (1 - 0.6 * carry);
            dummy.scale.set(sc, H * (1 - 0.5 * carry), sc); dummy.updateMatrix(); imF.setMatrixAt(i, dummy.matrix);
          } else hide(imF, i);
        });
        imT.instanceMatrix.needsUpdate = imB.instanceMatrix.needsUpdate = imF.instanceMatrix.needsUpdate = true;
        if (t > 0.14 && t < 0.58) {
          [-40, 0, 40].forEach((x, i) => { arrow("hu" + i, [x, 2, 30], [x, 22, 30], 0xff7a20, 2.2); arrow("hd" + i, [x, -H - 2, 30], [x, -H - 20, 30], 0xff7a20, 2.2); });
          label("heatU", "空気へ 熱がにげる → 上から冷える", [0, 28, 30], "big");
          label("heatD", "地面へ 熱がにげる → 下から冷える", [0, -H - 26, 30], "big");
        }
        if (t < 0.16) label("lv", "熱い溶岩（約1100℃）", [(XL + xFront) / 2, -H / 2, 36], "big red");
        else if (t < 0.56) label("lv", "まだ熱い溶岩", [0, -H / 2, 36], "red");
        if (crack > 0.2 && t < 0.58) { label("ct", "上の面から割れ目がのびる ↓", [XR + 16, -dT / 2, 36]); label("cb", "下の面から割れ目がのびる ↑", [XR + 16, -H + dB / 2, 36]); }
        if (t > 0.54 && t < 0.62) label("meet", "上と下からの割れ目が 真ん中で出会う → 柱になった", [0, -H / 2, 36], "big");
        if (t > 0.62 && t < 0.7) label("cont", "手前にも同じ岩が続いている（まだ地面の中）", [0, 6, zFront], "big");
        if (t > 0.7 && t < 0.93) {
          arrow("ero", [20, riverY + 8, zCut + 14], [20, riverY + 3, zCut + 2], 0x1565c0, 2.4);
          label("ero1", "川の水が 岩の下をけずる（しん食）", [30, riverY + 14, zCut + 14], "big");
          if (t > 0.8) { label("ero2", "割れ目にそって 柱ごとくずれる", [-30, -8, zCut + 4], "big red"); label("ero3", "くずれた岩は 川が運ぶ（運ぱん）", [70, riverY + 6, zCut + 10]); }
          label("rain", "雨水", [-70, 40, 20]);
        }
        if (t > 0.93) { const pp = K("person", () => person()); pp.position.set(84, 1.2, zCut - 6); label("cliff", "柱が並んだがけ（柱状節理）！", [0, 10, zCut + 2], "big"); }
        insets(t > 0.24 && t < 0.58 ? [
          { key: "mud", cap: "にている：どろがかわくと、ちぢんでひび割れる", draw: (g, n) => drawCracks(g, n, crack * 1.1, false, 5) },
          { key: "hex", cap: "溶岩を上から見ると：六角形に割れていく", draw: (g, n) => drawCracks(g, n, crack * 1.1, true, 9) },
        ] : []);
      };
    },
  });

  // ================= 画面 =================
  let cur = SCENES[0], T = 0, playing = false, last = 0, updateFn = null, dirty = true;
  const range = document.getElementById("time"), playBtn = document.getElementById("play");
  function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }
  let lastAspectWide = null;
  window.addEventListener("resize", () => { const wide = camera.aspect > 1.2; if (lastAspectWide !== null && wide !== lastAspectWide) setView(); lastAspectWide = wide; });
  function setView(kind) {
    const c = cur.cam || { pos: [60, 60, 160], target: [0, 0, 0] }, tg = new THREE.Vector3(...c.target);
    controls.target.copy(tg);
    if (kind === "top") camera.position.set(tg.x + 0.01, tg.y + 220, tg.z + 0.01);
    else if (kind === "front") camera.position.set(tg.x, tg.y + 5, tg.z + 200);
    else camera.position.set(...c.pos);
    // たて長の画面（iPadのたて持ち・スマホ）では、少しはなれて全体が入るように
    const k = Math.max(1, 1.45 / Math.max(0.3, camera.aspect));
    camera.position.sub(tg).multiplyScalar(k).add(tg);
    controls.update(); dirty = true;
  }
  function choose(sc) {
    cur = sc; playing = false; playBtn.textContent = "▶";
    document.querySelectorAll("#scenes button").forEach((b) => b.classList.toggle("on", b.dataset.id === sc.id));
    const tk = document.getElementById("ticks"); tk.innerHTML = "";
    sc.stages.forEach((s) => { const sp = document.createElement("span"); sp.textContent = s.s; sp.style.left = s.t * 100 + "%"; sp.onclick = () => setT(s.t + 0.001); tk.appendChild(sp); });
    history.replaceState(null, "", "#" + sc.id);
    clearScene(); root.position.set(0, 0, 0);
    updateFn = sc.build();
    setView();
    setT(0);
  }
  function setT(v, fromRange) {
    T = clamp(v); if (!fromRange) range.value = Math.round(T * 1000);
    used = new Set(); usedL = new Set(); QI = 0; QTXT = "";
    try { updateFn && updateFn(T); } catch (e) { console.error(e); }
    keyed.forEach((o, k) => { if (!used.has(k)) o.visible = false; });
    // 地しん・噴火の強調：画面のふちを光らせ、大きな文字を出す
    const fl = document.getElementById("flash"), qt = document.getElementById("qtext");
    fl.style.opacity = QI.toFixed(2); fl.className = /噴火/.test(QTXT) ? "volc" : "";
    qt.textContent = QTXT; qt.style.opacity = QI > 0.05 ? Math.min(1, QI * 2).toFixed(2) : 0;
    qt.style.transform = "translate(-50%,-50%) scale(" + (1 + 0.25 * QI).toFixed(3) + ")";
    const st = cur.stages.filter((x) => T >= x.t - 1e-6).pop() || cur.stages[0], idx = cur.stages.indexOf(st);
    const ex = document.getElementById("explain");
    if (ex.dataset.k !== cur.id + idx) { ex.innerHTML = '<span class="ttl">' + cur.title + '</span><span class="st">' + "①②③④⑤⑥⑦⑧⑨⑩"[idx] + " " + st.s + "</span><span class=\"body\">" + st.text + "</span>"; ex.dataset.k = cur.id + idx; }
    document.getElementById("age").textContent = cur.age ? "⏳ " + cur.age(T) : "";
    document.querySelectorAll("#ticks span").forEach((sp, i) => sp.classList.toggle("on", i === idx));
    // せまい画面では、となりと重なる目もりの文字をかくす（いまの場面の文字は必ず出す）
    const sps = [...document.querySelectorAll("#ticks span")]; let lastR = -1e9;
    const rs = sps.map((sp) => { sp.style.visibility = ""; const r = sp.getBoundingClientRect(); return [r.left, r.right]; });
    sps.forEach((sp, i) => { if (i === idx) return; const ov = rs[i][0] < lastR + 4 || (i < idx && rs[i][1] + 4 > rs[idx][0]) || (i > idx && rs[i][0] < rs[idx][1] + 4); if (ov) sp.style.visibility = "hidden"; else lastR = rs[i][1]; if (i + 1 === idx) lastR = rs[idx][1]; });
    dirty = true;
  }
  function loop(now) {
    if (playing) { const dt = Math.min(0.1, (now - last) / 1000); setT(T + dt / (cur.dur || 24)); if (T >= 1) { playing = false; playBtn.textContent = "▶"; } }
    last = now;
    controls.update();
    renderer.render(scene, camera);
    placeLabels();
    requestAnimationFrame(loop);
  }
  const nav = document.getElementById("scenes"); let grp = "";
  SCENES.forEach((sc) => {
    if (sc.group !== grp) { grp = sc.group; const g = document.createElement("span"); g.className = "grp"; g.textContent = grp; nav.appendChild(g); }
    const b = document.createElement("button"); b.type = "button"; b.textContent = sc.short; b.dataset.id = sc.id; b.title = sc.title; b.onclick = () => choose(sc); nav.appendChild(b);
  });
  range.addEventListener("input", () => { playing = false; playBtn.textContent = "▶"; setT(range.value / 1000, true); });
  document.getElementById("reset").onclick = () => { playing = false; playBtn.textContent = "▶"; setT(0); };
  playBtn.onclick = () => { if (T >= 0.999) setT(0); playing = !playing; playBtn.textContent = playing ? "⏸" : "▶"; };
  document.getElementById("viewReset").onclick = () => setView();
  document.getElementById("viewTop").onclick = () => setView("top");
  document.getElementById("viewFront").onclick = () => setView("front");
  renderer.domElement.addEventListener("pointerdown", () => (document.getElementById("hint3d").style.opacity = 0));
  setTimeout(() => (document.getElementById("hint3d").style.opacity = 0), 7000);
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  window.addEventListener("resize", resize);
  resize();
  choose(SCENES.find((s) => "#" + s.id === location.hash) || SCENES[0]);
  requestAnimationFrame(loop);
  window.__sim3d = { SCENES, setT, choose: (id) => choose(SCENES.find((s) => s.id === id)), render: () => { controls.update(); renderer.render(scene, camera); placeLabels(); } };
})();
