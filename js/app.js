/*
 * app.js — 3D土地模型の本体
 */
(function () {
  const C = window.CHISOU;
  const GEO = C.Geo, GL = C.Geology;
  const $ = (id) => document.getElementById(id);

  // ---------- 保存（この端末のブラウザ内） ----------
  const store = {
    get(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 保存できない環境 */ } },
  };

  // ---------- 場所の読み込み ----------
  const params = new URLSearchParams(location.search);
  // 先生が画面から作った場所（この端末に保存）
  const customSites = store.get("chisou3d:customSites", []);
  const custom = customSites.find((c) => c.id === params.get("site"));
  const entry = custom ? C.SITE_LIST[0] : C.SITE_LIST.find((s) => s.id === params.get("site")) || C.SITE_LIST[0];
  const run = () => start(custom ? makeCustomSite(C.sites[entry.id], custom) : C.sites[entry.id]).catch((e) => showError(e.message || String(e)));
  /** ひな形（最初の場所の設定）から、新しい場所の設定をつくる：層の設定は同じ、ボーリングは空 */
  function makeCustomSite(tpl, c) {
    const site = JSON.parse(JSON.stringify(Object.assign({}, tpl, { boreholes: [], mapMarks: null, dataRadius: null })));
    Object.assign(site, {
      id: c.id, title: c.name + "のまわりの大地", subtitle: "半径" + (c.half / 1000) + "kmの土地模型（地下の地層つき）",
      center: { lat: c.lat, lon: c.lon }, centerNote: c.name + "（先生が画面で作った場所）",
      half: c.half, baseHalf: undefined, baseGrid: undefined, gridSize: 160,
      landmarks: [{ name: c.name, icon: "🏫", lat: c.lat, lon: c.lon, main: true }],
      custom: true,
    });
    if (site.sample) site.sample.enabled = false;
    site.layers.forEach((l) => { if (l.id === "alluvium") l.desc = "近くの川が運んできた、やわらかい泥や砂。谷の底にたまっている。いちばん新しい層。"; });
    return site;
  }
  if (C.sites[entry.id]) {
    setTimeout(run, 0); // 1ファイル版：設定がすでに入っている（準備が終わってから始める）
  } else {
    const sc = document.createElement("script");
    sc.src = entry.file + "?v=20260930064330";
    sc.onload = run;
    sc.onerror = () => showError("場所の設定ファイル（" + entry.file + "）を読み込めませんでした。ZIPの場合は「すべて展開」してから開いてください。");
    document.body.appendChild(sc);
  }

  function setLoading(t) { $("loadingText").textContent = t; }
  function showError(msg) {
    $("loading").classList.remove("hidden");
    $("loading").classList.add("error");
    $("loadingText").innerHTML = "⚠ " + esc(msg).replace(/\n/g, "<br>") + '<br><br><button onclick="location.reload()">もう一度読み込む</button>';
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---------- 状態 ----------
  const S = {
    site: null, frame: null, grid: null, stats: null, model: null, bores: [],
    ve: 3, opacity: 1, peel: 0, visLayers: [], mode: "view", mapType: "std", cardClosed: {},
    showBores: true, lift: false, labels: true, showNotes: true, ring: true, hideStrata: false,
    teacher: false, sampleOn: true, notes: [], section: null, sectionFlip: false, sectionPts: [], hiddenBores: new Set(), savedOpacity: null, relief: "none",
    textures: {}, clipPlanes: [], noteColor: "#ffd54f", pickIds: [],
  };
  let renderer, scene, camera, controls, terrain, texMat, colMat, ambient, sun;
  const groups = {};
  const clipMats = new Set();
  const matCache = {};
  const key = (k) => "chisou3d:" + S.site.id + ":" + k;

  async function start(site) {
    if (!site) throw new Error("場所の設定が見つかりません。");
    S.site = site;
    S.shared = await readShared(); // 先生が配ったリンク（#k=…）の中身
    document.title = site.title + "｜3D土地模型";
    $("siteTitle").textContent = site.title;
    $("siteSub").textContent = site.subtitle || "";
    S.ve = site.defaultExaggeration || 3;
    S.mapType = store.get("chisou3d:map2", site.defaultMap || "photo"); // はじめは航空写真
    if (!C.MAP_TYPES[S.mapType]) S.mapType = "std";
    const prefs = store.get(key("prefs"), {});
    S.sampleOn = prefs.sampleOn != null ? prefs.sampleOn : !!(site.sample && site.sample.enabled);
    S.notes = store.get(key("notes"), []);
    S.boreMarks = store.get(key("boreMarks"), {});
    S.cutNoData = store.get("chisou3d:cutNoData", true);
    S.peelMode = store.get("chisou3d:peelMode", "one");
    initShare();
    S.cutReal = store.get("chisou3d:cutReal", true); // 目立たせた柱：id → 色
    // 範囲（半径）：URLの ?r=2000 → この端末で選んだもの → 設定ファイル の順
    site.baseHalf = site.baseHalf || site.half;
    const r = parseInt(params.get("r"), 10) || (S.shared && S.shared.r) || store.get(key("half"), 0) || site.baseHalf;
    const f = r / site.baseHalf;
    site.half = r;
    site.gridSize = Math.round((site.baseGrid = site.baseGrid || site.gridSize || 160) * Math.min(1.6, Math.max(0.75, f)));
    if (site.sample && f !== 1) site.sample = Object.assign({}, site.sample, {
      points: site.sample.points.map((p) => Object.assign({}, p, p.lat == null ? { east: (p.east || 0) * f, north: (p.north || 0) * f } : {})) });
    $("siteSub").textContent = (site.subtitle || "").replace(/半径[0-9.]+km/, "半径" + r / 1000 + "km");
    S.frame = new GEO.Frame(site.center, site.half);

    await loadTerrain();
    rebuildGeology(false);
    initScene();
    initUI();
    buildAll();
    await setMap(S.mapType);
    setView("tilt", true);
    $("loading").classList.add("hidden");
    if (C.Help) C.Help.init();
    animate();
    if (S.shared) applyShared(S.shared).catch((e) => console.warn(e));
  }

  // ---------- 地形（標高）の読み込み ----------
  async function loadTerrain() {
    const site = S.site, n = site.gridSize || 160, half = site.half;
    const N = (n + 1) * (n + 1), step = (2 * half) / n;
    const ground = new Float32Array(N).fill(NaN);
    let missing = N;
    for (const src of C.DEM_SOURCES) {
      if (!missing) break;
      let done = 0;
      setLoading("国土地理院から地形の高さを読み込み中…（" + src.name + "）");
      const dem = await GEO.loadDem(S.frame, half, src.zoom, src.url, () => {
        done++;
        setLoading("国土地理院から地形の高さを読み込み中…（" + src.name + " " + done + "枚）");
      });
      if (!dem.ok) continue;
      missing = 0;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const k = j * (n + 1) + i;
        if (isNaN(ground[k])) ground[k] = dem.sample(-half + i * step, -half + j * step);
        if (isNaN(ground[k])) missing++;
      }
    }
    if (missing === N) throw new Error("国土地理院のサーバーから地形データを読み込めませんでした。\n・インターネットにつながっているか確認してください。\n・アプリの中のプレビュー画面では動きません。ファイルをダウンロードして、EdgeやChromeで開いてください。\n・学校のネットワークで国土地理院（cyberjapandata.gsi.go.jp）が止められている場合もあります。");
    // 足りない所（池・川など）はまわりの平均でうめる
    for (let pass = 0; pass < 200 && missing; pass++) {
      missing = 0;
      const copy = ground.slice();
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const k = j * (n + 1) + i;
        if (!isNaN(copy[k])) continue;
        let s = 0, c = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii > n || jj > n) continue;
          const v = copy[jj * (n + 1) + ii];
          if (!isNaN(v)) { s += v; c++; }
        }
        if (c) ground[k] = s / c; else missing++;
      }
    }
    S.grid = { n, half, step, ground };
    const sorted = Array.from(ground).sort((a, b) => a - b);
    const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    S.stats = { min: sorted[0], max: sorted[sorted.length - 1], p02: q(0.02), p05: q(0.05), p95: q(0.95), p98: q(0.98) };
  }

  function groundAt(x, z) {
    const g = S.grid, n = g.n;
    let fi = (x + g.half) / g.step, fj = (z + g.half) / g.step;
    if (fi < 0 || fj < 0 || fi > n || fj > n) return NaN;
    const i0 = Math.min(n - 1, Math.floor(fi)), j0 = Math.min(n - 1, Math.floor(fj));
    const di = fi - i0, dj = fj - j0, a = g.ground, k = j0 * (n + 1) + i0;
    return a[k] * (1 - di) * (1 - dj) + a[k + 1] * di * (1 - dj) + a[k + n + 1] * (1 - di) * dj + a[k + n + 2] * di * dj;
  }

  // ---------- ボーリング資料と地層の推定 ----------
  function customBores() { return store.get(key("bores"), []); }
  function allBoreData() {
    const site = S.site;
    const map = new Map();
    for (const b of site.boreholes || []) if (b && b.lat != null) map.set(b.id, b);
    for (const b of customBores()) {
      if (b.deleted) map.delete(b.id); else map.set(b.id, b);
    }
    let list = Array.from(map.values());
    if (S.sampleOn && site.sample) list = list.concat(GL.makeSampleBoreholes(site.sample, S.frame, groundAt, S.stats));
    return list;
  }
  function rebuildGeology(rebuild3d) {
    const site = S.site;
    S.bores = GL.prepareBoreholes(allBoreData(), site.layers, S.frame, groundAt)
      .filter((b) => Math.abs(b.x) <= site.half * 1.2 && Math.abs(b.z) <= site.half * 1.2);
    S.model = GL.buildModel(site.layers, S.grid, S.bores, { baseElevation: site.baseElevation });
    const m = S.model;
    S.visLayers = site.layers.map((l, i) => i).filter((i) => {
      for (let k = 0; k < m.tops[i].length; k += 7) if (m.tops[i][k] - m.bots[i][k] > 0.05) return true;
      return false;
    });
    const noData = !S.bores.length;
    $("sampleBadge").textContent = noData ? "📄 ボーリング資料をまだ入れていません" : "⚠ 仮のボーリングデータを表示中";
    $("sampleBadge").classList.toggle("hidden", !noData && !S.bores.some((b) => b.sample));
    if (rebuild3d) {
      setPeeled(new Set([...(S.peeled || [])].filter((li) => S.visLayers.includes(li) && li !== S.visLayers[S.visLayers.length - 1])));
      buildLegend();
      buildAll();
      if (S.section) makeSection(S.section.pts, true);
    }
  }

  // ---------- 3D の準備 ----------
  function initScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.localClippingEnabled = true;
    $("viewport").appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe9f0);
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 5, 50000);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false;
    controls.minDistance = 60;
    controls.maxDistance = S.site.half * 9;
    controls.maxPolarAngle = Math.PI * 0.92;
    applyDragMode(store.get("chisou3d:drag", "move"));
    controls.listenToKeyEvents(window); // 矢印キーで動かす
    controls.keyPanSpeed = 25;
    controls.zoomSpeed = 1.2;
    ambient = new THREE.AmbientLight(0xffffff, 0.58);
    scene.add(ambient);
    sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(-0.6, 1, 0.45);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.18);
    fill.position.set(0.7, 0.3, -0.5);
    scene.add(fill);
    for (const g of ["walls", "bores", "labels", "notes", "ring", "section", "markers", "rivers", "yato", "lore", "dig", "guide"]) {
      groups[g] = new THREE.Group();
      scene.add(groups[g]);
    }
    // 地面
    const n = S.grid.n, half = S.grid.half, step = S.grid.step;
    const N = (n + 1) * (n + 1);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i;
      pos[k * 3] = -half + i * step;
      pos[k * 3 + 2] = -half + j * step;
      uv[k * 2] = i / n;
      uv[k * 2 + 1] = 1 - j / n;
    }
    const idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    texMat = clipMat(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    colMat = clipMat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    terrain = new THREE.Mesh(geo, texMat);
    scene.add(terrain);

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      updateViewOffset();
    });
    bindTap();
  }

  function clipMat(m) { m.clippingPlanes = S.clipPlanes; clipMats.add(m); return m; }
  function layerMat(color) {
    if (!matCache[color]) matCache[color] = clipMat(new THREE.MeshLambertMaterial({ color }));
    return matCache[color];
  }
  function setClip(planes) {
    S.clipPlanes = planes;
    for (const m of clipMats) { m.clippingPlanes = planes; m.needsUpdate = true; }
  }

  /** パネルや断面図にかくれない位置に、模型の中心がくるようにずらす */
  function updateViewOffset() {
    if (!camera) return;
    const W = window.innerWidth, H = window.innerHeight;
    let ox = 0, oy = 0;
    const ctl = $("controls");
    if (W > 760 && !ctl.classList.contains("collapsed")) ox = (ctl.offsetWidth + 12) / 2;
    const sheet = $("sectionSheet");
    if (!sheet.classList.contains("hidden")) oy = sheet.offsetHeight / 2;
    if (ox || oy) camera.setViewOffset(W, H, -ox, oy, W, H);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /** 左ドラッグの役わり：move＝地図を動かす（右ドラッグで回す） / rotate＝回す（右ドラッグで動かす） */
  function applyDragMode(mode) {
    S.dragMode = mode;
    const M = THREE.MOUSE, T = THREE.TOUCH;
    if (mode === "move") {
      controls.mouseButtons = { LEFT: M.PAN, MIDDLE: M.DOLLY, RIGHT: M.ROTATE };
      controls.touches = { ONE: T.PAN, TWO: T.DOLLY_ROTATE };
    } else {
      controls.mouseButtons = { LEFT: M.ROTATE, MIDDLE: M.DOLLY, RIGHT: M.PAN };
      controls.touches = { ONE: T.ROTATE, TWO: T.DOLLY_PAN };
    }
    store.set("chisou3d:drag", mode);
    document.querySelectorAll("#navpad [data-drag]").forEach((b) => b.classList.toggle("on", b.dataset.drag === mode));
  }
  /** ボタンで動かす・回す・近づく */
  function nudge(kind, amount) {
    const t = controls.target, off = camera.position.clone().sub(t);
    if (kind === "pan") {
      const az = controls.getAzimuthalAngle();
      const step = off.length() * 0.25;
      // 画面の右・奥の方向（地面に平行）
      const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
      const fwd = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
      const v = right.multiplyScalar(amount[0] * step).add(fwd.multiplyScalar(amount[1] * step));
      t.add(v); camera.position.add(v);
    } else if (kind === "rotate") {
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), amount);
      camera.position.copy(t).add(off);
    } else if (kind === "zoom") {
      off.multiplyScalar(amount);
      if (off.length() > controls.minDistance && off.length() < controls.maxDistance) camera.position.copy(t).add(off);
    } else if (kind === "tilt") {
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.phi = Math.max(0.05, Math.min(controls.maxPolarAngle, sph.phi + amount));
      off.setFromSpherical(sph);
      camera.position.copy(t).add(off);
    }
    controls.update();
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    // 模型から遠くへ行きすぎないように
    const lim = S.site.half * 1.3, t = controls.target;
    if (Math.abs(t.x) > lim || Math.abs(t.z) > lim) {
      const cx = Math.max(-lim, Math.min(lim, t.x)) - t.x, cz = Math.max(-lim, Math.min(lim, t.z)) - t.z;
      t.x += cx; t.z += cz; camera.position.x += cx; camera.position.z += cz;
    }
    const az = controls.getAzimuthalAngle();
    $("compass").querySelector(".needle").style.transform = "rotate(" + (az * 180) / Math.PI + "deg)";
    renderer.render(scene, camera);
  }

  // ---------- いま見えている面 ----------
  // 地層をはがす：S.peeled＝はがした層（番号の集まり）。S.peel＝はがした層の数
  // その場所に「はがした層」があれば、その層と、その上にのっている層を取りのぞく（場所ごとに決まる）
  if (!S.peeled) S.peeled = new Set();
  function setPeeled(set) { S.peeled = set; S.peel = set.size; }
  /** ある地点で、はがした後にいちばん上に出てくる層の番号（tops/bots はその地点の各層の上・下の高さ） */
  function startAt(tops, bots) {
    if (!S.peel) return 0;
    // その場所で、はがしていない層のうち いちばん上にある層（のこした層は、下の層をはがしても その高さのまま残す）
    for (let li = 0; li < tops.length; li++) if (!S.peeled.has(li) && tops[li] - bots[li] > 0.05) return li;
    return tops.length;
  }
  const gridStart = (k) => startAt(S.model.tops.map((t) => t[k]), S.model.bots.map((b) => b[k]));
  function peelLayer() { return 0; } // （古いしくみの名残り）
  function surfaceHeights() {
    if (S.peel === 0) return S.grid.ground;
    const m = S.model, L = m.tops.length, out = new Float32Array(m.tops[0].length);
    for (let k = 0; k < out.length; k++) {
      const st = gridStart(k);
      out[k] = st === 0 ? S.grid.ground[k] : st < L ? m.tops[st][k] : m.base;
    }
    return out;
  }
  function surfaceAt(x, z) {
    if (S.peel === 0) return groundAt(x, z);
    const s = GL.sampleModel(S.model, x, z);
    const st = startAt(s.tops, s.bots);
    return st === 0 ? groundAt(x, z) : st < s.tops.length ? s.tops[st] : S.model.base;
  }
  function strataColor(li) { return S.hideStrata ? "#b8b0a2" : S.site.layers[li].color; }

  // ---------- 作り直し ----------
  function buildAll() {
    updateTerrain();
    buildRivers();
    buildYato();
    buildWalls();
    buildBores();
    buildLabels();
    buildNotes();
    buildRing();
    buildLore();
    buildDig();
    buildCutGuide();
    if (S.section) buildSectionRibbon();
    updateMarkers();
  }

  function updateTerrain() {
    const h = surfaceHeights(), ve = S.ve, m = S.model;
    const pos = terrain.geometry.attributes.position, col = terrain.geometry.attributes.color;
    const from = peelLayer();
    const c = new THREE.Color();
    const terr = S.relief === "terrace" && S.peel === 0;
    for (let k = 0; k < h.length; k++) {
      pos.array[k * 3 + 1] = (terr ? terraceOf(h[k]) : h[k]) * ve;
      if (S.peel > 0) {
        let li = gridStart(k);
        while (li < m.tops.length && (m.tops[li][k] - m.bots[li][k] < 0.05 || S.peeled.has(li))) li++;
        c.set(li < m.tops.length ? strataColor(li) : "#555555");
        col.array[k * 3] = c.r; col.array[k * 3 + 1] = c.g; col.array[k * 3 + 2] = c.b;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    terrain.geometry.computeVertexNormals();
    terrain.geometry.computeBoundingSphere();
    terrain.material = S.peel > 0 ? colMat : texMat;
    applyOpacity();
  }

  function setOpacity(v) {
    S.opacity = v;
    $("opacityRange").value = v;
    applyOpacity();
  }
  function applyOpacity() {
    for (const m of [texMat, colMat]) {
      m.transparent = S.opacity < 0.999;
      m.opacity = S.opacity;
      m.depthWrite = S.opacity > 0.6;
      m.needsUpdate = true;
    }
  }

  /** 縦の壁（側面・断面）をつくる。samples: [{x,z,tops,bots}] */
  function wallMesh(samples) {
    const L = S.site.layers.length, ve = S.ve, from = 0;
    const terr = S.relief === "terrace" && S.peel === 0;
    const pos = [], col = [], lines = [];
    const c = new THREE.Color();
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      const sa = startAt(a.tops, a.bots), sb = startAt(b.tops, b.bots);
      for (let li = 0; li < L; li++) {
        let ta = a.tops[li], ba = a.bots[li], tb = b.tops[li], bb = b.bots[li];
        if (li < sa || S.peeled.has(li)) ta = ba; // はがした層は かかない（のこした層の下は すき間になる）
        if (li < sb || S.peeled.has(li)) tb = bb;
        if (terr) { // 段々模型：段の高さより上は切る
          const A = terraceOf(a.g), B = terraceOf(b.g);
          ta = Math.min(ta, A); ba = Math.min(ba, A); tb = Math.min(tb, B); bb = Math.min(bb, B);
        }
        if (ta - ba < 0.01 && tb - bb < 0.01) continue;
        c.set(strataColor(li));
        const v = [[a.x, ta, a.z], [b.x, tb, b.z], [b.x, bb, b.z], [a.x, ba, a.z]];
        for (const t of [0, 1, 2, 0, 2, 3]) {
          pos.push(v[t][0], v[t][1] * ve, v[t][2]);
          col.push(c.r, c.g, c.b);
        }
        if (!S.hideStrata) lines.push(a.x, ba * ve, a.z, b.x, bb * ve, b.z);
      }
      let ta = sa < L ? a.tops[sa] : a.bots[L - 1], tb = sb < L ? b.tops[sb] : b.bots[L - 1];
      if (terr) { ta = Math.min(ta, terraceOf(a.g)); tb = Math.min(tb, terraceOf(b.g)); }
      lines.push(a.x, ta * ve + 0.3, a.z, b.x, tb * ve + 0.3, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, clipMat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    const line = new THREE.LineSegments(lg, clipMat(new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.55 })));
    const grp = new THREE.Group();
    grp.add(mesh, line);
    return grp;
  }

  function disposeGroup(g) {
    while (g.children.length) {
      const o = g.children.pop();
      o.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material && !Object.values(matCache).includes(c.material)) {
          if (c.material.map) c.material.map.dispose();
          clipMats.delete(c.material);
          c.material.dispose();
        }
      });
    }
  }

  function gridSample(i, j) {
    const n = S.grid.n, k = j * (n + 1) + i, m = S.model;
    return { x: -S.grid.half + i * S.grid.step, z: -S.grid.half + j * S.grid.step, g: S.grid.ground[k], tops: m.tops.map((a) => a[k]), bots: m.bots.map((a) => a[k]) };
  }

  function buildWalls() {
    disposeGroup(groups.walls);
    const n = S.grid.n;
    const edges = [[], [], [], []];
    for (let t = 0; t <= n; t++) {
      edges[0].push(gridSample(t, 0));
      edges[1].push(gridSample(n, t));
      edges[2].push(gridSample(n - t, n));
      edges[3].push(gridSample(0, n - t));
    }
    for (const e of edges) groups.walls.add(wallMesh(e));
    const h = S.grid.half;
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(2 * h, 2 * h), clipMat(new THREE.MeshLambertMaterial({ color: 0x4a4f55, side: THREE.DoubleSide })));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = S.model.base * S.ve - 0.2;
    groups.walls.add(bottom);
  }

  // ---------- 文字ラベル（画面上で一定の大きさ） ----------
  function makeLabel(text, o) {
    o = o || {};
    const dpr = 2, fs = (o.size || 15) * dpr, pad = 7 * dpr;
    const lines = String(text).split("\n");
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d");
    const font = (o.bold ? "bold " : "") + fs + 'px "BIZ UDPGothic","Hiragino Kaku Gothic ProN","Meiryo",sans-serif';
    ctx.font = font;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2;
    const lh = fs * 1.3;
    const h = Math.ceil(lines.length * lh + pad * 2 - (lh - fs));
    cv.width = w; cv.height = h + 10 * dpr;
    ctx.font = font;
    ctx.fillStyle = o.bg || "rgba(255,255,255,0.93)";
    ctx.strokeStyle = o.border || "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, w - 2, h - 2, 8 * dpr);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); // しっぽ
    ctx.moveTo(w / 2 - 7 * dpr, h - 2); ctx.lineTo(w / 2, h + 9 * dpr); ctx.lineTo(w / 2 + 7 * dpr, h - 2);
    ctx.fill();
    ctx.fillStyle = o.color || "#1f2a33";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lh));
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    const mat = clipMat(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false }));
    const sp = new THREE.Sprite(mat);
    const k = 0.00052 * (o.scale || 1);
    sp.scale.set(cv.width * k, cv.height * k, 1);
    sp.center.set(0.5, 0);
    sp.renderOrder = 10;
    return sp;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function pinLine(x, z, y1, y2, color) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y1, z), new THREE.Vector3(x, y2, z)]);
    return new THREE.Line(g, clipMat(new THREE.LineBasicMaterial({ color: color || 0x333333 })));
  }

  // ---------- ボーリングの柱 ----------
  function buildBores() {
    disposeGroup(groups.bores);
    const ve = S.ve, R = Math.max(6, S.site.half * (S.lift ? 0.018 : 0.011));
    const ids = {};
    S.site.layers.forEach((l, i) => (ids[l.id] = i));
    // 名前を出すボーリング：近くに集まっている所は、深く掘ったものを優先して間引く
    const minD = Math.max(150, S.site.half * 0.22);
    const named = new Set(), placed = [];
    for (const b of S.bores) if (markOf(b.id)) { named.add(b.id); placed.push(b); }
    const order = S.bores.filter((b) => !isNaN(b.elev)).sort((a, b) =>
      (S.hiddenBores.has(b.id) - S.hiddenBores.has(a.id)) || (b.depth - a.depth));
    for (const b of order) {
      if (S.hiddenBores.has(b.id) || S.bores.length <= 30 || !placed.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < minD)) {
        named.add(b.id); placed.push(b);
      }
    }
    // 柱は全部まとめて1つの形にする（本数が多くても軽く動くように）
    const segsN = S.bores.length > 60 ? 10 : 20;
    const unit = new THREE.CylinderGeometry(1, 1, 1, segsN).toNonIndexed();
    const up = unit.attributes.position.array, un = unit.attributes.normal.array, nv = up.length / 3;
    const pos = [], nor = [], col = [], lpos = [], lcol = [];
    const c = new THREE.Color(), pinBlue = new THREE.Color(0x1f5f99), pinOrange = new THREE.Color(0xb85c00);
    if (!matCache.__dot) {
      matCache.__dot = makeLabel("●", { bg: "#e3f0fb", color: "#1f5f99", size: 8, scale: 0.9 }).material;
      matCache.__dotScale = makeLabel("●", { size: 8, scale: 0.9 }).scale.clone();
    }
    for (const b of S.bores) {
      if (isNaN(b.elev) || Math.abs(b.x) > S.site.half || Math.abs(b.z) > S.site.half) continue;
      const hidden = S.hiddenBores.has(b.id);
      const lift = S.lift ? b.depth * ve + 25 : 0;
      if (!hidden) for (const sg of b.segs) {
        const h = Math.max(0.05, (sg.to - sg.from) * ve), cy = (b.elev - (sg.from + sg.to) / 2) * ve + lift;
        c.set(segColor(sg));
        for (let v = 0; v < nv; v++) {
          pos.push(b.x + up[v * 3] * R, cy + up[v * 3 + 1] * h, b.z + up[v * 3 + 2] * R);
          nor.push(un[v * 3], un[v * 3 + 1], un[v * 3 + 2]);
          col.push(c.r, c.g, c.b);
        }
      }
      const top = b.elev * ve + lift;
      const pinTop = S.lift ? top + 18 : Math.max(top, surfaceAt(b.x, b.z) * S.ve) + 45;
      const mk = markOf(b.id);
      const pc = mk ? new THREE.Color(mk.c) : b.sample ? pinOrange : pinBlue;
      const pTop = mk ? pinTop + 35 : pinTop; // 目立たせた柱は、旗を高く
      lpos.push(b.x, S.lift ? b.elev * ve : top, b.z, b.x, pTop, b.z);
      lcol.push(pc.r, pc.g, pc.b, pc.r, pc.g, pc.b);
      if (mk) {
        // ぼうを太く見せるため、少しずらした線をもう2本
        for (const [dx, dz] of [[R * 0.35, 0], [0, R * 0.35]]) {
          lpos.push(b.x + dx, S.lift ? b.elev * ve : top, b.z + dz, b.x + dx, pTop, b.z + dz);
          lcol.push(pc.r, pc.g, pc.b, pc.r, pc.g, pc.b);
        }
      }
      let lab;
      if (mk) {
        lab = makeLabel("★ " + shortName(b.name), { bg: mk.c, color: mk.fg, border: "#ffffff", size: 16, bold: true });
      } else if (named.has(b.id)) {
        lab = makeLabel(hidden ? "？" + shortName(b.name) + "（予想中）" : (b.sample ? "" : "🔍") + shortName(b.name), { bg: b.sample ? "#fff1dc" : "#e3f0fb", color: b.sample ? "#8a4500" : "#12497a", size: 13, bold: true });
      } else {
        lab = new THREE.Sprite(matCache.__dot); // 名前なしの点は、同じ絵を使い回す
        lab.scale.copy(matCache.__dotScale);
        lab.center.set(0.5, 0);
        lab.renderOrder = 10;
      }
      lab.position.set(b.x, pTop, b.z);
      if (mk) lab.renderOrder = 12;
      lab.userData.pick = { type: "bore", id: b.id };
      lab.userData.isLabel = true;
      groups.bores.add(lab);
    }
    unit.dispose();
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      groups.bores.add(new THREE.Mesh(g, clipMat(new THREE.MeshLambertMaterial({ vertexColors: true }))));
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lpos, 3));
    lg.setAttribute("color", new THREE.Float32BufferAttribute(lcol, 3));
    groups.bores.add(new THREE.LineSegments(lg, clipMat(new THREE.LineBasicMaterial({ vertexColors: true }))));
    applyVisibility();
  }

  /** ボーリングの1区間の色：地層の種類で／つぶの大きさで（先生・子どもが切りかえ） */
  function segColor(sg) {
    if (S.colorBy === "grain") return C.GRAINS[C.BoringXML.grainOf(sg.soil, sg.layer)].color;
    const l = sg.layer && S.site.layers.find((x) => x.id === sg.layer);
    return l ? l.color : "#999999";
  }
  function segName(sg) {
    if (S.colorBy === "grain") return C.GRAINS[C.BoringXML.grainOf(sg.soil, sg.layer)].name;
    const l = sg.layer && S.site.layers.find((x) => x.id === sg.layer);
    return l ? l.short || l.name : sg.soil;
  }
  function originTag(l) { const o = C.ORIGINS[l.origin]; return o ? o.icon : ""; }

  // 目立たせる色（柱の旗・ぼう・断面図の名前）
  const MARK_COLORS = [
    { c: "#e53935", n: "赤", fg: "#fff" }, { c: "#fbc02d", n: "黄", fg: "#3a2a00" },
    { c: "#43a047", n: "緑", fg: "#fff" }, { c: "#8e24aa", n: "むらさき", fg: "#fff" },
  ];
  const markOf = (id) => MARK_COLORS.find((m) => m.c === S.boreMarks[id]);
  function setBoreMark(id, color) {
    if (color) S.boreMarks[id] = color; else delete S.boreMarks[id];
    store.set(key("boreMarks"), S.boreMarks);
    buildBores();
    if (S.section) openSectionSheet();
  }
  /** 旗に出す短い名前（長い名前は、くわしい画面で全部見られる） */
  function shortName(n) { return n.length > 12 ? n.slice(0, 11) + "…" : n; }

  // ---------- 目印（学校・駅など） ----------
  function buildLabels() {
    disposeGroup(groups.labels);
    for (const lm of S.site.landmarks || []) {
      const p = S.frame.toLocal(lm.lat, lm.lon);
      if (Math.abs(p.x) > S.site.half || Math.abs(p.z) > S.site.half) continue;
      const y = groundAt(p.x, p.z) * S.ve;
      const top = y + (lm.main ? 110 : 80);
      const grp = new THREE.Group();
      grp.add(pinLine(p.x, p.z, y, top, 0x1f2a33));
      const lab = makeLabel((lm.icon || "📍") + " " + lm.name, { size: lm.main ? 18 : 15, bold: !!lm.main, bg: lm.main ? "#ffffff" : "rgba(255,255,255,0.9)" });
      lab.position.set(p.x, top, p.z);
      grp.add(lab);
      groups.labels.add(grp);
    }
    if (S.autoMarksOn) for (const m of visibleAutoMarks()) {
      const y = groundAt(m.x, m.z) * S.ve, top = y + 50;
      const grp = new THREE.Group();
      grp.add(pinLine(m.x, m.z, y, top, 0x5a6873));
      const lab = makeLabel(m.icon + " " + m.name, { size: 12, bg: "rgba(255,255,255,0.88)", border: "rgba(0,0,0,0.18)" });
      lab.position.set(m.x, top, m.z);
      grp.add(lab);
      groups.labels.add(grp);
    }
    applyVisibility();
  }

  // ---------- まわりの目印（OpenStreetMap） ----------
  const MARK_KINDS = [
    { test: (t) => t.railway === "station" || t.public_transport === "station", icon: "🚉", pri: 1 },
    { test: (t) => t.amenity === "school", icon: "🏫", pri: 2 },
    { test: (t) => t.amenity === "townhall", icon: "🏛️", pri: 2 },
    { test: (t) => t.amenity === "library", icon: "📚", pri: 3 },
    { test: (t) => t.amenity === "community_centre", icon: "🏠", pri: 3 },
    { test: (t) => t.amenity === "hospital", icon: "🏥", pri: 3 },
    { test: (t) => t.amenity === "police", icon: "🚓", pri: 3 },
    { test: (t) => t.amenity === "fire_station", icon: "🚒", pri: 3 },
    { test: (t) => t.amenity === "post_office", icon: "📮", pri: 4 },
    { test: (t) => t.amenity === "kindergarten", icon: "🧸", pri: 5 },
    { test: (t) => t.leisure === "park", icon: "🌳", pri: 4 },
  ];
  async function loadAutoMarks() {
    // まず国土地理院の地図の文字（注記）から。だめならOpenStreetMapから
    const kg = key("gsimarks:" + S.site.half);
    const cg = store.get(kg, null);
    if (cg && Date.now() - cg.t < 90 * 86400000) { S.marksSource = "gsi"; return cg.list; }
    try {
      const list = await C.MVT.gsiMarks(S.frame, S.site.half);
      if (list.length) { store.set(kg, { t: Date.now(), list }); S.marksSource = "gsi"; return list; }
    } catch (e) { /* OpenStreetMapへ */ }
    const k = key("osm:" + S.site.half);
    const cached = store.get(k, null);
    if (cached && Date.now() - cached.t < 30 * 86400000) return cached.list;
    const h = S.site.half;
    const sw = S.frame.toLatLon(-h, h), ne = S.frame.toLatLon(h, -h);
    const bb = [sw.lat, sw.lon, ne.lat, ne.lon].map((v) => v.toFixed(5)).join(",");
    const q = '[out:json][timeout:25];(nwr["railway"="station"]["name"](' + bb + ');nwr["public_transport"="station"]["name"](' + bb + ');' +
      'nwr["amenity"~"^(school|kindergarten|library|townhall|community_centre|hospital|police|fire_station|post_office)$"]["name"](' + bb + ');' +
      'nwr["leisure"="park"]["name"](' + bb + '););out tags center bb;';
    for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
      try {
        const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (!r.ok) continue;
        const js = await r.json();
        const list = [];
        for (const e of js.elements || []) {
          const t = e.tags || {};
          const kind = MARK_KINDS.find((m) => m.test(t));
          if (!kind) continue;
          const lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
          if (lat == null) continue;
          let area = 0;
          if (e.bounds) area = (e.bounds.maxlat - e.bounds.minlat) * 111000 * (e.bounds.maxlon - e.bounds.minlon) * 91000;
          if (kind.icon === "🌳" && area < 3000) continue; // 小さな公園は省く
          list.push({ name: t.name, icon: kind.icon, pri: kind.pri, lat, lon, area });
        }
        store.set(k, { t: Date.now(), list });
        return list;
      } catch (e) { /* 次のサーバーを試す */ }
    }
    return null;
  }
  /** 公園・公共施設を OpenStreetMap からおぎなう（1か月おぼえておく） */
  async function loadOsmExtra() {
    const k = key("osmx2:" + S.site.half);
    const cached = store.get(k, null);
    if (cached && Date.now() - cached.t < 30 * 86400000) return cached.list;
    const h = S.site.half;
    const sw = S.frame.toLatLon(-h, h), ne = S.frame.toLatLon(h, -h);
    const bb = [sw.lat, sw.lon, ne.lat, ne.lon].map((v) => v.toFixed(5)).join(",");
    const q = '[out:json][timeout:25];(nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"](' + bb + ');nwr["amenity"~"^(townhall|library|community_centre|hospital)$"]["name"](' + bb + ');nwr["leisure"="sports_centre"]["name"](' + bb + '););out tags center bb;';
    for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
      try {
        const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (!r.ok) continue;
        const js = await r.json(), list = [];
        for (const e of js.elements || []) {
          const t = e.tags || {};
          const lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
          if (lat == null || !t.name) continue;
          let area = 0;
          if (e.bounds) area = (e.bounds.maxlat - e.bounds.minlat) * 111000 * (e.bounds.maxlon - e.bounds.minlon) * 91000;
          let icon, pri;
          if (t.leisure) { if (e.bounds && area < 800) continue; icon = "🌳"; pri = 2; } // 点だけの公園も入れる。とても小さい広場は省く
          else if (t.amenity === "hospital") { icon = "🏥"; pri = 3; }
          else if (t.amenity === "townhall") { icon = "🏛️"; pri = 2; }
          else if (t.amenity === "library") { icon = "📚"; pri = 3; }
          else if (t.amenity === "community_centre") { icon = "🏠"; pri = 3; }
          else { icon = "🏟️"; pri = 3; }
          list.push({ name: t.name, icon, pri, lat, lon, area });
        }
        store.set(k, { t: Date.now(), list });
        return list;
      } catch (e) { /* 次のサーバー */ }
    }
    return null;
  }
  // 目印の種類
  const MARK_CATS = [
    { id: "station", name: "🚉 駅", icons: ["🚉"], on: true },
    { id: "school", name: "🏫 学校", icons: ["🏫", "🎓"], on: true },
    { id: "park", name: "🌳 公園・緑地", icons: ["🌳", "🌲"], on: true },
    { id: "public", name: "🏛️ 公共施設", icons: ["🏛️", "📚", "🏠", "🏟️"], on: true },
    { id: "safety", name: "🚒 消防・警察", icons: ["🚒", "🚓"], on: false },
    { id: "hospital", name: "🏥 病院", icons: ["🏥"], on: false },
    { id: "post", name: "📮 郵便局", icons: ["📮"], on: false },
    { id: "history", name: "⛩️ 寺・神社・史跡", icons: ["🛕", "⛩️", "🏺"], on: false },
  ];
  function markCatOn() {
    const saved = store.get("chisou3d:markCats", null);
    const on = new Set();
    for (const c of MARK_CATS) if (saved ? saved.includes(c.id) : c.on) c.icons.forEach((i) => on.add(i));
    return on;
  }
  function buildMarkCats() {
    const box = $("markCats");
    if (!box) return;
    const saved = store.get("chisou3d:markCats", null);
    const counts = {};
    for (const m of S.autoMarks || []) counts[m.icon] = (counts[m.icon] || 0) + 1;
    box.innerHTML = MARK_CATS.map((c) => {
      const n = c.icons.reduce((a, i) => a + (counts[i] || 0), 0);
      const on = saved ? saved.includes(c.id) : c.on;
      return '<label class="chip' + (on ? "" : " off") + '"><input type="checkbox" data-cat="' + c.id + '"' + (on ? " checked" : "") + "> " + c.name + (S.autoMarks ? "<small>" + n + "</small>" : "") + "</label>";
    }).join("");
    box.querySelectorAll("input").forEach((el) => (el.onchange = () => {
      const ids = [...box.querySelectorAll("input")].filter((x) => x.checked).map((x) => x.dataset.cat);
      store.set("chisou3d:markCats", ids);
      if (ids.length && !S.autoMarksOn) { $("chkAutoMarks").checked = true; S.autoMarksOn = true; store.set("chisou3d:autoMarks", true); }
      // 「名前・目印」が外れていると何も出ないので、いっしょにオンにする
      if (ids.length && !S.labels) { $("chkLabels").checked = true; $("chkLabels").dispatchEvent(new Event("change")); flashHint("「名前・目印」もオンにしました"); }
      buildMarkCats();
      buildLabels();
    }));
  }
  /** 重なって読めなくならないよう、近すぎる目印は大事な方だけ残す */
  function visibleAutoMarks() {
    if (!S.autoMarks) return [];
    const onIcons = markCatOn();
    const nCats = MARK_CATS.filter((c) => c.icons.some((i) => onIcons.has(i))).length;
    // えらんだ種類が少ないときは、近くても多めに出す
    // 近すぎる目印は省く（えらんだ種類が少ないほど、近くても出す）
    const minD = Math.max(60, S.site.half * (nCats <= 1 ? 0.025 : nCats <= 2 ? 0.045 : 0.07));
    const placed = (S.site.landmarks || []).map((l) => Object.assign({ name: l.name }, S.frame.toLocal(l.lat, l.lon)));
    const out = [];
    const list = S.autoMarks.filter((m) => m.icon !== "🌊" && onIcons.has(m.icon)).sort((a, b) => a.pri - b.pri || (b.area || 0) - (a.area || 0));
    for (const m of list) {
      const p = S.frame.toLocal(m.lat, m.lon);
      if (Math.abs(p.x) > S.site.half || Math.abs(p.z) > S.site.half) continue;
      if (placed.some((q) => q.name === m.name || Math.hypot(q.x - p.x, q.z - p.z) < minD)) continue;
      const mk = { name: m.name, icon: m.icon, x: p.x, z: p.z };
      placed.push(mk); out.push(mk);
      if (out.length >= (nCats <= 2 ? 100 : 70)) break;
    }
    return out;
  }

  // ---------- 半径の円 ----------
  function buildRing() {
    disposeGroup(groups.ring);
    const r = S.site.half, pts = [];
    for (let a = 0; a <= 360; a += 2) {
      const x = r * Math.cos((a * Math.PI) / 180), z = r * Math.sin((a * Math.PI) / 180);
      pts.push(new THREE.Vector3(x, surfaceAt(x * 0.999, z * 0.999) * S.ve + 3, z));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), clipMat(new THREE.LineDashedMaterial({ color: 0xd0342c, dashSize: 25, gapSize: 15, linewidth: 2 })));
    line.computeLineDistances();
    groups.ring.add(line);
    applyVisibility();
  }

  // ---------- 川 ----------
  /** 国土地理院の「河川中心線」を読み込む。取れないときは地形から水の通り道を計算する */
  async function loadRivers() {
    if (S.rivers) return S.rivers;
    const z = 16, half = S.site.half;
    const a = S.frame.toPixel(-half, -half, z), b = S.frame.toPixel(half, half, z);
    const jobs = [];
    const lines = [];
    for (let ty = Math.floor(a.y / 256); ty <= Math.floor(b.y / 256); ty++) {
      for (let tx = Math.floor(a.x / 256); tx <= Math.floor(b.x / 256); tx++) {
        jobs.push(fetch("https://cyberjapandata.gsi.go.jp/xyz/experimental_rvrcl/" + z + "/" + tx + "/" + ty + ".geojson")
          .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((gj) => {
            if (!gj || !gj.features) return;
            for (const f of gj.features) {
              const g = f.geometry, pr = f.properties || {};
              if (!g) continue;
              const nameKey = Object.keys(pr).find((k) => /name|名称|rvrnm|nm$/i.test(k));
              const name = nameKey ? String(pr[nameKey] || "") : "";
              const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
              const major = /河川中心線/.test(pr.type || "") || !!pr.rivCtg; // 細河川（小さな水路）以外
              for (const c of parts) lines.push({ name, major, pts: c.map(([lon, lat]) => S.frame.toLocal(lat, lon)) });
            }
          }));
      }
    }
    await Promise.all(jobs);
    S.riverSource = lines.length ? "gsi" : "flow";
    S.rivers = lines.length ? mergeLines(lines) : flowLines();
    return S.rivers;
  }
  /** タイルの境目で切れた線を、名前ごとにつなぐ（ラベル用） */
  function mergeLines(lines) { return lines.filter((l) => l.pts.length > 1); }
  /** 地形から「水が集まって流れる道」を計算する（D8法：いちばん低い となりへ水が流れると考える） */
  function flowLines() {
    const n = S.grid.n, N = (n + 1) * (n + 1), g = S.grid.ground;
    const down = new Int32Array(N).fill(-1), acc = new Float32Array(N).fill(1);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i;
      let best = -1, drop = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii > n || jj > n) continue;
        const kk = jj * (n + 1) + ii, d = (g[k] - g[kk]) / Math.hypot(di, dj);
        if (d > drop) { drop = d; best = kk; }
      }
      down[k] = best;
    }
    const order = Array.from({ length: N }, (_, k) => k).sort((x, y) => g[y] - g[x]);
    for (const k of order) if (down[k] >= 0) acc[down[k]] += acc[k];
    const Tmajor = N / 12;
    const T = N / 60; // これより多くの水が集まる所を「水の通り道」とする
    const lines = [];
    const xz = (k) => ({ x: -S.grid.half + (k % (n + 1)) * S.grid.step, z: -S.grid.half + Math.floor(k / (n + 1)) * S.grid.step });
    for (let k = 0; k < N; k++) if (acc[k] >= T && down[k] >= 0) lines.push({ name: "", major: acc[k] >= Tmajor, pts: [xz(k), xz(down[k])] });
    return lines;
  }
  async function buildRivers() {
    disposeGroup(groups.rivers);
    if (!S.showRivers) { if (S.texRiv) { S.texRiv = false; applyTexture(); } return; }
    if (!S.rivers) {
      flashHint("🌊 川のデータを読み込み中…");
      await loadRivers();
      if (!S.showRivers) return;
      disposeGroup(groups.rivers);
      if (S.riverSource === "flow") flashHint("🌊 地理院の川のデータが読めなかったので、地形から計算した「水の通り道」を表示しています");
    }
    if (!S.texRiv) { S.texRiv = true; applyTexture(); } // ふだんは地図の画像にかく
    // 地層をはがしている間は地図の画像が出ないので、帯（ポリゴン）でかく
    const w = Math.max(16, S.site.half * 0.02), ve = S.ve, lift = 2 + ve * 1.2, ribbons = S.peel > 0;
    const pos = [], posOut = [];
    const named = {};
    for (const l0 of S.rivers) {
      // 長い区間は細かく分けて、地面の高さに沿わせる（地面にうもれないように）
      const step = Math.max(6, S.grid.step * 0.6), pts = [];
      for (let i = 0; i < l0.pts.length - 1; i++) {
        const a = l0.pts[i], b = l0.pts[i + 1], k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
        for (let j = 0; j < k; j++) pts.push({ x: a.x + ((b.x - a.x) * j) / k, z: a.z + ((b.z - a.z) * j) / k });
      }
      pts.push(l0.pts[l0.pts.length - 1]);
      const l = { name: l0.name, major: l0.major, pts };
      if (ribbons) {
        const ww = l.major ? w : w * 0.45;
        let run = [];
        const flush = () => { stripInto(posOut, run, ww * 0.85, -0.3); stripInto(pos, run, ww / 2, 0); run = []; };
        for (const p of pts) {
          if (Math.abs(p.x) > S.site.half || Math.abs(p.z) > S.site.half) { flush(); continue; }
          run.push({ x: p.x, y: surfaceAt(p.x, p.z) * ve + lift, z: p.z });
        }
        flush();
      }
      for (let i = 0; i < l.pts.length - 1; i++) {
        const p = l.pts[i], q = l.pts[i + 1];
        if (Math.abs(p.x) > S.site.half || Math.abs(p.z) > S.site.half || Math.abs(q.x) > S.site.half || Math.abs(q.z) > S.site.half) continue;
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        if (len < 0.01) continue;
        const ux = (q.x - p.x) / len, uz = (q.z - p.z) / len;
        const yp = surfaceAt(p.x, p.z) * ve + lift, yq = surfaceAt(q.x, q.z) * ve + lift;
        const quad = (arr, hw, dy, ext) => {
          const nx = -uz * hw, nz = ux * hw, ex = ux * ext, ez = uz * ext;
          const v = [[p.x - ex + nx, yp + dy, p.z - ez + nz], [q.x + ex + nx, yq + dy, q.z + ez + nz], [q.x + ex - nx, yq + dy, q.z + ez - nz], [p.x - ex - nx, yp + dy, p.z - ez - nz]];
          for (const t of [0, 1, 2, 0, 2, 3]) arr.push(...v[t]);
        };
        const ww = l.major ? w : w * 0.45; // 小さな水路は細く
        void quad; void ww;
        if (l.name) (named[l.name] = named[l.name] || []).push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, len });
      }
    }
    const mk = (arr, color, order) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const mesh = new THREE.Mesh(geo, clipMat(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: order === 4 ? -12 : -4, polygonOffsetUnits: order === 4 ? -12 : -4, depthWrite: order === 4 })));
      mesh.renderOrder = order;
      return mesh;
    };
    if (ribbons) groups.rivers.add(mk(posOut, 0xffffff, 3), mk(pos, 0x0050ff, 4));
    // 川の名前：地図の文字（注記）に川の名前があれば、その場所に出す
    for (const m of S.site.mapMarks || []) {
      if (m.icon !== "🌊") continue;
      const p = S.frame.toLocal(m.lat, m.lon);
      if (Math.abs(p.x) > S.site.half || Math.abs(p.z) > S.site.half) continue;
      const lab = makeLabel("🌊 " + m.name, { bg: "#0050ff", color: "#fff", bold: true, size: 17 });
      lab.position.set(p.x, surfaceAt(p.x, p.z) * ve + 30, p.z);
      groups.rivers.add(lab);
    }
    // 川の名前：いちばん長く流れている所の真ん中あたり
    for (const name in named) {
      const segs = named[name];
      const total = segs.reduce((a, b) => a + b.len, 0);
      if (total < 150) continue;
      const mid = segs[Math.floor(segs.length / 2)];
      const lab = makeLabel("🌊 " + name, { bg: "#0050ff", color: "#fff", bold: true, size: 17 });
      lab.position.set(mid.x, surfaceAt(mid.x, mid.z) * ve + 25, mid.z);
      groups.rivers.add(lab);
    }
  }
  // ---------- 谷戸（横浜市）：「谷戸のヨコハマ」データセット ----------
  /** この模型の中にある谷戸（線は模型の座標に直しておく） */
  function yatoList() {
    if (S.yato) return S.yato;
    const lim = S.site.half * 1.05;
    S.yato = [];
    for (const y of C.YATO || []) {
      const lines = y.l.map((l) => l.map(([lon, lat]) => S.frame.toLocal(lat, lon)));
      if (lines.some((l) => l.some((p) => Math.abs(p.x) < lim && Math.abs(p.z) < lim))) S.yato.push(Object.assign({}, y, { lines }));
    }
    return S.yato;
  }
  function buildYato() {
    disposeGroup(groups.yato);
    if (S.texYato !== !!S.showYato) { S.texYato = !!S.showYato; if (S.mapCanvas) applyTexture(); }
    if (!S.showYato) return;
    const ribbons = S.peel > 0;
    const half = S.site.half, ve = S.ve, lift = 1.5 + ve * 1.0, w = Math.max(12, half * 0.014);
    const pos = [], posOut = [];
    const inside = (p) => Math.abs(p.x) <= half && Math.abs(p.z) <= half;
    for (const y of yatoList()) {
      let best = null, bestLen = 0;
      for (const l0 of y.lines) {
        const step = Math.max(6, S.grid.step * 0.6), pts = [];
        for (let i = 0; i < l0.length - 1; i++) {
          const a = l0[i], b = l0[i + 1], k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
          for (let j = 0; j < k; j++) pts.push({ x: a.x + ((b.x - a.x) * j) / k, z: a.z + ((b.z - a.z) * j) / k });
        }
        pts.push(l0[l0.length - 1]);
        if (ribbons) {
          let run = [];
          const flush = () => { stripInto(posOut, run, w * 0.8, -0.3); stripInto(pos, run, w / 2, 0); run = []; };
          for (const p of pts) { if (!inside(p)) { flush(); continue; } run.push({ x: p.x, y: surfaceAt(p.x, p.z) * ve + lift, z: p.z }); }
          flush();
        }
        let len = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          if (!inside(p) || !inside(q)) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < 0.01) continue;
          len += d;
          const ux = (q.x - p.x) / d, uz = (q.z - p.z) / d;
          const yp = surfaceAt(p.x, p.z) * ve + lift, yq = surfaceAt(q.x, q.z) * ve + lift;
          const quad = (arr, hw, dy, ext) => {
            const nx = -uz * hw, nz = ux * hw, ex = ux * ext, ez = uz * ext;
            const v = [[p.x - ex + nx, yp + dy, p.z - ez + nz], [q.x + ex + nx, yq + dy, q.z + ez + nz], [q.x + ex - nx, yq + dy, q.z + ez - nz], [p.x - ex - nx, yp + dy, p.z - ez - nz]];
            for (const t of [0, 1, 2, 0, 2, 3]) arr.push(...v[t]);
          };
          void quad;
        }
        if (len > bestLen) {
          bestLen = len;
          const vis = pts.filter(inside);
          best = vis[Math.floor(vis.length / 2)];
        }
      }
      if (best) {
        const lab = makeLabel("〰 " + y.n, { bg: "#0f8f86", color: "#fff", bold: true, size: 15 });
        lab.position.set(best.x, surfaceAt(best.x, best.z) * ve + 22, best.z);
        lab.userData.pick = { type: "yato", id: y.id };
        groups.yato.add(lab);
      }
    }
    const mk = (arr, color, order) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const mesh = new THREE.Mesh(geo, clipMat(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: order === 4 ? -12 : -4, polygonOffsetUnits: order === 4 ? -12 : -4, depthWrite: order === 4 })));
      mesh.renderOrder = order;
      return mesh;
    };
    if (ribbons) groups.yato.add(mk(posOut, 0xffffff, 3), mk(pos, 0x14b8a6, 4));
  }
  function showYato(id) {
    const y = yatoList().find((v) => v.id === id);
    if (!y) return;
    const row = (k, v) => (v ? "<tr><th>" + k + "</th><td>" + v + "</td></tr>" : "");
    openDetail('<h3>〰 ' + esc(y.n) + (y.k ? '<small>（' + esc(y.k) + '）</small>' : "") + "</h3>" +
      '<p class="hint">谷戸（やと）は、丘の間に川がつくった、細長い小さな谷です。谷の底には、川が運んだやわらかい土砂（沖積層）がたまっていることが多く、昔は田んぼとして使われてきました。</p>' +
      '<table class="kv">' + row("場所", esc((y.ku || "") + " " + (y.cho || ""))) +
      row("江戸時代の村", esc(y.mura || "") + (y.koaza ? "（" + esc(y.koaza) + "）" : "")) +
      row("水が流れていく川", esc((y.r || []).slice().reverse().join(" → "))) +
      row("昔の本", y.s ? '<a href="' + esc(y.s) + '" target="_blank" rel="noopener">新編武蔵風土記稿（国立国会図書館）</a>' : "") + "</table>" +
      '<p class="hint">✂️ この谷戸を横切るように断面図を作成すると、谷の底に どんな地層があるか 確かめられます。</p>' +
      '<div class="meta">出典：<a href="https://yato.midoriit.com/" target="_blank" rel="noopener">谷戸のヨコハマ</a>（小池 隆・パブリックドメイン）</div>');
  }
  /** 断面の線と谷戸が交わる所 */
  function yatoCrossings(sec) {
    sec = sec || S.section;
    if (!S.showYato || !sec) return [];
    const out = [];
    for (const y of yatoList()) for (const l of y.lines) for (let i = 0; i < l.length - 1; i++) {
      const p = l[i], q = l[i + 1];
      for (const g of sec.segs) {
        const ex = g.ux * g.len, ez = g.uz * g.len, fx = q.x - p.x, fz = q.z - p.z;
        const den = ex * fz - ez * fx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p.x - g.x) * fz - (p.z - g.z) * fx) / den, u = ((p.x - g.x) * ez - (p.z - g.z) * ex) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          const d = g.d0 + t * g.len;
          if (!out.some((o) => Math.abs(o.d - d) < 25 && o.name === y.n)) out.push({ d, name: y.n });
        }
      }
    }
    return out;
  }
  /** 断面の線と川が交わる所 */
  function riverCrossings(sec) {
    sec = sec || S.section;
    if (!S.showRivers || !S.rivers || !sec) return [];
    const out = [];
    for (const l of S.rivers) for (let i = 0; i < l.pts.length - 1; i++) {
      const p = l.pts[i], q = l.pts[i + 1];
      for (const g of sec.segs) {
        const ex = g.ux * g.len, ez = g.uz * g.len, fx = q.x - p.x, fz = q.z - p.z;
        const den = ex * fz - ez * fx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p.x - g.x) * fz - (p.z - g.z) * fx) / den, u = ((p.x - g.x) * ez - (p.z - g.z) * ex) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          const d = g.d0 + t * g.len;
          if (!l.major && S.riverSource !== "flow") continue; // 断面図には大きい川だけ
          if (!out.some((o) => Math.abs(o.d - d) < (S.riverSource === "flow" ? 120 : 25))) {
            const x = g.x + g.ux * t * g.len, z = g.z + g.uz * t * g.len;
            let nm = l.name;
            for (const m of S.site.mapMarks || []) if (m.icon === "🌊") {
              const q = S.frame.toLocal(m.lat, m.lon);
              if (Math.hypot(q.x - x, q.z - z) < 900 && !nm) nm = m.name;
            }
            out.push({ d, name: nm || (S.riverSource === "flow" ? "水の通り道" : "川") });
          }
        }
      }
    }
    return out;
  }

  // ---------- 気づきメモ ----------
  function buildNotes() {
    disposeGroup(groups.notes);
    for (const nt of S.notes) {
      const y = groundAt(nt.x, nt.z) * S.ve;
      const top = y + 60;
      const grp = new THREE.Group();
      grp.add(pinLine(nt.x, nt.z, y, top, 0x8a6d00));
      const txt = (nt.photo ? "📷 " : "") + wrapText(nt.text, 14) + (nt.author ? "\n― " + nt.author : "");
      const lab = makeLabel(txt, { bg: nt.color || "#ffd54f", border: "rgba(0,0,0,0.3)", size: 13 });
      lab.position.set(nt.x, top, nt.z);
      lab.userData.pick = { type: "note", id: nt.id };
      lab.userData.isLabel = true;
      grp.add(lab);
      groups.notes.add(grp);
    }
    applyVisibility();
  }
  function wrapText(t, w) {
    const out = [];
    for (const para of String(t).split("\n")) {
      let s = para;
      while (s.length > w) { out.push(s.slice(0, w)); s = s.slice(w); }
      out.push(s);
    }
    return out.slice(0, 6).join("\n");
  }

  function applyVisibility() {
    if (!groups.bores) return;
    groups.bores.visible = S.showBores;
    groups.labels.visible = S.labels;
    groups.notes.visible = S.showNotes;
    groups.ring.visible = S.ring;
    groups.bores.children.forEach((c) => { if (c.userData.isLabel) c.visible = S.labels && S.boreNames !== false; });
  }

  // ---------- 地図の画像 ----------
  /** 地図の画像を1つ読み込む（読み込めたら true） */
  async function ensureMapCanvas(type, quiet) {
    S.mapCanvas = S.mapCanvas || {};
    if (S.mapCanvas[type]) return true;
    const mt = C.MAP_TYPES[type];
    if (mt.local) { S.mapCanvas[type] = localReliefCanvas(); return true; }
    let done = 0;
    const hideLater = quiet || $("loading").classList.contains("hidden");
    if (!hideLater) setLoading("地図を読み込み中…");
    // 広い範囲では、画像が大きくなりすぎないようにズームを下げる
    let zoom = mt.zoom;
    const mpp = (zz) => (156543.03392804097 * Math.cos((S.site.center.lat * Math.PI) / 180)) / Math.pow(2, zz);
    while (zoom > 12 && (2 * S.site.half) / mpp(zoom) > 4096) zoom--;
    const r = await GEO.loadMapCanvas(S.frame, S.site.half, zoom, mt.url, () => {
      done++;
      if (!hideLater) setLoading("地図を読み込み中…（" + done + "枚）");
    }, !!mt.under);
    if (!r.ok) return false;
    S.mapCanvas[type] = r.canvas;
    return true;
  }
  async function setMap(type) {
    const prev = S.mapType && S.mapCanvas && S.mapCanvas[S.mapType] ? S.mapType : null;
    const mt = C.MAP_TYPES[type];
    if (mt.geology && !prev) flashHint("地質図を読み込み中…");
    let ok = await ensureMapCanvas(type);
    if (ok && mt.under) ok = await ensureMapCanvas(mt.under);
    if (!ok) {
      if (prev && prev !== type) {
        flashHint("「" + mt.name + "」はこの場所では読み込めませんでした。前の地図にもどします。");
        $("mapSelect").value = prev;
        return;
      }
      flashHint("地図の画像を読み込めませんでした。「高さで色分け」に切りかえます。");
      return setMap("local");
    }
    if (S.mapType !== type) S.cardClosed.cmpCard = S.cardClosed.geoCard = false; // えらび直したら、説明をまた出す
    S.mapType = type;
    store.set("chisou3d:map2", type);
    $("mapSelect").value = type;
    applyTexture();
    updateMapCards();
  }
  // ---------- 地図の横に出す小さな説明（✕でとじられる） ----------
  function fcard(id, title) {
    let el = $(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id; el.className = "fcard";
      el.innerHTML = '<div class="fc-head"><b></b><button type="button" class="fc-x" aria-label="とじる" title="とじる">✕</button></div><div class="fc-body"></div>';
      el.querySelector(".fc-x").onclick = () => { S.cardClosed[id] = true; el.classList.add("hidden"); };
      $("floatStack").appendChild(el);
    }
    el.querySelector(".fc-head b").textContent = title;
    return el;
  }
  function showCard(id, on) {
    const el = $(id); if (!el) return;
    el.classList.toggle("hidden", !on || !!S.cardClosed[id]);
  }
  /** 地図の種類に合わせて、「昔と今をくらべる」・「地質図の説明」を出す */
  function updateMapCards() {
    const mt = C.MAP_TYPES[S.mapType] || {};
    const old = mt.group === "昔の写真";
    if (old) {
      const el = fcard("cmpCard", "🕰 昔と今をくらべる");
      if (!el.dataset.ready) {
        el.dataset.ready = 1;
        el.querySelector(".fc-body").innerHTML = '<div class="cmp-row"><span>昔</span><input type="range" id="cmpRange" min="0" max="100" value="0"><span>今</span></div><p class="hint" id="cmpNote"></p>';
        let raf = 0;
        $("cmpRange").oninput = async () => {
          if (!S.mapCanvas.photo) { $("cmpNote").textContent = "今の航空写真を読み込み中…"; if (!(await ensureMapCanvas("photo", true))) { $("cmpNote").textContent = "今の航空写真を読み込めませんでした"; return; } }
          S.compare = +$("cmpRange").value / 100;
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; applyTexture(); });
          $("cmpNote").textContent = "";
        };
      }
      $("cmpNote").textContent = "つまみを右へ動かすと、今の航空写真が重なっていきます。家が建つ前の、谷や台地の形をさがそう。";
      $("cmpRange").value = Math.round((S.compare || 0) * 100);
    } else S.compare = 0;
    showCard("cmpCard", old);
    if (mt.geology) geologyCard(); else showCard("geoCard", false);
  }
  /** 地質図の説明：模型の範囲の何か所かで「ここは何の地層か」を産総研に聞いて、一覧にする */
  async function geologyCard() {
    const el = fcard("geoCard", "🪨 地質図（地面の下は何？）");
    showCard("geoCard", true);
    const body = el.querySelector(".fc-body");
    const src = '<p class="fc-src">出典：<a href="https://gbank.gsj.jp/seamless/" target="_blank" rel="noopener">産総研 地質調査総合センター「20万分の1日本シームレス地質図V2」↗</a>。' +
      "地質図は広い範囲をまとめてかいた図なので、模型（ボーリングからの推定）と細かい所はちがうことがあります。</p>";
    if (S.geoLegend && S.geoLegend.site === S.site.id + S.site.half) { body.innerHTML = S.geoLegend.html + src; return; }
    body.innerHTML = '<p class="hint">この場所の地質を調べています…</p>' + src;
    const h = S.site.half, pts = [[0, 0]];
    for (const fx of [-0.6, 0, 0.6]) for (const fz of [-0.6, 0, 0.6]) if (fx || fz) pts.push([fx * h, fz * h]);
    const seen = new Map();
    await Promise.all(pts.map(async ([x, z], i) => {
      const ll = S.frame.toLatLon(x, z);
      try {
        const res = await fetch(C.GEOLOGY_LEGEND + "?point=" + ll.lat.toFixed(6) + "," + ll.lon.toFixed(6));
        if (!res.ok) return;
        const j = await res.json(), d = Array.isArray(j) ? j[0] : j;
        if (!d) return;
        const age = d.formationAge_ja || d.formationAge || "", rock = d.lithology_ja || d.lithology || "", grp = d.group_ja || d.group || "";
        const k = (d.symbol || "") + age + rock;
        if (!k.trim()) return;
        const color = d.r != null ? "rgb(" + d.r + "," + d.g + "," + d.b + ")" : d.color || "#ccc";
        if (!seen.has(k)) seen.set(k, { age, rock, grp, color, center: i === 0 });
        else if (i === 0) seen.get(k).center = true;
      } catch (e) { /* つながらないときは、下の説明だけ出す */ }
    }));
    let html;
    if (seen.size) {
      html = '<ul class="geo-list">' + Array.from(seen.values()).sort((a, b) => b.center - a.center).map((v) =>
        '<li><i style="background:' + v.color + '"></i><span>' + (v.center ? "<b>🏫 学校のあたり：</b>" : "") + esc(v.age) + (v.rock ? "の <b>" + esc(v.rock) + "</b>" : "") + (v.grp ? "<small>（" + esc(v.grp) + "）</small>" : "") + "</span></li>").join("") + "</ul>";
    } else html = '<p class="hint">色ごとの説明を読み込めませんでした。出典のサイトで、地図をタップすると調べられます。</p>';
    html += '<p class="hint">「〇〇紀・〇〇世」は、その地層ができた時代です。模型の「泥岩」「ローム層」などと見くらべてみよう。</p>';
    S.geoLegend = { site: S.site.id + S.site.half, html };
    body.innerHTML = html + src;
  }

  // ---------- 凹凸の見せ方 ----------
  const RELIEF = {
    none: "地図のまま",
    color: "高さで色分けを重ねる",
    contour: "等高線を重ねる",
    terrace: "段々模型（等高線模型）",
    shade: "影を強くする",
  };
  function reliefStep() {
    const range = S.stats.p98 - S.stats.p02;
    for (const st of [1, 2, 5, 10, 20, 50]) if (range / st <= 14) return st;
    return 100;
  }
  function terraceOf(h) { const st = reliefStep(); return Math.floor(h / st) * st; }
  function colorRamp(t) {
    const stops = [[0, [49, 110, 170]], [0.2, [90, 175, 190]], [0.4, [140, 200, 120]], [0.6, [230, 220, 110]], [0.8, [220, 150, 80]], [1, [170, 90, 60]]];
    t = Math.min(1, Math.max(0, t));
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (t - t0) / (t1 - t0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
    }
    return stops[stops.length - 1][1];
  }
  function bandRange() {
    const st = reliefStep();
    return { st, lo: Math.floor(S.stats.min / st) * st, hi: Math.ceil(S.stats.max / st) * st };
  }
  /** 高さの色・等高線を描いた透明な画像 */
  function reliefOverlay(mode) {
    S.overlays = S.overlays || {};
    if (S.overlays[mode]) return S.overlays[mode];
    const size = 1024, half = S.site.half, d = (2 * half) / size;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(size, size);
    const { st, lo, hi } = bandRange();
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = groundAt(-half + (x + 0.5) * d, -half + (y + 0.5) * d);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const k = y * size + x, h = H[k], band = Math.floor(h / st);
      let r = 0, g = 0, b = 0, a = 0;
      if (mode === "color" || mode === "terrace") {
        const t = mode === "terrace" ? (band * st + st / 2 - lo) / (hi - lo) : (h - lo) / (hi - lo);
        [r, g, b] = colorRamp(t);
        a = mode === "terrace" ? 170 : 125;
      }
      // 等高線：となりと段がちがう所
      const right = x < size - 1 ? Math.floor(H[k + 1] / st) : band, down = y < size - 1 ? Math.floor(H[k + size] / st) : band;
      if (band !== right || band !== down) {
        const major = Math.max(band, right, down) % 2 === 0;
        if (mode === "contour" || mode === "terrace") { r = 70; g = 40; b = 20; a = major ? 235 : 150; }
      }
      img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    if (mode === "contour") {
      // 太い線をもう少し太く
      ctx.globalCompositeOperation = "source-over";
    }
    S.overlays[mode] = cv;
    return cv;
  }
  /** 防災の情報（ハザードマップ）を読み込む */
  async function setHazard(type) {
    S.hazard = type;
    $("hazardSelect").value = type;
    S.hazardCanvas = S.hazardCanvas || {};
    if (type === "lore") await loadLore();
    buildLore();
    if (type !== "none" && !C.HAZARDS[type].lore && !S.hazardCanvas[type]) {
      const hz = C.HAZARDS[type];
      flashHint("防災の情報を読み込み中…");
      let zoom = hz.zoom;
      const mpp = (zz) => (156543.03392804097 * Math.cos((S.site.center.lat * Math.PI) / 180)) / Math.pow(2, zz);
      while (zoom > 12 && (2 * S.site.half) / mpp(zoom) > 4096) zoom--;
      let merged = null, ok = 0;
      for (const url of hz.urls) {
        const r = await GEO.loadMapCanvas(S.frame, S.site.half, zoom, url, null, true);
        ok += r.ok;
        if (!merged) merged = r.canvas; else merged.getContext("2d").drawImage(r.canvas, 0, 0);
      }
      if (!ok) {
        // 範囲に情報がない（警戒区域がない）ことも、つながらないこともある
        flashHint("この範囲には「" + hz.name + "」の情報がないか、読み込めませんでした");
      }
      S.hazardCanvas[type] = merged;
    }
    applyTexture();
    const box = $("hazardNote");
    if (type === "none") box.classList.add("hidden");
    else {
      box.innerHTML = "<b>" + esc(C.HAZARDS[type].name) + "</b><br>" + esc(C.HAZARDS[type].legend) +
        (type === "lore" ? "<br>" + loreSummary() : "") +
        '<br>谷の底（沖積層）や急な坂と、くらべてみよう。<br><a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener">ハザードマップポータルサイト ↗</a>';
      box.classList.remove("hidden");
    }
  }
  function applyTexture() {
    if (!S.mapCanvas || !S.mapCanvas[S.mapType]) return;
    const mt = C.MAP_TYPES[S.mapType] || {};
    let base = S.mapCanvas[S.mapType];
    let canvas = base;
    const hz = S.hazard && S.hazard !== "none" && S.hazardCanvas && S.hazardCanvas[S.hazard];
    const lines = S.showRivers && S.rivers || S.showYato && yatoList().length;
    const under = mt.under && S.mapCanvas[mt.under];
    const cmp = S.compare > 0 && mt.group === "昔の写真" && S.mapCanvas.photo;
    if (["color", "contour", "terrace"].includes(S.relief) || hz || lines || under || cmp || S.showBasin) {
      if (under) base = under; // 地質図を、航空写真の上にすかして重ねる
      // 同じ大きさなら、前のキャンバスを使い回す（つまみを動かしたとき軽くするため）
      canvas = S.texCanvas && S.texCanvas.width === base.width && S.texCanvas.height === base.height ? S.texCanvas : document.createElement("canvas");
      canvas.width = base.width; canvas.height = base.height;
      S.texCanvas = canvas;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      ctx.imageSmoothingEnabled = true;
      if (under) { ctx.globalAlpha = mt.alpha || 0.55; ctx.drawImage(S.mapCanvas[S.mapType], 0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1; }
      if (cmp) { ctx.globalAlpha = S.compare; ctx.drawImage(S.mapCanvas.photo, 0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1; }
      if (S.showBasin) drawBasinOnMap(ctx, canvas.width, canvas.height);
      if (["color", "contour", "terrace"].includes(S.relief)) ctx.drawImage(reliefOverlay(S.relief), 0, 0, canvas.width, canvas.height);
      if (hz) { ctx.globalAlpha = 0.75; ctx.drawImage(hz, 0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1; }
      if (lines) drawLinesOnMap(ctx, canvas.width, canvas.height);
    }
    if (S.curTex && S.curTex.image === canvas) { S.curTex.needsUpdate = true; return; }
    if (S.curTex) S.curTex.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    S.curTex = tex;
    texMat.map = tex;
    texMat.needsUpdate = true;
  }
  // ---------- 模型を切る：赤いガイド線 ----------
  //  向き ang（0＝東西の線、90°＝南北の線）と、まん中からのずれ off（m）で、切る線を決める
  S.cutGuide = { ang: 0, off: 0 };
  function cutGuideEnds() {
    const g = S.cutGuide, h = S.site.half, ux = Math.cos(g.ang), uz = Math.sin(g.ang), nx = -uz, nz = ux;
    const cx = nx * g.off, cz = nz * g.off;
    let t0 = -Infinity, t1 = Infinity;
    for (const [p, u] of [[cx, ux], [cz, uz]]) {
      if (Math.abs(u) < 1e-9) { if (Math.abs(p) > h) return null; continue; }
      const ta = (-h - p) / u, tb = (h - p) / u;
      t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (!(t1 - t0 > 20)) return null;
    t0 += 1; t1 -= 1;
    return [{ x: cx + ux * t0, z: cz + uz * t0 }, { x: cx + ux * t1, z: cz + uz * t1 }];
  }
  function cutDirName(a) {
    const d = ((((a * 180) / Math.PI) % 180) + 180) % 180;
    return d < 22.5 || d >= 157.5 ? "東西" : d < 67.5 ? "北西〜南東" : d < 112.5 ? "南北" : "北東〜南西";
  }
  function syncCutGuideUI() {
    const g = S.cutGuide, h = S.site.half;
    g.off = Math.max(-h * 0.98, Math.min(h * 0.98, g.off));
    $("cutAng").value = Math.round(((((g.ang * 180) / Math.PI) % 180) + 180) % 180);
    $("cutOff").value = Math.round((g.off / h) * 100);
    $("cutAngV").textContent = cutDirName(g.ang);
  }
  function buildCutGuide() {
    if (!groups.guide) return;
    disposeGroup(groups.guide);
    if (S.mode !== "cut" || S.section) return;
    const e = cutGuideEnds(); if (!e) return;
    const [a, b] = e, len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.round(len / (S.grid.step * 0.7)));
    const pts = [];
    for (let i = 0; i <= n; i++) { const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n; pts.push({ x, z, y: surfaceAt(x, z) * S.ve }); }
    // 地面の上の赤い帯
    const pos = [];
    stripInto(pos, pts, Math.max(6, S.site.half * 0.011), 2);
    const gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const band = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: 0xe53935, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95 }));
    band.renderOrder = 5; groups.guide.add(band);
    // ナイフの面（うすい赤）：ここで模型が切られる
    const top = Math.max(...pts.map((p) => p.y)) + 30, bot = S.model.base * S.ve, wall = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      wall.push(p.x, bot, p.z, q.x, bot, q.z, q.x, top, q.z, p.x, bot, p.z, q.x, top, q.z, p.x, top, p.z);
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
    groups.guide.add(new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0xe53935, side: THREE.DoubleSide, transparent: true, opacity: 0.22, depthWrite: false })));
    // 両はしの目じるし
    for (const [p, t] of [[pts[0], "🔪"], [pts[pts.length - 1], "🔪"]]) {
      const lab = makeLabel(t, { bg: "#e53935", color: "#fff", bold: true, size: 14 });
      lab.position.set(p.x, p.y + 12, p.z); groups.guide.add(lab);
    }
  }

  // ---------- 自然災害伝承碑（国土地理院） ----------
  async function loadLore() {
    if (S.lore && S.lore.site === S.site.id + S.site.half) return;
    flashHint("自然災害伝承碑を読み込み中…");
    const z = 7, c = S.site.center, n = Math.pow(2, z);
    const tx = (lon) => Math.floor(((lon + 180) / 360) * n), ty = (lat) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    const d = 0.2, tiles = new Set();
    for (const la of [c.lat - d, c.lat + d]) for (const lo of [c.lon - d, c.lon + d]) tiles.add(tx(lo) + "/" + ty(la));
    const all = [];
    for (const t of tiles) {
      try {
        const res = await fetch(C.LORE_URL.replace("{z}", z).replace("{x}/{y}", t));
        if (!res.ok) continue;
        const j = await res.json();
        for (const f of j.features || []) {
          const [lon, lat] = f.geometry.coordinates, p = S.frame.toLocal(lat, lon), pr = f.properties || {};
          all.push({ id: pr.ID || lat + "," + lon, x: p.x, z: p.z, dist: Math.hypot(p.x, p.z), name: pr.LoreName || "伝承碑", kind: pr.DisasterKind || "", dname: String(pr.DisasterName || "").replace(/<br>/g, " "), info: pr.DisasterInfo || "", addr: pr.Address || "", img: pr.Image || "" });
        }
      } catch (e) { /* つながらない */ }
    }
    const seen = new Set();
    S.lore = { site: S.site.id + S.site.half, list: all.filter((a) => (seen.has(a.id) ? false : seen.add(a.id))).sort((a, b) => a.dist - b.dist) };
  }
  function loreInside() { const h = S.site.half; return S.lore ? S.lore.list.filter((a) => Math.abs(a.x) < h && Math.abs(a.z) < h) : []; }
  function loreSummary() {
    if (!S.lore || !S.lore.list.length) return "（読み込めなかったか、近くに石碑がありません）";
    const inside = loreInside();
    if (inside.length) return "模型の中に <b>" + inside.length + "か所</b>あります。旗をタップすると説明が出ます。";
    const nb = S.lore.list.slice(0, 3).map((a) => esc(a.name) + "（" + esc(a.kind) + "・約" + (a.dist / 1000).toFixed(1) + "km先）").join("、");
    return "模型の範囲にはありません。いちばん近いのは：" + nb;
  }
  function buildLore() {
    if (!groups.lore) return;
    disposeGroup(groups.lore);
    if (S.hazard !== "lore") return;
    for (const a of loreInside()) {
      const y = groundAt(a.x, a.z) * S.ve, top = y + 55, grp = new THREE.Group();
      grp.add(pinLine(a.x, a.z, y, top, 0x6a1b9a));
      const lab = makeLabel("🪦 " + a.name + (a.kind ? "（" + a.kind + "）" : ""), { bg: "#f3e5f5", border: "#6a1b9a", size: 13 });
      lab.position.set(a.x, top, a.z); lab.userData.pick = { type: "lore", id: a.id };
      grp.add(lab); groups.lore.add(grp);
    }
  }
  function showLore(id) {
    const a = S.lore && S.lore.list.find((x) => x.id === id);
    if (!a) return;
    openDetail("<h3>🪦 " + esc(a.name) + "</h3>" +
      '<div class="meta">' + esc(a.dname) + (a.kind ? "（" + esc(a.kind) + "）" : "") + "<br>" + esc(a.addr) + "</div>" +
      "<p>" + esc(a.info) + "</p>" +
      (/^https:\/\//.test(a.img) ? '<a href="' + esc(a.img) + '" target="_blank" rel="noopener"><img class="log-image" src="' + esc(a.img) + '" alt="石碑の写真"></a>' : "") +
      '<p class="meta">出典：国土地理院「自然災害伝承碑」</p>');
  }

  // ---------- どこでもボーリング（タップした所の地下を、模型から推定） ----------
  function setDig(on) {
    S.digOn = on;
    $("btnDig").classList.toggle("on", on);
    if (on) {
      if (S.mode !== "view") setMode("view");
      const el = fcard("digCard", "⛏ どこでもボーリング");
      el.querySelector(".fc-body").innerHTML = '<p><b>模型をタップ</b>すると、その場所の地下の<b>推定の柱状図</b>が出ます。自分の家や公園の下を調べてみよう。</p><p class="hint">終わるときは ✕ を押します。</p>';
      el.querySelector(".fc-x").onclick = () => setDig(false);
      S.cardClosed.digCard = false; showCard("digCard", true);
      setHint("⛏ 模型の好きな所をタップしてください");
    } else { showCard("digCard", false); S.dig = null; buildDig(); setHint(modeHint()); }
  }
  function buildDig() {
    if (!groups.dig) return;
    disposeGroup(groups.dig);
    if (!S.dig) return;
    const y = groundAt(S.dig.x, S.dig.z) * S.ve;
    groups.dig.add(pinLine(S.dig.x, S.dig.z, y, y + 70, 0xc62828));
    const lab = makeLabel("⛏ ここ", { bg: "#ffebee", border: "#c62828", size: 14, bold: true });
    lab.position.set(S.dig.x, y + 70, S.dig.z); groups.dig.add(lab);
  }
  function digAt(p) {
    S.dig = p; buildDig();
    const s = GL.sampleModel(S.model, p.x, p.z), layers = S.site.layers, g = groundAt(p.x, p.z);
    const segs = [];
    layers.forEach((l, li) => { const top = Math.min(s.tops[li], g), bot = s.bots[li]; if (top - bot > 0.05) segs.push({ l, top, bot }); });
    segs.sort((a, b) => b.top - a.top);
    const bottom = Math.max(S.model.base, g - 60), depth = Math.max(1, g - bottom);
    const W = 320, colX = 70, colW = 56, pxm = Math.min(14, Math.max(4, 380 / depth)), y0 = 22;
    let svg = '<svg viewBox="0 0 ' + W + " " + (depth * pxm + 40) + '" width="100%" style="max-width:' + W + 'px">' +
      '<text x="4" y="12" font-size="11" fill="#5a6873">深さ(m)</text><text x="' + (colX + colW + 8) + '" y="12" font-size="11" fill="#5a6873">地層（推定）</text>';
    let lastY = -99;
    for (const sg of segs) {
      const a = Math.max(0, g - sg.top), b = Math.min(depth, g - sg.bot);
      if (b <= a) continue;
      const y1 = y0 + a * pxm, y2 = y0 + b * pxm, ly = Math.max((y1 + y2) / 2 + 4, lastY + 13); lastY = ly;
      svg += '<rect x="' + colX + '" y="' + y1 + '" width="' + colW + '" height="' + Math.max(1, y2 - y1) + '" fill="' + sg.l.color + '" stroke="#333" stroke-width="0.8" stroke-dasharray="4 2"/>' +
        '<text x="' + (colX - 6) + '" y="' + (y2 + 4) + '" font-size="11" text-anchor="end" fill="#333">' + b.toFixed(0) + "</text>" +
        '<text x="' + (colX + colW + 8) + '" y="' + ly + '" font-size="12" fill="#1f2a33">' + esc(sg.l.short || sg.l.name) + "</text>";
    }
    svg += "</svg>";
    let near = null;
    for (const b of S.bores) { const dd = Math.hypot(b.x - p.x, b.z - p.z); if (!near || dd < near.d) near = { b, d: dd }; }
    const trust = !near ? "資料なし" : near.d < 100 ? "わりと近くに本物の資料があります" : near.d < 300 ? "少しはなれた資料から推定しています" : "資料が遠いので、あまり確かではありません";
    openDetail("<h3>⛏ ここの地下は？（推定）</h3>" +
      '<div class="warnbox">⚠ これは本物のボーリングではありません。まわりのボーリング資料から<b>推定した</b>柱状図です（点線のわく）。</div>' +
      '<div class="meta">地面の標高：<b>' + g.toFixed(1) + "m</b><br>" +
      (near ? "いちばん近い本物の資料：" + esc(near.b.name) + "（約" + Math.round(near.d) + "m）<br>" : "") + "たしからしさ：" + trust + "</div>" + svg +
      (near ? '<div class="actions"><button id="digNear">🔍 近くの本物の柱状図を見る</button></div>' : ""));
    if (near) $("digNear").onclick = () => showBore(near.b.id);
  }

  // ---------- 3Dプリンター用のデータ（STL） ----------
  function exportSTL() {
    const g = S.grid, n = g.n, N = n + 1, h = g.ground;
    const sizeMM = 150, k = sizeMM / (2 * g.half), ve = S.ve;
    let lo = Infinity; for (let i = 0; i < h.length; i++) lo = Math.min(lo, h[i]);
    const baseMM = 5, zOf = (v) => baseMM + (v - lo) * k * ve;
    const X = (i) => i * g.step * k, Y = (j) => (n - j) * g.step * k; // 北が上
    const tris = [];
    const T = (a, b, c) => tris.push(a, b, c);
    const P = (i, j, top) => [X(i), Y(j), top ? zOf(h[j * N + i]) : 0];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = P(i, j, 1), b = P(i + 1, j, 1), c = P(i, j + 1, 1), d = P(i + 1, j + 1, 1);
      T(a, c, b); T(b, c, d);
    }
    const wall = (pts) => { for (let q = 0; q < pts.length - 1; q++) { const [i0, j0] = pts[q], [i1, j1] = pts[q + 1], a = P(i0, j0, 1), b = P(i1, j1, 1), a0 = P(i0, j0, 0), b0 = P(i1, j1, 0); T(a, a0, b); T(b, a0, b0); } };
    const side = (f) => Array.from({ length: N }, (_, t) => f(t));
    wall(side((t) => [t, n]));
    wall(side((t) => [n, n - t]));
    wall(side((t) => [n - t, 0]));
    wall(side((t) => [0, t]));
    const s = sizeMM; T([0, 0, 0], [s, s, 0], [s, 0, 0]); T([0, 0, 0], [0, s, 0], [s, s, 0]);
    const cnt = tris.length / 3, buf = new ArrayBuffer(84 + cnt * 50), dv = new DataView(buf);
    for (let q = 0; q < cnt; q++) {
      const o = 84 + q * 50; let off = o + 12;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { dv.setFloat32(off, tris[q * 3 + r][c], true); off += 4; }
    }
    dv.setUint32(80, cnt, true);
    download("3D土地模型-" + S.site.id + "-高さ×" + ve + ".stl", buf, "model/stl");
    flashHint("🧊 3Dプリンター用のデータ（STL）を保存しました：一辺 " + sizeMM + "mm、高さ ×" + ve + "（下の厚み " + baseMM + "mm）");
  }

  // ---------- 断面図の予想ワークシート（印刷用） ----------
  function printWorksheet() {
    if (!secView || !secView.data || $("sectionSheet").classList.contains("hidden")) {
      flashHint("🖨 先に「✂️ 断面図を作成」で断面図をつくってから押してください");
      return;
    }
    // 印刷用に、大きな断面図を別にかく（予想の線・答え・大地のでき方は入れない。たては図いっぱいに強調）
    const off = document.createElement("canvas"); off.width = 2400; off.height = 1100;
    const v = new C.SectionView(off, { site: S.site });
    Object.assign(v, { data: secView.data, strokes: [], dpr: 2, reversed: secView.reversed, showBores: true, showNames: secView.showNames, connect: false, showModel: false, stage: 0, veFixed: 0, hScale: 1, zoom: 1, pan: 0.5 });
    v.draw();
    const img = off.toDataURL("image/png");
    const legend = S.site.layers.map((l) => '<span><i style="background:' + l.color + '"></i>' + esc(l.short || l.name) + "</span>").join("");
    const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>断面図の予想ワークシート</title><style>' +
      'body{font-family:"BIZ UDPGothic",sans-serif;margin:16mm;color:#222}h1{font-size:20px;margin:0 0 6px}.row{display:flex;gap:16px;font-size:14px;margin-bottom:8px}.row span{flex:1;border-bottom:1px solid #333;padding-bottom:2px}' +
      'img{width:100%;border:1px solid #999}.lg{font-size:12px;margin:6px 0}.lg span{margin-right:10px;white-space:nowrap}.lg i{display:inline-block;width:14px;height:10px;margin-right:3px;border:1px solid #555}' +
      '.box{border:1px solid #333;min-height:28mm;margin-top:6px;padding:4px;font-size:13px}@media print{button{display:none}}</style></head><body>' +
      "<h1>断面図の予想ワークシート　" + esc(S.site.title) + "</h1>" +
      '<div class="row"><span>　年　組　名前</span><span>断面 ' + esc($("secInfo").textContent) + "</span></div>" +
      "<p style=\"font-size:14px;margin:4px 0\">① 柱と柱の<b>同じ地層</b>を、色えんぴつで線でつないで、地層の広がりを予想しよう。</p>" +
      '<img src="' + img + '"><div class="lg">地層の色：' + legend + "</div>" +
      '<div class="box">② そう考えた理由（どの柱の、どの層を手がかりにした？）</div>' +
      '<div class="box">③ 答え合わせで分かったこと（予想と同じ所・ちがった所）</div>' +
      '<p style="font-size:11px;color:#666">出典：国土地理院（地形）／国土地盤情報データベース（ボーリング柱状図）。地下の地層はボーリング資料からの推定です。</p>' +
      '<button onclick="print()">🖨 印刷する</button></body></html>';
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => { try { w.print(); } catch (e) { /* 手で印刷 */ } }, 600); }
    else download("断面図ワークシート-" + stamp() + ".html", html, "text/html");
  }

  // ---------- 流域・分水界（雨水がどこへ流れるか） ----------
  //  模型の標高から、1マスごとに「いちばん急に下る となりのマス」へ水が流れるとして計算する。
  //  くぼ地は先に水でうめて（あふれる所まで高くして）、必ず模型のはしまで流れ出るようにする。
  function computeBasins() {
    if (S.basin && S.basin.site === S.site.id && S.basin.half === S.site.half) return S.basin;
    const g = S.grid, N = g.n + 1, M = N * N, h = g.ground;
    const f = new Float64Array(M), done = new Uint8Array(M);
    // 小さい順に取り出せる入れもの（ヒープ）
    const hk = new Int32Array(M), hv = new Float64Array(M); let hn = 0;
    const push = (k, v) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= v) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
    const pop = () => { const k = hk[0], lk = hk[--hn], lv = hv[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hv[c + 1] < hv[c]) c++; if (hv[c] >= lv) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = lk; hv[i] = lv; return k; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (i === 0 || j === 0 || i === N - 1 || j === N - 1) { const k = j * N + i; f[k] = h[k]; done[k] = 1; push(k, f[k]); }
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    while (hn) {
      const k = pop(), i = k % N, j = (k - i) / N;
      for (let q = 0; q < 8; q++) {
        const ii = i + DI[q], jj = j + DJ[q];
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const kk = jj * N + ii; if (done[kk]) continue;
        done[kk] = 1; f[kk] = Math.max(h[kk], f[k] + 1e-4); push(kk, f[kk]);
      }
    }
    // 流れる先（いちばん急に下るとなり）
    const to = new Int32Array(M).fill(-1);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i; let best = 0;
      for (let q = 0; q < 8; q++) { const kk = (j + DJ[q]) * N + i + DI[q], sl = (f[k] - f[kk]) / (q < 4 ? 1 : 1.4142); if (sl > best) { best = sl; to[k] = kk; } }
    }
    // 低い順に、流れ出る出口（模型のはし）の番号をつける＝同じ番号が同じ流域
    const order = Array.from({ length: M }, (_, k) => k).sort((a, b) => f[a] - f[b]);
    const lab = new Int32Array(M), acc = new Float32Array(M);
    for (const k of order) lab[k] = to[k] < 0 ? k : lab[to[k]];
    for (let o = M - 1; o >= 0; o--) { const k = order[o]; acc[k] += 1; if (to[k] >= 0) acc[to[k]] += acc[k]; }
    // 大きい流域だけ色をつける（小さいものは、模型のはしの斜面など）
    const area = new Map(); for (let k = 0; k < M; k++) area.set(lab[k], (area.get(lab[k]) || 0) + 1);
    const big = Array.from(area.entries()).filter(([, a]) => a >= M * 0.03).sort((a, b) => b[1] - a[1]).slice(0, 7);
    const color = new Map(big.map(([l], idx) => [l, idx]));
    // 学校（まん中）にふった雨の通り道
    const c0 = Math.round((N - 1) / 2), path = [];
    for (let k = c0 * N + c0, guard = 0; k >= 0 && guard < M; k = to[k], guard++) path.push(k);
    S.basin = { site: S.site.id, half: S.site.half, N, lab, acc, color, big, path, M };
    return S.basin;
  }
  const BASIN_COLORS = ["#e4572e", "#2e86ab", "#76b041", "#f1a208", "#9b5de5", "#00a6a6", "#d81159"];
  function drawBasinOnMap(ctx, W, H) {
    const b = computeBasins(), N = b.N, size = 1024;
    if (!b.cv) {
      const cv = document.createElement("canvas"); cv.width = cv.height = size;
      const c = cv.getContext("2d"), img = c.createImageData(size, size);
      const cell = (x, y) => Math.min(N - 1, Math.round((y / (size - 1)) * (N - 1))) * N + Math.min(N - 1, Math.round((x / (size - 1)) * (N - 1)));
      const rgb = BASIN_COLORS.map((hx) => [1, 3, 5].map((p) => parseInt(hx.substr(p, 2), 16)));
      const streamMin = b.M * 0.008;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const k = cell(x, y), ci = b.color.get(b.lab[k]), o = (y * size + x) * 4;
        let r = 0, gg = 0, bb = 0, a = 0;
        if (ci != null) { [r, gg, bb] = rgb[ci]; a = 70; }
        // 分水界：となりと流域がちがう所（色のついた流域どうしの境目）
        const kr = cell(Math.min(size - 1, x + 2), y), kd = cell(x, Math.min(size - 1, y + 2));
        if (ci != null && (b.lab[kr] !== b.lab[k] && b.color.has(b.lab[kr]) || b.lab[kd] !== b.lab[k] && b.color.has(b.lab[kd]))) { r = 60; gg = 20; bb = 10; a = 235; }
        // 水が集まって流れる道
        else if (b.acc[k] > streamMin) { r = 20; gg = 90; bb = 230; a = 200; }
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = a;
      }
      c.putImageData(img, 0, 0);
      b.cv = cv;
    }
    ctx.drawImage(b.cv, 0, 0, W, H);
    // 学校にふった雨の通り道（太い矢印の線）
    const px = (k) => { const i = k % N, j = (k - i) / N; return [(i / (N - 1)) * W, (j / (N - 1)) * H]; };
    if (b.path.length > 1) {
      ctx.save(); ctx.lineJoin = ctx.lineCap = "round";
      const lw = Math.max(4, W / 250);
      ctx.beginPath(); b.path.forEach((k, n) => { const [x, y] = px(k); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = "#fff"; ctx.lineWidth = lw * 2; ctx.stroke();
      ctx.strokeStyle = "#0b3d91"; ctx.lineWidth = lw; ctx.stroke();
      // 矢じるし
      for (let n = 8; n < b.path.length; n += 16) {
        const [x0, y0] = px(b.path[n - 4]), [x1, y1] = px(b.path[n]), ang = Math.atan2(y1 - y0, x1 - x0), L = lw * 3.2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - L * Math.cos(ang - 0.5), y1 - L * Math.sin(ang - 0.5)); ctx.lineTo(x1 - L * Math.cos(ang + 0.5), y1 - L * Math.sin(ang + 0.5)); ctx.closePath();
        ctx.fillStyle = "#0b3d91"; ctx.fill();
      }
      const [sx, sy] = px(b.path[0]);
      ctx.beginPath(); ctx.arc(sx, sy, lw * 2.2, 0, Math.PI * 2); ctx.fillStyle = "#0b3d91"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = lw * 0.6; ctx.stroke();
      ctx.restore();
    }
  }
  function basinCard(on) {
    if (!on) return showCard("basinCard", false);
    const b = computeBasins(), el = fcard("basinCard", "💧 流域（雨水の行き先）");
    const end = b.path[b.path.length - 1], N = b.N, i = end % N, j = (end - i) / N;
    const dx = i / (N - 1) - 0.5, dz = j / (N - 1) - 0.5;
    const dirs = ["東", "南東", "南", "南西", "西", "北西", "北", "北東"];
    const dir = dirs[(Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) + 8) % 8];
    const km = (b.path.length * (2 * S.site.half) / (N - 1) / 1000).toFixed(1);
    el.querySelector(".fc-body").innerHTML =
      '<p><b>流域</b>：雨がふったとき、同じ川に集まってくる範囲。<b>同じ色の所にふった雨は、同じ出口へ流れていきます。</b></p>' +
      '<ul class="geo-list"><li><i style="background:#3c140a"></i><span><b>こい線＝分水界</b>（水の流れる向きが分かれる、尾根のような所）</span></li>' +
      '<li><i style="background:#145ae6"></i><span>青い線＝水が集まって流れる道（谷）</span></li>' +
      '<li><i style="background:#0b3d91;border-radius:50%"></i><span>太い矢印＝<b>学校にふった雨の通り道</b>。約' + km + 'km流れて、模型の<b>' + dir + '</b>のはしから出ていきます</span></li></ul>' +
      '<p class="hint">※ 模型の標高から計算した、おおよその流れです。下水道や水路は入っていません。模型の外の流れはわかりません。</p>';
    showCard("basinCard", true);
  }

  /** 折れ線を、切れ目のない1本の帯（三角形のならび）にする。pts:[{x,y,z}] */
  function stripInto(arr, pts, hw, dy) {
    const n = pts.length;
    if (n < 2) return;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const p = pts[i];
      L.push([p.x - dz * hw, p.y + dy, p.z + dx * hw]); R.push([p.x + dz * hw, p.y + dy, p.z - dx * hw]);
    }
    for (let i = 0; i < n - 1; i++) for (const v of [L[i], L[i + 1], R[i + 1], L[i], R[i + 1], R[i]]) arr.push(...v);
  }
  /** 川・谷戸を、地図の画像に直接かく（地形にぴったり沿った、切れ目のない1本の線になる） */
  function drawLinesOnMap(ctx, W, H) {
    const half = S.site.half, sx = W / (2 * half), sy = H / (2 * half);
    const path = (pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => { const x = (p.x + half) * sx, y = (p.z + half) * sy; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    };
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const px = (m) => Math.max(2, m * sx); // m（メートル）→ 画像の点の数
    const wR = Math.max(10, half * 0.012), wY = Math.max(8, half * 0.009);
    const strokeAll = (list, w, color) => {
      // まず白いふちを全部、そのあと色の線を全部（つなぎ目に白が出ないように）
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      for (const l of list) { ctx.lineWidth = px(w * (l.major === false ? 0.5 : 1)) + px(w * 0.5); path(l.pts); ctx.stroke(); }
      ctx.strokeStyle = color;
      for (const l of list) { ctx.lineWidth = px(w * (l.major === false ? 0.5 : 1)); path(l.pts); ctx.stroke(); }
    };
    if (S.showYato) strokeAll([].concat(...yatoList().map((y) => y.lines.map((pts) => ({ pts })))), wY, "#14b8a6");
    if (S.showRivers && S.rivers) strokeAll(S.rivers, wR, "#1565ff");
  }
  function setRelief(mode) {
    S.relief = mode;
    $("reliefSelect").value = mode;
    if (mode === "shade") { ambient.intensity = 0.3; sun.intensity = 0.95; sun.position.set(-1, 0.55, -0.6); }
    else { ambient.intensity = 0.58; sun.intensity = 0.55; sun.position.set(-0.6, 1, 0.45); }
    applyTexture();
    buildAll();
    updateReliefLegend();
  }
  function updateReliefLegend() {
    const box = $("reliefLegend");
    const m = S.relief;
    if (!["color", "contour", "terrace"].includes(m)) { box.classList.add("hidden"); return; }
    const { st, lo, hi } = bandRange();
    const closed = store.get("chisou3d:rlClosed", false);
    box.classList.toggle("closed", closed);
    let html = '<button type="button" class="rl-toggle" id="rlToggle">' + (closed ? "🎨 標高の色 ▸" : "✕ 閉じる") + '</button><div class="rl-title">標高（海面からの高さ）</div>';
    if (m === "contour") {
      html += '<div class="rl-note">細い線：' + st + "mごと<br>太い線：" + st * 2 + "mごと<br>線と線の間が<b>せまい所ほど急な坂</b></div>";
    } else {
      html += '<div class="rl-bar">';
      for (let v = hi - st; v >= lo; v -= st) {
        const c = colorRamp(m === "terrace" ? (v + st / 2 - lo) / (hi - lo) : (v + st / 2 - lo) / (hi - lo));
        html += '<div class="rl-row"><span class="rl-sw" style="background:rgb(' + c.join(",") + ')"></span><span>' + v + "〜" + (v + st) + "m</span></div>";
      }
      html += "</div>";
      if (m === "terrace") html += '<div class="rl-note">1段 = ' + st + "m</div>";
    }
    box.innerHTML = html;
    box.classList.remove("hidden");
    $("rlToggle").onclick = () => { store.set("chisou3d:rlClosed", !store.get("chisou3d:rlClosed", false)); updateReliefLegend(); };
  }

  function localReliefCanvas() {
    const size = 512, cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(size, size);
    const lo = S.stats.p02, hi = S.stats.p98, half = S.site.half;
    const stops = [[0, [49, 110, 170]], [0.2, [90, 175, 190]], [0.4, [140, 200, 120]], [0.6, [230, 220, 110]], [0.8, [220, 150, 80]], [1, [170, 90, 60]]];
    const ramp = (t) => {
      t = Math.min(1, Math.max(0, t));
      for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (t - t0) / (t1 - t0);
        return c0.map((v, k) => v + (c1[k] - v) * f);
      }
      return stops[stops.length - 1][1];
    };
    const d = (2 * half) / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const wx = -half + (x + 0.5) * d, wz = -half + (y + 0.5) * d;
      const h = groundAt(wx, wz);
      const dx = groundAt(Math.min(half, wx + d), wz) - groundAt(Math.max(-half, wx - d), wz);
      const dz = groundAt(wx, Math.min(half, wz + d)) - groundAt(wx, Math.max(-half, wz - d));
      const shade = Math.max(0.55, Math.min(1.2, 1 + (-dx * 0.7 - dz * 0.7) / (2 * d) * 0.8));
      const c = ramp((h - lo) / (hi - lo));
      const k = (y * size + x) * 4;
      img.data[k] = c[0] * shade; img.data[k + 1] = c[1] * shade; img.data[k + 2] = c[2] * shade; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // 等高線 5mごと
    ctx.strokeStyle = "rgba(60,40,20,0.35)";
    ctx.lineWidth = 1;
    const step = 5;
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const wx = -half + (x + 0.5) * d, wz = -half + (y + 0.5) * d;
      const a = Math.floor(groundAt(wx, wz) / step), b = Math.floor(groundAt(wx + d, wz) / step), c = Math.floor(groundAt(wx, wz + d) / step);
      if (a !== b || a !== c) ctx.fillRect(x, y, 1, 1);
    }
    return cv;
  }

  // ---------- マウスをのせた所の標高 ----------
  function bindHoverElevation() {
    const el = renderer.domElement, box = $("elevTip");
    let pending = null;
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || e.buttons) { box.classList.add("hidden"); return; }
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        rayFrom(e);
        const p = pickGround();
        if (!p) { box.classList.add("hidden"); return; }
        const h = groundAt(p.x, p.z);
        box.textContent = "地面の標高 約" + Math.round(h) + "m";
        box.style.left = e.clientX + 16 + "px";
        box.style.top = e.clientY + 14 + "px";
        box.classList.remove("hidden");
      });
    });
    el.addEventListener("pointerleave", () => box.classList.add("hidden"));
    el.addEventListener("pointerdown", () => box.classList.add("hidden"));
  }

  // ---------- タップ（クリック）の処理 ----------
  function bindTap() {
    const el = renderer.domElement;
    let down = null;
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    el.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = Date.now() - down.t < 600;
      down = null;
      if (moved < 8 && quick) handleTap(e);
    });
  }
  const raycaster = new THREE.Raycaster();
  function rayFrom(e) {
    const r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(v, camera);
  }
  function shown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
  function clippedAway(pt) { return S.clipPlanes.some((pl) => pl.distanceToPoint(pt) < -1); }
  function pickObject() {
    const hits = raycaster.intersectObjects([groups.section, groups.bores, groups.notes, groups.yato, groups.lore], true);
    for (const h of hits) {
      const onCut = h.object.userData.pick && h.object.userData.pick.type === "cutbore"; // 切り口の上の柱は、切られない
      if (!shown(h.object) || (!onCut && clippedAway(h.point))) continue;
      for (let o = h.object; o; o = o.parent) if (o.userData.pick) return o.userData.pick;
    }
    return null;
  }
  function pickGround() {
    const hits = raycaster.intersectObject(terrain, false);
    for (const h of hits) if (!clippedAway(h.point)) return { x: h.point.x, z: h.point.z };
    return null;
  }
  function handleTap(e) {
    rayFrom(e);
    const obj = pickObject();
    if (obj && obj.type === "lore") return showLore(obj.id);
    if (S.digOn && (S.mode === "view" || S.mode === "dig") && !(obj && obj.type === "bore")) { const p = pickGround(); if (p) digAt(p); return; }
    if (obj && obj.type === "cutbore") return showBore(obj.id); // 切り口の本物の柱 → くわしい柱状図
    if (obj && obj.type === "bore" && S.mode === "cut") return showBore(obj.id);
    if (S.mode === "view") {
      if (obj && obj.type === "bore") showBore(obj.id);
      else if (obj && obj.type === "note") showNote(obj.id);
      else if (obj && obj.type === "yato") showYato(obj.id);
      return;
    }
    if (S.mode === "cut") {
      if (S.section) return; // 切ったあとは「✂️ 切り直す」から
      const p = pickGround();
      if (!p) return;
      // タップした所を通るように、赤い線を動かす（向きはそのまま）
      const g = S.cutGuide, nx = -Math.sin(g.ang), nz = Math.cos(g.ang);
      g.off = p.x * nx + p.z * nz;
      syncCutGuideUI(); buildCutGuide();
      return;
    }
    if (S.mode === "pick") {
      if (!obj || obj.type !== "bore") { flashHint("📍 ボーリングの旗（🔍の名前や●）をタップしてえらんでね"); return; }
      const i = S.pickIds.indexOf(obj.id);
      if (i >= 0) S.pickIds.splice(i, 1); // もう一度タップで取り消し
      else if (S.pickIds.length >= 8) { flashHint("えらべるのは8本までです"); return; }
      else S.pickIds.push(obj.id);
      updatePickBar();
      return;
    }
    if (S.mode === "section") {
      let p = null;
      if (obj && obj.type === "bore") { const b = S.bores.find((x) => x.id === obj.id); if (b) p = { x: b.x, z: b.z, boreId: b.id }; }
      if (!p) p = pickGround();
      if (!p) return;
      const pts = S.sectionPts;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 20) { flashHint("もう少しはなれた所をタップしてください"); return; }
      if (pts.length >= 8) { flashHint("点は8つまでです。「線を引き直す」で最初からやり直せます"); return; }
      pts.push(p);
      if (pts.length === 1) {
        updateMarkers();
        setHint("✂️ 2つ目の点をタップ（旗をタップすると、そのボーリングを通ります）");
      } else {
        makeSection(pts.slice());
      }
      return;
    }
    if (S.mode === "note") {
      if (obj && obj.type === "note") return showNote(obj.id);
      const p = pickGround();
      if (p) openNoteDialog(p);
      return;
    }
    if (S.mode === "edit") {
      if (obj && obj.type === "bore") return openBoreDialog(S.bores.find((b) => b.id === obj.id));
      const p = pickGround();
      if (p) { const ll = S.frame.toLatLon(p.x, p.z); openBoreDialog(null, ll); }
    }
  }

  // ---------- 断面 ----------
  const LETTERS = "ABCDEFGH";
  /** pts: タップした点（2つ以上）。2点ならまっすぐ模型のはしまで、3点以上ならその点を順につなぐ折れ線 */
  function makeSection(pts, keepView) {
    const half = S.site.half;
    let path = pts;
    if (pts.length === 2) {
      // 線を模型のはしまでのばす
      const [a, b] = pts;
      const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      let t0 = -Infinity, t1 = Infinity;
      for (const [p, u] of [[a.x, ux], [a.z, uz]]) {
        if (Math.abs(u) < 1e-9) continue;
        const ta = (-half - p) / u, tb = (half - p) / u;
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      t0 += 0.5; t1 -= 0.5;
      path = [{ x: a.x + ux * t0, z: a.z + uz * t0 }, { x: a.x + ux * t1, z: a.z + uz * t1 }];
    }
    const segs = [];
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i], q = path[i + 1], len = Math.hypot(q.x - p.x, q.z - p.z);
      segs.push({ x: p.x, z: p.z, ux: (q.x - p.x) / len, uz: (q.z - p.z) / len, len, d0: total });
      total += len;
    }
    const M = 300, samples = [];
    for (let i = 0; i <= M; i++) {
      const d = (total * i) / M;
      const sg = segs.find((g) => d <= g.d0 + g.len + 1e-6) || segs[segs.length - 1];
      const t = d - sg.d0, x = sg.x + sg.ux * t, z = sg.z + sg.uz * t;
      const sm = GL.sampleModel(S.model, x, z);
      samples.push({ d, x, z, g: sm.g, tops: sm.tops, bots: sm.bots, rawB: sm.rawB, eros: sm.eros });
    }
    const first = path[0], lastP = path[path.length - 1];
    const ol = Math.hypot(lastP.x - first.x, lastP.z - first.z) || 1;
    if (!keepView) S.sectionFlip = false;
    S.section = { pts, segs, length: total, samples, straight: pts.length === 2,
      start: first, ux: (lastP.x - first.x) / ol, uz: (lastP.z - first.z) / ol };
    buildSectionRibbon();
    applySectionClip();
    buildPeelChecks();
    if (!S.section.straight && S.opacity > 0.45 && S.savedOpacity == null) {
      // 折れ線では模型を切れないので、地面をすきとおらせて断面を見せる
      S.savedOpacity = S.opacity;
      setOpacity(0.35);
    }
    if (!keepView) {
      // 断面を作る前に見ていた位置を覚えておく（断面を消したら、そこにもどす）
      if (!S.preSectionView) S.preSectionView = { pos: camera.position.clone(), target: controls.target.clone() };
      // 断面が正面に見えるようにカメラを動かす
      const mid = samples[Math.floor(M / 2)];
      const avg = samples.reduce((s2, p) => s2 + p.g, 0) / samples.length;
      const sec = S.section, sgn = S.sectionFlip ? -1 : 1;
      const nx = sec.uz * sgn, nz = -sec.ux * sgn;
      const span = Math.max(ol, total * 0.6) * (sec.straight ? 1 : 1.35);
      const t = new THREE.Vector3(mid.x, avg * S.ve * 0.85, mid.z);
      controls.target.copy(t);
      camera.position.set(t.x - nx * span * 0.95, t.y + span * 0.3, t.z - nz * span * 0.95);
    }
    updateMarkers();
    if (S.mode === "cut") {
      $("cutBar").classList.remove("hidden");
      $("cutGuideBar").classList.add("hidden");
      disposeGroup(groups.guide);
      setHint("");
      return;
    }
    openSectionSheet();
    setHint(pts.length < 8 ? "✂️ 続けてタップすると線をのばせます（3本以上のボーリングをつなげられます）" : "");
  }

  /** 断面の線に(x,z)を投影：{d:線にそった距離, off:線からのはなれ} */
  function projectOnSection(x, z, sec) {
    let best = null;
    for (const g of (sec || S.section).segs) {
      const rx = x - g.x, rz = z - g.z;
      const t = Math.max(0, Math.min(g.len, rx * g.ux + rz * g.uz));
      const off = Math.hypot(rx - g.ux * t, rz - g.uz * t);
      if (!best || off < best.off) best = { d: g.d0 + t, off, t, len: g.len };
    }
    return best;
  }

  function buildSectionRibbon() {
    disposeGroup(groups.section);
    if (!S.section) return;
    groups.section.add(wallMesh(S.section.samples));
    for (const m of groups.section.children[0].children.map((c) => c.material)) { m.clippingPlanes = []; clipMats.delete(m); m.needsUpdate = true; }
    if (S.cutNoData) groups.section.add(noDataOverlay(S.section));
    if (S.cutReal) groups.section.add(realBoresOnCut(S.section));
  }
  const noClip = (m) => { m.clippingPlanes = []; return m; };
  /** 切り口の面より少しだけ手前（切り落とした側）にずらす量。まっすぐの断面のときだけ */
  function cutOffset(sec, dist) {
    if (!sec.straight) return { x: 0, z: 0 };
    const sgn = S.sectionFlip ? -1 : 1;
    return { x: -sec.uz * sgn * dist, z: sec.ux * sgn * dist };
  }
  /** 切り口のうち、近くのボーリングが届いていない深さ（資料がない所）を灰色でおおう */
  function noDataOverlay(sec) {
    const ve = S.ve, R = Math.max(200, S.site.half * 0.2), base = S.model.base;
    const floorAt = (p) => {
      let f = Infinity;
      for (const b of S.bores) if (!isNaN(b.elev) && Math.hypot(b.x - p.x, b.z - p.z) < R) f = Math.min(f, b.elev - b.depth);
      return isFinite(f) ? Math.min(f, p.g) : p.g; // 近くに柱がなければ、地面から下は全部「資料なし」
    };
    const sm = sec.samples, fl = sm.map(floorAt), o = cutOffset(sec, 1.5);
    const pos = [];
    for (let i = 0; i < sm.length - 1; i++) {
      const a = sm[i], b = sm[i + 1], fa = fl[i], fb = fl[i + 1];
      if (fa <= base + 0.01 && fb <= base + 0.01) continue;
      const v = [[a.x, fa, a.z], [b.x, fb, b.z], [b.x, base, b.z], [a.x, base, a.z]];
      for (const t of [0, 1, 2, 0, 2, 3]) pos.push(v[t][0] + o.x, v[t][1] * ve, v[t][2] + o.z);
    }
    const grp = new THREE.Group();
    if (!pos.length) return grp;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mat = noClip(new THREE.MeshBasicMaterial({ color: 0xdfe4e8, transparent: true, opacity: 0.88, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 5;
    grp.add(mesh);
    // 説明の文字：灰色がいちばん広い所に
    let bi = 0, bh = -1;
    fl.forEach((f, i) => { if (f - base > bh) { bh = f - base; bi = i; } });
    if (bh > 3) {
      const p = sm[bi];
      const lab = makeLabel("ここから下は ボーリングの資料がありません\n（模型の地層は 仮においたもの）", { bg: "rgba(255,255,255,0.92)", color: "#5a6873", size: 13 });
      noClip(lab.material);
      lab.position.set(p.x + o.x * 3, ((fl[bi] + base) / 2) * ve, p.z + o.z * 3);
      grp.add(lab);
    }
    return grp;
  }
  /** 切り口の近くの本物の柱状図を、切り口の面の上にうつしてかく（推定ではない所がわかるように） */
  function realBoresOnCut(sec) {
    const ve = S.ve, near = Math.max(60, S.site.half * 0.08), w = Math.max(10, S.site.half * 0.014);
    const grp = new THREE.Group();
    const pos = [], col = [], lines = [];
    const c = new THREE.Color();
    const placed = [], o = cutOffset(sec, 3);
    let labels = 0;
    const list = S.bores.map((b) => ({ b, p: projectOnSection(b.x, b.z, sec) }))
      .filter(({ b, p }) => !isNaN(b.elev) && p.off <= near && !(sec.straight && (p.t <= 0 || p.t >= p.len)))
      .sort((x, y) => x.p.off - y.p.off);
    for (const { b, p } of list) {
      if (placed.some((d) => Math.abs(d - p.d) < w * 1.6)) continue; // 重なる柱は、線に近い方だけ
      placed.push(p.d);
      const sg = sec.segs.find((g) => p.d <= g.d0 + g.len + 1e-6) || sec.segs[sec.segs.length - 1];
      const t = p.d - sg.d0, x = sg.x + sg.ux * t + o.x, z = sg.z + sg.uz * t + o.z;
      const ex = sg.ux * w / 2, ez = sg.uz * w / 2;
      const bp = [], bc = [];
      for (const s2 of b.segs) {
        const top = (b.elev - s2.from) * ve, bot = (b.elev - s2.to) * ve;
        c.set(segColor(s2));
        const v = [[x - ex, top, z - ez], [x + ex, top, z + ez], [x + ex, bot, z + ez], [x - ex, bot, z - ez]];
        for (const k of [0, 1, 2, 0, 2, 3]) { bp.push(...v[k]); bc.push(c.r, c.g, c.b); }
        lines.push(x - ex, bot, z - ez, x + ex, bot, z + ez);
      }
      // 柱ごとに1つの形にして、さわると くわしい柱状図が出るように
      const g1 = new THREE.BufferGeometry();
      g1.setAttribute("position", new THREE.Float32BufferAttribute(bp, 3));
      g1.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
      const m1 = new THREE.Mesh(g1, noClip(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 })));
      m1.renderOrder = 6;
      m1.userData.pick = { type: "cutbore", id: b.id };
      grp.add(m1);
      const top = b.elev * ve, bot = (b.elev - b.depth) * ve;
      lines.push(x - ex, top, z - ez, x - ex, bot, z - ez, x + ex, top, z + ez, x + ex, bot, z + ez, x - ex, top, z - ez, x + ex, top, z + ez);
      if (labels++ < 6) { // 名札は、線に近い6本だけ（多いと読めないので）
        const lab = makeLabel("✔本物（線から" + Math.round(p.off) + "m）", { bg: "#1f5f99", color: "#fff", size: 11, bold: true });
        noClip(lab.material);
        lab.position.set(x, bot - 4, z);
        lab.center.set(0.5, 1.15);
        lab.userData.pick = { type: "cutbore", id: b.id };
        grp.add(lab);
      }
    }
    if (lines.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
      const ln = new THREE.LineSegments(lg, noClip(new THREE.LineBasicMaterial({ color: 0x0b2a44 })));
      ln.renderOrder = 7;
      grp.add(ln);
    }
    // 「推定」の表示
    const mid = sec.samples[Math.floor(sec.samples.length / 2)];
    let top = -Infinity; for (const smp of sec.samples) top = Math.max(top, smp.g);
    const note = makeLabel("⚠ 切り口の地層は、ボーリングの柱から推定したもの\n本当に分かっているのは「本物の柱」の所だけ", { bg: "#fff4d6", color: "#6b4a00", border: "#d4a017", size: 14, bold: true });
    noClip(note.material);
    note.position.set(mid.x, top * ve + 70, mid.z);
    grp.add(note);
    return grp;
  }

  function applySectionClip() {
    if (!S.section || !S.section.straight) return setClip([]);
    const sec = S.section, sgn = S.sectionFlip ? -1 : 1;
    // カメラを「切り落とした側」に置くと、Aが左・Bが右に見える向き
    const nrm = new THREE.Vector3(sec.uz * sgn, 0, -sec.ux * sgn);
    const plane = new THREE.Plane(nrm, -(nrm.x * sec.start.x + nrm.z * sec.start.z));
    setClip([plane]);
  }

  /** 「柱をえらんで断面」：えらんだ柱に A・B・C… のしるしをつけ、下のバーを更新 */
  function updatePickBar() {
    const bs = S.pickIds.map((id) => S.bores.find((b) => b.id === id)).filter(Boolean);
    S.sectionPts = bs.map((b) => ({ x: b.x, z: b.z, boreId: b.id }));
    updateMarkers();
    $("pickInfo").textContent = bs.length ? "📍 えらんだ柱：" + bs.length + "本（" + bs.map((b, i) => LETTERS[i]).join("→") + "）" + (bs.length < 2 ? "　あと1本以上えらんでね" : "")
      : "📍 断面に使う柱の旗を、つなぎたい順にタップ";
    $("pickOk").disabled = bs.length < 2;
    $("pickUndo").disabled = $("pickClear").disabled = !bs.length;
  }
  function clearSection() {
    $("cutBar").classList.add("hidden");
    if (S.preSectionView) {
      // 断面を作る前に見ていた位置へ、なめらかにもどす
      const v = S.preSectionView, p0 = camera.position.clone(), t0 = controls.target.clone(), t1 = performance.now();
      S.preSectionView = null;
      const step = () => {
        const k = Math.min(1, (performance.now() - t1) / 600), e = k * k * (3 - 2 * k);
        camera.position.lerpVectors(p0, v.pos, e);
        controls.target.lerpVectors(t0, v.target, e);
        controls.update();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    S.section = null;
    S.sectionPts = [];
    if (S.savedOpacity != null) { setOpacity(S.savedOpacity); S.savedOpacity = null; }
    disposeGroup(groups.section);
    setClip([]);
    updateMarkers();
    closeSectionSheet();
    buildPeelChecks();
  }

  function updateMarkers() {
    disposeGroup(groups.markers);
    const pts = [];
    S.sectionPts.forEach((p, i) => pts.push([LETTERS[i], p]));
    for (const [name, p] of pts) {
      const y = surfaceAt(p.x, p.z) * S.ve;
      const lab = makeLabel(name, { bg: "#d0342c", color: "#fff", bold: true, size: 16 });
      lab.material.clippingPlanes = [];
      lab.position.set(p.x, y + 15, p.z);
      groups.markers.add(lab);
    }
  }

  // 断面図（2D）
  let secView = null;
  function sectionKey() {
    return S.section.pts.map((p) => Math.round(p.x) + "," + Math.round(p.z)).join(";") + (isAB() ? "|ab" : "");
  }
  /** 断面図に出す範囲が「A〜Bだけ」か（2点で切ったときだけ選べる。はじめはA〜Bだけ） */
  function isAB() { return S.section && S.section.straight && S.secExtent !== "full"; }
  /** 断面図（2D）に使う断面：A〜Bだけのときは、その区間で細かく取り直す */
  function viewSection() {
    const sec = S.section;
    if (!isAB()) return sec;
    const [a, b] = sec.pts, len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const M = 300, samples = [];
    for (let i = 0; i <= M; i++) {
      const d = (len * i) / M, x = a.x + ux * d, z = a.z + uz * d;
      const sm = GL.sampleModel(S.model, x, z);
      samples.push({ d, x, z, g: sm.g, tops: sm.tops, bots: sm.bots, rawB: sm.rawB, eros: sm.eros });
    }
    return { pts: sec.pts, segs: [{ x: a.x, z: a.z, ux, uz, len, d0: 0 }], length: len, samples, straight: true, start: a, ux, uz };
  }
  function openSectionSheet() {
    if (S.mode === "cut") return; // 「模型を切る」では断面図（2D）は出さない
    const sec = viewSection(), site = S.site;
    $("secExtentBox").classList.toggle("hidden", !S.section.straight);
    document.querySelectorAll("#secExtentBox button").forEach((b) => b.classList.toggle("on", (b.dataset.ext === "full") === !isAB()));
    const near = Math.max(80, site.half * 0.12);
    const byId = {};
    site.layers.forEach((l) => (byId[l.id] = l));
    const project = (x, z) => {
      const p = projectOnSection(x, z, sec);
      const bad = sec.straight && (p.t <= 0 || p.t >= p.len); // まっすぐの時は、はしより外は入れない
      return bad ? { d: p.d, off: Infinity } : p;
    };
    const bores = [];
    for (const b of S.bores) {
      const p = project(b.x, b.z);
      if (p.off > near || isNaN(b.elev)) continue;
      bores.push({ id: b.id, d: p.d, off: p.off, elev: b.elev, depth: b.depth, name: b.name, sample: b.sample, hidden: S.hiddenBores.has(b.id), mark: S.boreMarks[b.id] || null,
        // ボーリングは「わかっている事実」なので、地層をかくしている時も本当の色で
        segs: b.segs.map((s) => ({ from: s.from, to: s.to, color: segColor(s), name: segName(s) })) });
    }
    // 近すぎる柱が重なって読めないので、代表（線に近く・深いもの）を選ぶ。最大12本
    const gap = Math.max(40, sec.length / 30);
    const picked = [];
    // 点数：線に近いほど・深く掘っているほど良い（かくしている柱は必ず残す）
    // えらんで断面を作った柱（A・B・C…）は、かならず入れる
    const chosen = new Set((S.section.pts || []).map((p) => p.boreId).filter(Boolean));
    const onlyChosen = chosen.size >= 2 && !S.secShowOthers; // はじめは、えらんだ柱状図だけ
    const score = (b) => (chosen.has(b.id) ? -1e10 : 0) + (S.hiddenBores.has(b.id) ? -1e9 : 0) + (b.mark ? -1e8 : 0) + b.off / near - b.depth / 30;
    for (const b of bores.slice().sort((a, b) => score(a) - score(b))) {
      if (onlyChosen && !chosen.has(b.id)) continue;
      if (chosen.has(b.id)) { picked.push(Object.assign(b, { chosen: true })); continue; }
      if (picked.length >= 12) break;
      if (!picked.some((p) => Math.abs(p.d - b.d) < gap)) picked.push(b);
    }
    $("secOnlyChosenBox").classList.toggle("hidden", chosen.size < 2);
    $("secOnlyChosen").checked = !!S.secShowOthers;
    bores.length = 0;
    bores.push(...picked.sort((a, b) => a.d - b.d));
    S.sectionBores = bores;
    buildBoreChips();
    const landmarks = [];
    if (S.autoMarksOn) for (const m of visibleAutoMarks()) {
      const p = project(m.x, m.z);
      if (p.off <= near * 0.6) landmarks.push({ d: p.d, g: groundAt(m.x, m.z), name: m.name, icon: m.icon });
    }
    for (const lm of site.landmarks || []) {
      const l = S.frame.toLocal(lm.lat, lm.lon), p = project(l.x, l.z);
      if (p.off > near) continue;
      landmarks.push({ d: p.d, g: groundAt(l.x, l.z), name: lm.name, icon: lm.icon });
    }
    const dirName = (ux, uz) => {
      const ang = (Math.atan2(ux, -uz) * 180) / Math.PI; // 北=0, 東=90
      const names = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
      return names[((Math.round(ang / 45) % 8) + 8) % 8];
    };
    const data = {
      samples: sec.samples, length: sec.length, base: S.model.base, bores, landmarks,
      layers: site.layers.map((l, i) => Object.assign({}, l, { color: strataColor(i) })),
      ends: [dirName(-sec.segs[0].ux, -sec.segs[0].uz) + "（A側）",
        dirName(sec.segs[sec.segs.length - 1].ux, sec.segs[sec.segs.length - 1].uz) + "（" + LETTERS[sec.pts.length - 1] + "側）"],
      vertices: sec.pts.map((p, i) => ({ d: projectOnSection(p.x, p.z, sec).d, label: LETTERS[i] })),
      rivers: riverCrossings(sec),
      yato: yatoCrossings(sec),
      surfIdx: S.model.surfIdx,
    };
    buildSecLegend();
    document.body.classList.add("sheet-open");
    $("sectionSheet").classList.remove("hidden");
    if (!secView) {
      secView = new C.SectionView($("secCanvas"), {
        site: S.site,
        onBore: (id) => showBore(id), // 断面図の柱をさわると、くわしい柱状図
        onVolcano: (v) => volcanoBox(v),
        onStageText: (st) => {
          const el = $("secStageText");
          if (!st) { el.classList.add("hidden"); return; }
          const html = (st.age ? '<div class="st-age">⏳ ' + esc(st.age) + "</div>" : "") + '<div class="st-text">' + esc(st.text) + '</div><div class="st-note">※ボーリング資料から推定した、おおまかな順番です。年代は横浜のあたりの目安</div>';
          if (el.dataset.k !== st.text) { el.innerHTML = html; el.dataset.k = st.text; }
          el.classList.remove("hidden");
        },
        onLayout: (L) => {
          // たてがはみ出しているときだけ「上下」のスライダーを出す
          if (secView._vclip !== L.vclip) { secView._vclip = L.vclip; $("secVPanBox").classList.toggle("hidden", !L.vclip); }
        },
        onYear: (txt) => { const el = $("secYear"); if (el && el.textContent !== "⏳ " + txt) el.textContent = "⏳ " + txt; },
        onChange: (strokes) => {
          const all = store.get(key("sections"), {});
          all[sectionKey()] = strokes;
          store.set(key("sections"), all);
        },
      });
      buildPens();
      S.applySecVe();
    }
    secView.reversed = S.sectionFlip;
    secView.showBores = $("secShowBores").checked;
    secView.showModel = $("secShowModel").checked && !S.hideStrata;
    secView.connect = $("secConnect").checked;
    secView.showNames = $("secNames").checked;
    secView.vshift = 0; secView.vpan = 0; $("secVPan").value = 0;
    $("secInfo").textContent = "（" + sec.pts.map((p, i) => LETTERS[i]).join("→") + "・長さ約" + Math.round(sec.length) + "m）";
    const saved = store.get(key("sections"), {})[sectionKey()] || [];
    secView.stage = 0;
    $("secStage").classList.remove("on"); $("secStagePrev").classList.add("hidden"); $("secStageNext").classList.add("hidden");
    $("secTimeline").classList.add("hidden"); if (S.stageLayout) S.stageLayout(false);
    loadMemo();
    secView.pan = 0.5; $("secPan").value = 500;
    requestAnimationFrame(() => { secView.setData(data, saved); if (S.applySecZoom) S.applySecZoom(); });
    updateViewOffset();
  }
  /** 考えメモの保存（断面ごと・この端末） */
  function saveMemo() {
    if (!S.section) return;
    const all = store.get(key("memos"), {});
    all[sectionKey()] = { name: $("memoName").value, predict: $("memoPredict").value, result: $("memoResult").value };
    store.set(key("memos"), all);
    store.set("chisou3d:author", $("memoName").value);
  }
  function loadMemo() {
    const m = store.get(key("memos"), {})[sectionKey()] || {};
    $("memoName").value = m.name || store.get("chisou3d:author", "");
    $("memoPredict").value = m.predict || "";
    $("memoResult").value = m.result || "";
  }
  /** 断面図の画像（考えメモつき）を保存 */
  function saveSectionImage() {
    const src = $("secCanvas");
    const memo = [["予想とその理由", $("memoPredict").value], ["答え合わせで分かったこと", $("memoResult").value]].filter((x) => x[1].trim());
    const W = src.width, pad = 20 * (window.devicePixelRatio || 1), fs = 16 * (window.devicePixelRatio || 1);
    const wrap = (t, n) => { const out = []; for (const para of t.split("\n")) { for (let i = 0; i < para.length; i += n) out.push(para.slice(i, i + n)); if (!para.length) out.push(""); } return out; };
    const perLine = Math.max(20, Math.floor((W - pad * 2) / fs));
    const lines = [];
    const head = "断面図（" + S.site.title + "）　" + new Date().toLocaleDateString("ja-JP") + ($("memoName").value ? "　" + $("memoName").value : "");
    for (const [h, t] of memo) { lines.push(["b", "■ " + h]); for (const l of wrap(t, perLine)) lines.push(["n", l]); }
    const H = src.height + pad * 2 + fs * 1.6 + lines.length * fs * 1.5 + (lines.length ? pad : 0);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = Math.ceil(H);
    const g = cv.getContext("2d"), font = '"BIZ UDPGothic","Hiragino Kaku Gothic ProN","Meiryo",sans-serif';
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, cv.height);
    g.fillStyle = "#1f2a33"; g.font = "bold " + fs + "px " + font; g.fillText(head, pad, pad + fs);
    g.drawImage(src, 0, pad + fs * 1.6);
    let y = pad + fs * 1.6 + src.height + pad;
    for (const [k, l] of lines) { g.font = (k === "b" ? "bold " : "") + fs + "px " + font; g.fillText(l, pad, y + fs); y += fs * 1.5; }
    download("断面図-" + stamp() + ".png", cv.toDataURL("image/png"));
  }
  function closeSectionSheet() {
    volcanoBox(null); // 火山の小窓も閉じる
    document.body.classList.remove("sheet-open", "sheet-full");
    $("secFull").textContent = "⛶ 全画面";
    $("sectionSheet").classList.add("hidden");
    updateViewOffset();
  }
  /** 断面図の凡例（色と層の名前） */
  function buildSecLegend() {
    const layersHtml = S.site.layers.map((l, i) =>
      S.visLayers.includes(i) ? '<span><i style="background:' + l.color + '"></i>' + originTag(l) + esc(l.short || l.name) + "</span>" : "").join("");
    const grainHtml = ["gravel", "sand", "mud", "ash", "fill"].map((g) => '<span title="' + esc(C.GRAINS[g].desc) + '"><i style="background:' + C.GRAINS[g].color + '"></i>' + C.GRAINS[g].name + "</span>").join("");
    $("secLegend").innerHTML = (S.colorBy === "grain" ? "<b>柱の色（つぶ）：</b>" + grainHtml + "　<b>模型の地層：</b>" : "<b>地層の色：</b>") + layersHtml +
      '<span class="hint">💧水のはたらき　🌋火山のはたらき　👷人がつくった</span>';
  }
  /** 断面にのっているボーリングを、1本ずつ「見せる／かくす」 */
  function buildBoreChips() {
    const box = $("secBores");
    box.innerHTML = "";
    const bores = S.sectionBores || [];
    if (!bores.length) {
      box.innerHTML = '<span class="hint">この線の近くにボーリングがありません。旗をタップして線を通すと表示されます。</span>';
      return;
    }
    for (const b of bores) {
      const lab = document.createElement("label");
      lab.className = "chip" + (b.hidden ? " off" : "");
      if (b.mark) { lab.style.borderColor = b.mark; lab.style.boxShadow = "inset 4px 0 0 " + b.mark; }
      lab.innerHTML = '<input type="checkbox"' + (b.hidden ? "" : " checked") + "> " + esc(shortName(b.name));
      lab.title = b.name;
      lab.dataset.tip = "チェックを外すと、この柱の中身をかくして「？」にします（予想するとき用）";
      lab.querySelector("input").onchange = (e) => setBoreHidden([b.id], !e.target.checked);
      box.appendChild(lab);
    }
    if (bores.length >= 3) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "真ん中をかくす";
      btn.dataset.tip = "両はしの2本だけを見せて、あいだのボーリングを「？」にします。両はしの柱を手がかりに、真ん中の地層を予想しよう";
      btn.onclick = () => { setBoreHidden(bores.map((x) => x.id), false, true); setBoreHidden(bores.slice(1, -1).map((x) => x.id), true); };
      box.appendChild(btn);
    }
  }
  function setBoreHidden(ids, hidden, quiet) {
    for (const id of ids) hidden ? S.hiddenBores.add(id) : S.hiddenBores.delete(id);
    if (quiet) return;
    buildBores();
    if (S.section && secView) {
      for (const b of S.sectionBores) b.hidden = S.hiddenBores.has(b.id);
      buildBoreChips();
      secView.draw();
    }
  }

  function buildPens() {
    const box = $("penBox");
    box.innerHTML = "";
    const pens = [{ color: "#222222", name: "黒" }].concat(S.site.layers.map((l) => ({ color: l.color, name: l.short || l.name })));
    // はじめはペンなし（かかない）。ペンをおすと かける。同じペンをもう一度おすと やめる
    const none = document.createElement("button");
    none.className = "pen none active";
    none.textContent = "✋";
    none.dataset.tip = "かかない（ペンをしまう）";
    const setPen = (btn, color) => {
      box.querySelectorAll(".pen").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      secView.pen = color;
      $("secCanvas").classList.toggle("drawing", !!color);
    };
    none.onclick = () => setPen(none, null);
    box.appendChild(none);
    pens.forEach((p) => {
      const b = document.createElement("button");
      b.className = "pen";
      b.style.background = p.color;
      b.dataset.tip = p.name + "のペン（もう一度おすと、やめる）";
      b.onclick = () => (secView.pen === p.color && b.classList.contains("active") ? setPen(none, null) : setPen(b, p.color));
      box.appendChild(b);
    });
    setPen(none, null);
  }

  // ---------- ボーリング資料の表示 ----------
  function showBore(id) {
    const b = S.bores.find((x) => x.id === id);
    if (!b) return;
    const layers = S.site.layers;
    const byId = {};
    layers.forEach((l) => (byId[l.id] = l));
    const W = 320, colX = 70, colW = 56;
    const depth = Math.max(b.depth, 1);
    const pxm = Math.min(22, Math.max(6, 380 / depth));
    const H = depth * pxm + 40;
    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" style="max-width:' + W + 'px" font-family="inherit">';
    svg += '<text x="4" y="12" font-size="11" fill="#5a6873">深さ(m)</text><text x="' + (colX + colW + 8) + '" y="12" font-size="11" fill="#5a6873">土の名前・N値</text>';
    const y0 = 22;
    let lastLabelY = -99;
    for (const s of b.segs) {
      const y1 = y0 + s.from * pxm, y2 = y0 + s.to * pxm;
      const L = s.layer ? byId[s.layer] : null;
      svg += '<rect x="' + colX + '" y="' + y1 + '" width="' + colW + '" height="' + Math.max(1, y2 - y1) + '" fill="' + segColor(s) + '" stroke="#333" stroke-width="0.8"/>';
      svg += '<text x="' + (colX - 6) + '" y="' + (y2 + 4) + '" font-size="11" text-anchor="end" fill="#333">' + s.to.toFixed(1) + "</text>";
      const ly = Math.max((y1 + y2) / 2 + 4, lastLabelY + 13);
      lastLabelY = ly;
      svg += '<text x="' + (colX + colW + 8) + '" y="' + ly + '" font-size="12" fill="#1f2a33">' + esc(s.soil || (L ? L.short : "")) + (s.n != null && s.n !== "" ? "（N=" + esc(s.n) + "）" : "") + "</text>";
    }
    svg += '<text x="' + (colX - 6) + '" y="' + (y0 + 4) + '" font-size="11" text-anchor="end" fill="#333">0</text>';
    svg += "</svg>";
    const elevTxt = isNaN(b.elev) ? "不明" : b.elev.toFixed(1) + "m";
    const demTxt = isNaN(b.demElev) ? "" : "（地図の標高 " + b.demElev.toFixed(1) + "m）";
    let markHtml;
    const cur = S.boreMarks[id] || "";
    markHtml = '<div class="markrow"><span>⭐ お気に入り（色で目立たせる）：</span>' +
      '<button type="button" data-mc=""' + (cur ? "" : ' class="on"') + '>なし</button>' +
      MARK_COLORS.map((m) => '<button type="button" class="sw' + (cur === m.c ? " on" : "") + '" data-mc="' + m.c + '" title="' + m.n + '" style="background:' + m.c + '"></button>').join("") +
      (Object.keys(S.boreMarks).length ? '<button type="button" id="dMarkClear" class="link">全部もどす</button>' : "") + "</div>";
    let html = "<h3>" + esc(b.name) + "</h3>";
    html += markHtml;
    if (b.sample) html += '<div class="warnbox">⚠ ' + esc(S.site.sample.note || "仮のデータです") + "</div>";
    html += '<div class="meta">地面の標高：<b>' + elevTxt + "</b> " + (typeof b.elevation === "number" ? demTxt : "") +
      "<br>掘った深さ：" + b.depth.toFixed(1) + "m（いちばん下の標高 " + (b.elev - b.depth).toFixed(1) + "m）" +
      (b.source ? "<br>出典：" + esc(b.source) : "") +
      (b.url ? '<br><a href="' + esc(b.url) + '" target="_blank" rel="noopener">元の資料を開く ↗</a>' : "") + "</div>";
    html += svg;
    if (b.image) html += '<a href="' + esc(b.image) + '" target="_blank" rel="noopener"><img class="log-image" src="' + esc(b.image) + '" alt="柱状図の画像"></a>';
    if (!b.sample && b.source) {
      // なぜ調べたの？（ボーリング調査をする理由）
      const proj = (b.source.split("／")[1] || "").replace(/（[^）]*）$/, "");
      html += '<div class="why"><b>🔎 なぜ地面の下を調べたの？</b><br>' +
        (proj ? "「" + esc(proj) + "」のときに、" : "工事のときに、") +
        "建物や道路などを安全につくれるように、地面の下のようすを調べた記録です。</div>";
    }
    if (b.note && !b.sample) html += '<p class="meta">' + esc(b.note) + "</p>";

    html += '<div class="actions"><button id="dCard">📝 記録カードをつくる</button><button id="dFocus">🎯 近づいて見る</button><button id="dSec">✂️ ここを通る断面</button>' +
      (S.teacher && !b.sample ? '<button id="dEdit">✏️ 編集</button>' : "") + "</div>";
    openDetail(html);
    $("detail").dataset.bore = id;
    $("dCard").onclick = () => makeRecordCard(b);
    document.querySelectorAll("#detailBody .markrow [data-mc]").forEach((btn) => (btn.onclick = () => { setBoreMark(id, btn.dataset.mc); showBore(id); }));
    if ($("dMarkClear")) $("dMarkClear").onclick = () => {
      if (!confirm("目立たせた柱を、全部もとの色にもどしますか？")) return;
      S.boreMarks = {}; store.set(key("boreMarks"), S.boreMarks); buildBores(); if (S.section) openSectionSheet(); showBore(id);
    };
    $("dFocus").onclick = () => focusOn(b.x, b.z, b.elev);
    $("dSec").onclick = () => {
      setMode("section");
      S.sectionPts = [{ x: b.x, z: b.z, boreId: b.id }];
      updateMarkers();
      setHint("✂️ 断面のもう1か所（B）をタップ（となりのボーリングをタップすると2本をくらべられます）");
    };
    if ($("dEdit")) $("dEdit").onclick = () => openBoreDialog(b);
  }

  function openDetail(html) {
    $("detail").dataset.bore = "";
    $("detailBody").innerHTML = html;
    $("detail").classList.remove("hidden");
  }

  /** 記録カード（教科書p.93「学校の下の土地のようす」の形）を画像でつくる */
  function makeRecordCard(b) {
    const W = 900, H = 1200, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d"), font = '"BIZ UDPGothic","Hiragino Kaku Gothic ProN","Meiryo",sans-serif';
    g.fillStyle = "#fffdf6"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#1f7a8c"; g.lineWidth = 6; g.strokeRect(12, 12, W - 24, H - 24);
    g.fillStyle = "#1f2a33"; g.font = "bold 40px " + font; g.fillText("地面の下のようす（柱状図）", 40, 80);
    g.font = "24px " + font;
    g.fillText("場所：" + b.name, 40, 125);
    g.fillText("地面の標高：約" + Math.round(b.elev) + "m　　掘った深さ：" + b.depth.toFixed(1) + "m", 40, 160);
    g.fillText("月　　日（　　）　名前・班：", 40, 200);
    g.strokeStyle = "#999"; g.lineWidth = 1; g.beginPath(); g.moveTo(420, 205); g.lineTo(W - 40, 205); g.stroke();
    // 柱
    const top = 260, bottom = 1010, colX = 170, colW = 140, pxm = (bottom - top) / Math.max(1, b.depth);
    g.font = "20px " + font;
    g.textAlign = "right";
    for (let d = 0; d <= b.depth + 0.01; d += b.depth > 20 ? 5 : b.depth > 8 ? 2 : 1) {
      const y = top + d * pxm;
      g.fillStyle = "#1f2a33"; g.fillText(d + "m", colX - 14, y + 7);
      g.strokeStyle = "#bbb"; g.beginPath(); g.moveTo(colX - 8, y); g.lineTo(colX, y); g.stroke();
    }
    g.textAlign = "left";
    let lastY = -99;
    for (const sg of b.segs) {
      const y1 = top + sg.from * pxm, y2 = top + sg.to * pxm;
      g.fillStyle = segColor(sg); g.fillRect(colX, y1, colW, Math.max(2, y2 - y1));
      g.strokeStyle = "#333"; g.lineWidth = 1.5; g.strokeRect(colX, y1, colW, Math.max(2, y2 - y1));
      const gr = C.GRAINS[C.BoringXML.grainOf(sg.soil, sg.layer)];
      const ly = Math.max((y1 + y2) / 2 + 8, lastY + 26);
      lastY = ly;
      g.fillStyle = "#1f2a33"; g.font = "22px " + font;
      g.fillText(gr.name + "　（" + (sg.soil || "") + "）", colX + colW + 20, ly);
    }
    g.fillStyle = "#1f2a33"; g.font = "bold 24px " + font;
    g.fillText("気づいたこと・考えたこと", 40, 1060);
    g.strokeStyle = "#bbb";
    for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(40, 1100 + i * 34); g.lineTo(W - 40, 1100 + i * 34); g.stroke(); }
    g.font = "16px " + font; g.fillStyle = "#5a6873";
    g.fillText("出典：" + (b.source || ""), 40, H - 30, W - 80);
    download("記録カード_" + b.name.replace(/[\\/:*?"<>|]/g, "") + ".png", cv.toDataURL("image/png"));
  }

  function focusOn(x, z, elev) {
    const target = new THREE.Vector3(x, elev * S.ve, z);
    const off = camera.position.clone().sub(controls.target).setLength(450);
    controls.target.copy(target);
    camera.position.copy(target.clone().add(off));
  }

  // ---------- メモ ----------
  let noteTarget = null;
  function openNoteDialog(p) {
    noteTarget = p;
    $("noteText").value = "";
    $("noteAuthor").value = store.get("chisou3d:author", "");
    $("notePhoto").value = ""; $("notePhotoPrev").innerHTML = "";
    $("notePhoto").dispatchEvent(new Event("change"));
    $("noteDialog").showModal();
    setTimeout(() => $("noteText").focus(), 50);
  }
  function showNote(id) {
    const nt = S.notes.find((n) => n.id === id);
    if (!nt) return;
    openDetail('<h3>📝 気づきメモ</h3><p style="font-size:17px;white-space:pre-wrap;background:' + esc(nt.color) + ';padding:10px;border-radius:8px">' + esc(nt.text) + "</p>" +
      (nt.photo && /^data:image\/(jpeg|png);/.test(nt.photo) ? '<img class="log-image" src="' + nt.photo + '" alt="写真">' : "") +
      '<div class="meta">' + (nt.author ? esc(nt.author) + "　" : "") + esc(new Date(nt.time).toLocaleString("ja-JP")) + "</div>" +
      '<div class="actions"><button id="nDel" class="danger">このメモを消す</button></div>');
    $("nDel").onclick = () => {
      if (!confirm("このメモを消しますか？")) return;
      S.notes = S.notes.filter((n) => n.id !== id);
      store.set(key("notes"), S.notes);
      buildNotes();
      $("detail").classList.add("hidden");
    };
  }
  function showNotesList() {
    let html = "<h3>📝 みんなの気づきメモ</h3>";
    if (!S.notes.length) html += '<p class="meta">まだメモはありません。下の「📝 気づきメモ」を選んで、地図をタップすると置けます。</p>';
    html += '<ul class="notes-list">' + S.notes.map((n) =>
      '<li style="border-left-color:' + esc(n.color) + '">' + esc(n.text) + "<br><small>" + esc(n.author || "") + '</small><button data-go="' + n.id + '">見る</button></li>').join("") + "</ul>";
    html += '<div class="actions"><button id="nExport">メモを書き出す</button><button id="nImport">メモを読み込む</button></div>' +
      '<p class="hint">書き出したメモを先生の端末で読み込むと、クラス全員のメモを1つの模型に集められます。</p>';
    openDetail(html);
    $("detailBody").querySelectorAll("[data-go]").forEach((btn) => (btn.onclick = () => {
      const n = S.notes.find((x) => x.id === btn.dataset.go);
      if (n) { focusOn(n.x, n.z, groundAt(n.x, n.z)); showNote(n.id); }
    }));
    $("nExport").onclick = () => openIO("export-notes");
    $("nImport").onclick = () => openIO("import");
  }

  // ---------- ボーリング入力（先生用） ----------
  let editing = null;
  function openBoreDialog(b, ll) {
    if (b && b.sample) { flashHint("仮データは編集できません"); return; }
    editing = b ? b.id : null;
    const src = b || { name: "", lat: ll.lat, lon: ll.lon, logs: [] };
    $("bName").value = src.name || "";
    $("bElev").value = typeof src.elevation === "number" ? src.elevation : "";
    const loc = S.frame.toLocal(src.lat, src.lon);
    $("bElev").placeholder = "空欄＝地図から（" + groundAt(loc.x, loc.z).toFixed(1) + "m）";
    $("bLat").value = Number(src.lat).toFixed(6);
    $("bLon").value = Number(src.lon).toFixed(6);
    $("bSource").value = src.source || "";
    $("bUrl").value = src.url || "";
    $("bImage").value = src.image || "";
    const tb = $("bLogs").querySelector("tbody");
    tb.innerHTML = "";
    const logs = b ? b.segs.map((s) => ({ to: s.to, layer: s.layer, soil: s.soil, n: s.n })) : [];
    (logs.length ? logs : [{}, {}, {}]).forEach(addLogRow);
    $("bDelete").classList.toggle("hidden", !b);
    $("boreDialog").showModal();
  }
  function addLogRow(r) {
    r = r || {};
    const tr = document.createElement("tr");
    const opts = S.site.layers.map((l) => '<option value="' + l.id + '"' + (l.id === r.layer ? " selected" : "") + ">" + esc(l.short || l.name) + "</option>").join("");
    tr.innerHTML = '<td><input type="number" step="0.01" min="0" class="lTo" value="' + (r.to != null ? r.to : "") + '"></td>' +
      '<td><select class="lLayer">' + opts + "</select></td>" +
      '<td><input class="lSoil" value="' + esc(r.soil || "") + '"></td>' +
      '<td><input class="lN" value="' + esc(r.n != null ? r.n : "") + '"></td>' +
      '<td><button type="button" class="lDel" aria-label="行を消す">✕</button></td>';
    tr.querySelector(".lDel").onclick = () => tr.remove();
    $("bLogs").querySelector("tbody").appendChild(tr);
  }
  function saveBoreDialog() {
    const rows = Array.from($("bLogs").querySelectorAll("tbody tr")).map((tr) => ({
      to: parseFloat(tr.querySelector(".lTo").value),
      layer: tr.querySelector(".lLayer").value,
      soil: tr.querySelector(".lSoil").value.trim(),
      n: tr.querySelector(".lN").value.trim(),
    })).filter((r) => !isNaN(r.to) && r.to > 0).sort((a, b) => a.to - b.to);
    rows.forEach((r) => { if (r.n === "") delete r.n; else if (!isNaN(Number(r.n))) r.n = Number(r.n); });
    const elev = parseFloat($("bElev").value);
    const b = {
      id: editing || "bore-" + Date.now().toString(36),
      name: $("bName").value.trim() || "ボーリング",
      lat: parseFloat($("bLat").value), lon: parseFloat($("bLon").value),
      source: $("bSource").value.trim(), url: $("bUrl").value.trim(), image: $("bImage").value.trim(),
      logs: rows,
    };
    if (!isNaN(elev)) b.elevation = elev;
    for (const k of ["source", "url", "image"]) if (!b[k]) delete b[k];
    const list = customBores().filter((x) => x.id !== b.id);
    list.push(b);
    store.set(key("bores"), list);
    rebuildGeology(true);
    showBore(b.id);
  }
  function deleteBore() {
    if (!editing || !confirm("このボーリングを消しますか？")) return;
    const list = customBores().filter((x) => x.id !== editing);
    list.push({ id: editing, deleted: true });
    store.set(key("bores"), list);
    $("boreDialog").close();
    $("detail").classList.add("hidden");
    rebuildGeology(true);
  }

  /** XMLを読み込んだ結果：本数・場所・層の当てはめを確認できる一覧 */
  function showImportResult(res) {
    const byId = {};
    S.site.layers.forEach((l) => (byId[l.id] = l));
    let html = "<h3>📄 柱状図XMLの読み込み</h3>";
    html += '<p class="meta">読み込めた：<b>' + res.ok.length + "本</b>" + (res.ng.length ? "　読めなかった：" + res.ng.length + "本" : "") + "</p>";
    if (res.ng.length) html += '<div class="warnbox">' + res.ng.map(esc).join("<br>") + "</div>";
    for (const b of res.ok) {
      const inRange = (() => { const p = S.frame.toLocal(b.lat, b.lon); return Math.abs(p.x) <= S.site.half && Math.abs(p.z) <= S.site.half; })();
      html += '<div class="imp"><b>' + esc(b.name) + "</b>" + (inRange ? "" : ' <span class="blocked">（模型の範囲の外です）</span>') +
        '<table><tr><th>深さ</th><th>資料の土の名前</th><th>模型の層</th></tr>' +
        b.logs.map((r) => "<tr><td>〜" + r.to + "m</td><td>" + esc(r.soil) + (r.n != null ? "（N=" + r.n + "）" : "") + '</td><td><span class="sw-s" style="background:' + (byId[r.layer] ? byId[r.layer].color : "#999") + '"></span>' + esc(byId[r.layer] ? byId[r.layer].short || byId[r.layer].name : "?") + "</td></tr>").join("") +
        '</table><button data-edit="' + esc(b.id) + '">✏️ 当てはめを直す</button></div>';
    }
    html += '<p class="hint">「模型の層」は土の名前から自動で当てはめています（例：砂礫→れき、土丹→泥岩、N値4以下のやわらかいシルト・粘土→沖積層）。ちがっていたら「当てはめを直す」で変えてください。</p>';
    openDetail(html);
    $("detailBody").querySelectorAll("[data-edit]").forEach((btn) => (btn.onclick = () => {
      const b = S.bores.find((x) => x.id === btn.dataset.edit);
      if (b) openBoreDialog(b); else flashHint("このボーリングは模型の範囲の外です。範囲（半径）を広げてください");
    }));
  }

  // ---------- 新しい場所をつくる ----------
  function openNewSite() {
    $("nsMsg").textContent = "";
    $("newSiteDialog").showModal();
  }
  async function searchPlace() {
    const q = $("nsName").value.trim();
    if (!q) { $("nsMsg").textContent = "学校名や住所を入れてください"; return; }
    $("nsMsg").textContent = "さがしています…";
    try {
      const r = await fetch("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q));
      const js = await r.json();
      if (!js.length) { $("nsMsg").textContent = "見つかりませんでした。住所で入れるか、緯度・経度を直接入れてください"; return; }
      const [lon, lat] = js[0].geometry.coordinates;
      $("nsLat").value = lat.toFixed(6); $("nsLon").value = lon.toFixed(6);
      $("nsMsg").textContent = "見つかりました：" + js[0].properties.title + "（ちがう場所なら緯度・経度を直してください）";
    } catch (e) {
      $("nsMsg").textContent = "検索につながりませんでした。地理院地図で場所を右クリックして、緯度・経度を入れてください";
    }
  }
  function createNewSite() {
    const name = $("nsName").value.trim(), lat = parseFloat($("nsLat").value), lon = parseFloat($("nsLon").value);
    if (!name || isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { $("nsMsg").textContent = "名前・緯度・経度を入れてください"; return; }
    const id = "my-" + Date.now().toString(36);
    const list = store.get("chisou3d:customSites", []);
    list.push({ id, name, lat, lon, half: parseInt($("nsRadius").value, 10) });
    store.set("chisou3d:customSites", list);
    location.search = "?site=" + id;
  }

  // ---------- 書き出し・読み込み ----------
  function exportBores() {
    return allBoreData().filter((b) => !b.sample).map((b) => {
      const o = { id: b.id, name: b.name, lat: +(+b.lat).toFixed(6), lon: +(+b.lon).toFixed(6) };
      for (const k of ["elevation", "source", "url", "image", "note"]) if (b[k] != null && b[k] !== "") o[k] = b[k];
      o.logs = b.logs;
      return o;
    });
  }
  let ioMode = null;
  function openIO(mode) {
    ioMode = mode;
    const t = $("ioText");
    if (mode === "export") {
      $("ioTitle").textContent = "データを書き出す";
      $("ioHelp").textContent = "ボーリング資料と気づきメモです。「ファイルに保存」して別の端末で読み込めます。ボーリングの部分（boreholes の [ ] の中）を sites/" + S.site.id + ".js の boreholes に貼り付けると、全員の画面にのるようになります。";
      t.value = JSON.stringify({ site: S.site.id, boreholes: exportBores(), notes: S.notes }, null, 2);
    } else if (mode === "export-notes") {
      $("ioTitle").textContent = "メモを書き出す";
      $("ioHelp").textContent = "「ファイルに保存」して、先生の端末の「データを読み込む」で読み込めます。";
      t.value = JSON.stringify({ site: S.site.id, notes: S.notes }, null, 2);
    } else {
      $("ioTitle").textContent = "データを読み込む";
      $("ioHelp").textContent = "書き出したデータ（文字）をここに貼り付けるか、ファイルを選んでください。";
      t.value = "";
    }
    $("ioDownload").classList.toggle("hidden", mode === "import");
    $("ioLoad").classList.toggle("hidden", mode !== "import");
    $("ioDialog").showModal();
  }
  function doImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { alert("データの形が正しくありません。"); return; }
    let nb = 0, nn = 0;
    if (Array.isArray(data.boreholes)) {
      const list = customBores();
      for (const b of data.boreholes) {
        if (!b || b.lat == null || !Array.isArray(b.logs)) continue;
        const i = list.findIndex((x) => x.id === b.id);
        if (i >= 0) list[i] = b; else list.push(b);
        nb++;
      }
      store.set(key("bores"), list);
    }
    if (Array.isArray(data.notes)) {
      for (const n of data.notes) {
        if (!n || !n.id || S.notes.some((x) => x.id === n.id)) continue;
        S.notes.push(n);
        nn++;
      }
      store.set(key("notes"), S.notes);
    }
    $("ioDialog").close();
    if (nb) rebuildGeology(true); else buildNotes();
    flashHint("読み込みました（ボーリング " + nb + "本・メモ " + nn + "こ）");
  }
  function download(name, content, type) {
    const a = document.createElement("a");
    a.href = typeof content === "string" && content.startsWith("data:") ? content : URL.createObjectURL(new Blob([content], { type: type || "application/json" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function stamp() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0"); }

  // ---------- カメラの向き ----------
  function setView(kind, instant) {
    const h = S.site.half, cy = ((S.stats.p05 + S.stats.p95) / 2) * S.ve;
    const az = kind === "tilt" && !instant ? controls.getAzimuthalAngle() : 0;
    const t = new THREE.Vector3(0, cy, 0);
    let off;
    if (kind === "top") off = new THREE.Vector3(0, h * 3, 1);
    else if (kind === "side") off = new THREE.Vector3(0, h * 0.25, h * 2.4);
    else off = new THREE.Vector3(0, h * 1.6, h * 2.1);
    off.multiplyScalar(Math.max(1, 1.45 / camera.aspect)); // たて長の画面では遠くから
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), az);
    controls.target.copy(t);
    camera.position.copy(t.clone().add(off));
    controls.update();
  }

  // ---------- 画面の操作 ----------
  let hintTimer = null;
  function setHint(t) { $("hint").textContent = t; $("hint").classList.toggle("hidden", !t); }
  function flashHint(t) { setHint(t); clearTimeout(hintTimer); hintTimer = setTimeout(() => setHint(modeHint()), 3500); }
  function modeHint() {
    return { view: "", section: "✂️ 断面図を作成：地図の上で2か所以上をタップ（ボーリングの旗をタップすると、その柱を通ります）",
      cut: "🔪 赤い線の所で模型を切ります。向き・位置を動かすか、模型をタップして線を動かしてから「この線で切る」",
      pick: "📍 断面に使うボーリングの旗を、つなぎたい順にタップ（2本以上）→「✅ この柱で断面図をつくる」", note: "📝 メモを置きたい場所をタップ", edit: "➕ ボーリングの場所をタップ（柱をタップすると編集）" }[S.mode];
  }
  function setMode(m) {
    const prev = S.mode;
    S.mode = m;
    if (S.digOn && m !== "view") setDig(false); // ほかのモードにしたら、どこでもボーリングは終わり
    if (window.innerWidth <= 760 && !$("controls").classList.contains("collapsed")) { $("controls").classList.add("collapsed"); updateViewOffset(); } // スマホ：パネルをとじて模型を見やすく
    if (S.section && !(m === "section" && prev === "section")) clearSection();
    S.sectionPts = [];
    S.pickIds = [];
    $("cutBar").classList.add("hidden");
    $("cutGuideBar").classList.toggle("hidden", m !== "cut");
    if (m === "cut") { syncCutGuideUI(); buildCutGuide(); } else if (groups.guide) disposeGroup(groups.guide);
    $("pickBar").classList.toggle("hidden", m !== "pick");
    if (m === "pick") updatePickBar();
    updateMarkers();
    document.querySelectorAll("#modebar button[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    const act = document.querySelector("#modebar button.active"); if (act && act.scrollIntoView) act.scrollIntoView({ block: "nearest", inline: "nearest" });
    setHint(modeHint());
  }

  function buildLegend() {
    const ul = $("legend");
    ul.innerHTML = "";
    S.site.layers.forEach((l, i) => {
      const li = document.createElement("li");
      const present = S.visLayers.includes(i);
      const o = C.ORIGINS[l.origin];
      li.innerHTML = '<span class="sw" style="background:' + l.color + '"></span><div>' + (o ? '<span class="origin" title="' + o.name + 'でできた">' + o.icon + "</span>" : "") + esc(l.name) + (present ? "" : ' <span style="color:#999">（資料なし）</span>') + "<small>" + esc(l.desc || "") + "</small></div>";
      li.onclick = () => li.classList.toggle("open");
      ul.appendChild(li);
    });
    // つぶの大きさの凡例
    const gl = $("grainLegend");
    gl.innerHTML = ["gravel", "sand", "mud", "ash", "fill"].map((g) => '<li><span class="sw" style="background:' + C.GRAINS[g].color + '"></span><div>' + C.GRAINS[g].name + "<small>" + esc(C.GRAINS[g].desc) + "</small></div></li>").join("");
    gl.classList.toggle("hidden", S.colorBy !== "grain");
    $("peelRange").max = Math.max(0, S.visLayers.length - 1);
    $("peelRange").value = S.peel;
    updatePeelLabel();
  }
  function updatePeelLabel() {
    const L = S.site.layers;
    let t = "地面（地図）";
    if (S.peel > 0) {
      const removed = S.visLayers.filter((i) => S.peeled.has(i)).map((i) => L[i].short || L[i].name);
      t = "はがした層：" + removed.join("・");
    }
    $("peelLabel").textContent = t;
    buildPeelChecks();
  }
  /** 地層をはがす：層ごとのチェック。外した層だけが はがれる（その上にのっている層は、その場所だけ いっしょに はがれる） */
  function buildPeelChecks() {
    const box = $("peelChecks");
    if (!box) return;
    const L = S.site.layers;
    // 断面を切っているときは、その断面にある層がわかるように
    let inSec = null;
    if (S.section) {
      inSec = new Set();
      for (const smp of S.section.samples) L.forEach((_, li) => { if (smp.tops[li] - smp.bots[li] > 0.3) inSec.add(li); });
    }
    box.innerHTML = "";
    // はがし方：1つずつ／新しい順にまとめて（時代をさかのぼる）
    const mode = S.peelMode || "one";
    const seg = document.createElement("div");
    seg.className = "seg peelmode";
    seg.innerHTML = '<button type="button" data-pm="one">1つずつ</button><button type="button" data-pm="age">新しい順にまとめて</button>';
    seg.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.pm === mode);
      b.onclick = () => {
        S.peelMode = b.dataset.pm; store.set("chisou3d:peelMode", S.peelMode);
        if (S.peelMode === "age" && S.peel) { // いちばん下の はがした層までを、まとめて はがす
          const deepest = Math.max(...S.visLayers.map((li, k) => (S.peeled.has(li) ? k : -1)));
          setPeeled(new Set(S.visLayers.slice(0, deepest + 1)));
          buildAll();
        }
        updatePeelLabel();
      };
    });
    box.appendChild(seg);
    const hp = document.createElement("p");
    hp.className = "hint";
    hp.textContent = mode === "age"
      ? "⏪ 外した層と、それより新しい層（一覧で上の層）を まとめて はがします。時代をさかのぼるように見られます"
      : "チェックを外した層だけを はがします。のこした層は、下の層をはがしても もとの高さのまま（宙にういて）見えます";
    box.appendChild(hp);
    if (inSec) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "✂️ いまの断面にある層は、名前が太字です";
      box.appendChild(p);
    }
    S.visLayers.forEach((li, k) => {
      const l = L[li];
      const off = S.peeled.has(li), last = k === S.visLayers.length - 1;
      const lab = document.createElement("label");
      lab.className = "peelrow" + (off ? " off" : "") + (inSec && !inSec.has(li) ? " notinsec" : "") + (inSec && inSec.has(li) ? " insec" : "");
      lab.innerHTML = '<input type="checkbox"' + (off ? "" : " checked") + (last ? " disabled" : "") + '><i style="background:' + l.color + '"></i>' + (originTag(l) || "") + esc(l.short || l.name) +
        (last ? "<small>（いちばん下の土台）</small>" : inSec && !inSec.has(li) ? "<small>（この断面にはない）</small>" : "");
      if (!last) {
        // 「この層だけ」：ほかの層をはがして、この層がどこに広がっているかを見る（いちばん下の土台は残す）
        const solo = document.createElement("button");
        solo.type = "button"; solo.className = "solo"; solo.textContent = "👁 だけ";
        solo.dataset.tip = (l.short || l.name) + "だけを残して、どこに広がっているかを見ます";
        solo.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          if (S.hideStrata) return flashHint("⚠ いまは「地下の地層をかくす」がオンなので、地層をはがせません");
          S.peelMode = "one"; store.set("chisou3d:peelMode", "one");
          setPeeled(new Set(S.visLayers.filter((x, kk) => x !== li && kk !== S.visLayers.length - 1)));
          updatePeelLabel(); buildAll();
          flashHint("👁 " + (l.short || l.name) + "だけを残しました（下の灰色は土台の泥岩）");
        };
        lab.appendChild(solo);
      }
      lab.querySelector("input").onchange = (e) => {
        if (S.hideStrata) { e.target.checked = true; flashHint("⚠ いまは「地下の地層をかくす」がオンなので、地層をはがせません。左のパネルのチェックを外してください"); return; }
        let set;
        if ((S.peelMode || "one") === "age") set = new Set(S.visLayers.slice(0, e.target.checked ? k : k + 1));
        else { set = new Set(S.peeled); if (e.target.checked) set.delete(li); else set.add(li); }
        setPeeled(set);
        updatePeelLabel();
        buildAll();
      };
      box.appendChild(lab);
    });
    if (S.peel) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "link"; b.textContent = "↺ 全部もとにもどす";
      b.onclick = () => { setPeeled(new Set()); updatePeelLabel(); buildAll(); };
      box.appendChild(b);
    }
  }

  function initUI() {
    S.colorBy = store.get("chisou3d:colorBy", "layer");
    $("colorBySelect").value = S.colorBy;
    $("colorBySelect").onchange = () => {
      S.colorBy = $("colorBySelect").value;
      store.set("chisou3d:colorBy", S.colorBy);
      buildBores(); buildLegend();
      if (S.section) openSectionSheet();
      if ($("detail").dataset.bore) showBore($("detail").dataset.bore);
    };
    const hs = $("hazardSelect");
    hs.add(new Option("重ねない", "none"));
    for (const k in C.HAZARDS) hs.add(new Option(C.HAZARDS[k].name, k));
    hs.onchange = () => setHazard(hs.value);
    const rs = $("reliefSelect");
    for (const k in RELIEF) rs.add(new Option(RELIEF[k], k));
    rs.onchange = () => setRelief(rs.value);
    bindHoverElevation();
    const ms = $("mapSelect");
    const groupsEl = {};
    for (const k in C.MAP_TYPES) {
      const g = C.MAP_TYPES[k].group;
      if (!g) { ms.add(new Option(C.MAP_TYPES[k].name, k)); continue; }
      if (!groupsEl[g]) { groupsEl[g] = document.createElement("optgroup"); groupsEl[g].label = "── " + g + " ──"; ms.appendChild(groupsEl[g]); }
      groupsEl[g].appendChild(new Option(C.MAP_TYPES[k].name, k));
    }
    ms.onchange = () => setMap(ms.value);
    const ss = $("siteSelect");
    for (const s of C.SITE_LIST) ss.add(new Option("場所：" + s.title, s.id, false, s.id === S.site.id));
    for (const c of customSites) ss.add(new Option("場所：" + c.name + "（この端末で作成）", c.id, false, c.id === S.site.id));
    ss.add(new Option("＋ 新しい場所をつくる…", "__new__"));
    ss.onchange = () => {
      if (ss.value === "__new__") { ss.value = S.site.id; return openNewSite(); }
      location.search = "?site=" + encodeURIComponent(ss.value);
    };
    $("nsCreate").onclick = createNewSite;
    $("btnNewSite").onclick = openNewSite;
    $("nsSearch").onclick = searchPlace;
    $("nsLatLon").addEventListener("input", () => {
      const m = $("nsLatLon").value.match(/(-?\d+\.\d+)[,\s、]+(-?\d+\.\d+)/);
      if (m) { $("nsLat").value = m[1]; $("nsLon").value = m[2]; }
    });

    $("veRange").value = S.ve;
    $("veValue").textContent = "×" + S.ve;
    $("veRange").oninput = () => {
      const old = S.ve;
      S.ve = parseFloat($("veRange").value);
      $("veValue").textContent = "×" + S.ve;
      const f = S.ve / old;
      controls.target.y *= f;
      camera.position.y = controls.target.y + (camera.position.y - controls.target.y);
      buildAll();
    };
    $("opacityRange").oninput = () => { S.savedOpacity = null; S.opacity = parseFloat($("opacityRange").value); applyOpacity(); };
    const peelBlocked = () => {
      $("peelRange").value = 0;
      flashHint("⚠ いまは「地下の地層をかくす」がオンなので、地層をはがせません。左のパネルのチェックを外してください");
      $("peelLabel").innerHTML = '<span class="blocked">⚠ 「地下の地層をかくす」のチェックを外すと、はがせます</span>';
    };
    $("peelRange").oninput = () => {
      if (S.hideStrata) return peelBlocked();
      setPeeled(new Set(S.visLayers.slice(0, parseInt($("peelRange").value, 10)))); updatePeelLabel(); buildAll();
    };
    $("peelRange").addEventListener("pointerdown", () => { if (S.hideStrata) peelBlocked(); });
    const chk = (id, fn) => ($(id).onchange = () => fn($(id).checked));
    chk("chkBores", (v) => { S.showBores = v; applyVisibility(); });
    const setLift = (v) => { S.lift = v; $("chkLift").checked = v; $("qLift").classList.toggle("on", v); buildBores(); };
    chk("chkLift", setLift);
    $("qLift").onclick = () => setLift(!S.lift);
    const setRiver = (v) => { S.showRivers = v; $("chkRiver").checked = v; $("qRiver").classList.toggle("on", v); buildRivers(); if (S.section) openSectionSheet(); };
    chk("chkRiver", setRiver);
    // 流域・分水界
    const setBasin = (v) => { S.showBasin = v; $("chkBasin").checked = v; if (v) S.cardClosed.basinCard = false; applyTexture(); basinCard(v); };
    chk("chkBasin", setBasin);
    // 学習の道具
    $("btnDig").onclick = () => setDig(!S.digOn);
    $("btnLab").onclick = () => C.FlowLab.open();
    $("btnSheet").onclick = printWorksheet;
    $("btnSTL").onclick = exportSTL;
    $("qRiver").onclick = () => setRiver(!S.showRivers);
    // 谷戸：この模型の中に谷戸があるときだけボタンを出す
    const setYato = (v) => { S.showYato = v; store.set("chisou3d:yato", v); $("chkYato").checked = v; $("qYato").classList.toggle("on", v); buildYato(); if (S.section) openSectionSheet(); };
    chk("chkYato", setYato);
    $("qYato").onclick = () => setYato(!S.showYato);
    // 柱の名前（🔍の名札）を出す・かくす
    const setBoreNames = (v) => { S.boreNames = v; store.set("chisou3d:boreNames", v); $("qNames").classList.toggle("on", v); $("qNames").title = v ? "今は柱の名前を出しています（押すと、かくす）" : "今は柱の名前をかくしています（押すと、出す）"; applyVisibility(); };
    $("qNames").onclick = () => { setBoreNames(!S.boreNames); if (S.boreNames && !S.labels) { $("chkLabels").checked = true; $("chkLabels").dispatchEvent(new Event("change")); } };
    setBoreNames(store.get("chisou3d:boreNames", true));
    const hasYato = yatoList().length > 0;
    $("qYato").classList.toggle("hidden", !hasYato);
    $("chkYato").parentElement.classList.toggle("hidden", !hasYato);
    if (hasYato) setYato(store.get("chisou3d:yato", false));
    S.autoMarksOn = store.get("chisou3d:autoMarks", true);
    $("chkAutoMarks").checked = S.autoMarksOn;
    chk("chkAutoMarks", (v) => { S.autoMarksOn = v; store.set("chisou3d:autoMarks", v); buildLabels(); });
    // 設定ファイルに目印（国土地理院の注記から作ったもの）があればそれを使い、なければOpenStreetMapから取る
    const marksReady = S.site.mapMarks ? Promise.resolve(S.site.mapMarks.map((m) => Object.assign({ area: 0 }, m))) : loadAutoMarks().then((l) => {
      if (l) S.site.mapMarks = l.filter((m) => m.icon === "🌊"); // 川の名前
      if (S.showRivers) buildRivers();
      if (S.marksSource === "gsi") gsiAttr();
      return l;
    });
    const gsiAttr = () => ($("attribution").innerHTML = $("attribution").innerHTML.replace(/目印：<a[^>]*>[^<]*<\/a>/, '目印：<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院（地図情報）</a>'));
    if (S.site.mapMarks) $("attribution").innerHTML = $("attribution").innerHTML.replace(/目印：<a[^>]*>[^<]*<\/a>/, '目印：<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院（地図情報）</a>');
    marksReady.then((list) => {
      if (!list) { S.autoMarksFailed = true; list = []; }
      S.autoMarks = list;
      buildMarkCats();
      buildLabels();
      // 公園・公共施設は地理院の地図の文字には少ないので、OpenStreetMapからおぎなう（つながらなければ、そのまま）
      loadOsmExtra().then((ex) => {
        if (!ex || !ex.length) return;
        const names = new Set(S.autoMarks.map((m) => m.name));
        S.autoMarks = S.autoMarks.concat(ex.filter((m) => !names.has(m.name)));
        S.osmExtra = true;
        buildMarkCats();
        if (!/OpenStreetMap/.test($("attribution").innerHTML)) $("attribution").insertAdjacentHTML("beforeend", ' ／ 公園など：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>');
        buildLabels();
      }).catch(() => {});
    });
    // 目印の種類ごとの表示
    buildMarkCats();
    $("btnXml").onclick = () => xmlInput.click();
    const xmlInput = document.createElement("input");
    xmlInput.type = "file"; xmlInput.accept = ".xml,.XML,.json"; xmlInput.multiple = true;
    xmlInput.onchange = async () => {
      const files = Array.from(xmlInput.files || []);
      xmlInput.value = "";
      if (!files.length) return;
      const res = await C.BoringXML.readFiles(files, S.site.layers.map((l) => l.id));
      if (res.ok.length) {
        const list = customBores();
        for (const b of res.ok) { const i = list.findIndex((x) => x.id === b.id); if (i >= 0) list[i] = b; else list.push(b); }
        store.set(key("bores"), list);
        rebuildGeology(true);
      }
      showImportResult(res);
    };
    const rs2 = $("radiusSelect");
    const dr = S.site.dataRadius;
    for (const km of [0.5, 1, 1.5, 2, 2.5, 3]) rs2.add(new Option("半径 " + km + "km（" + km * 2 + "km四方）" + (dr && km * 1000 > dr ? "※資料は" + dr / 1000 + "kmまで" : ""), km * 1000));
    if (![500, 1000, 1500, 2000, 2500, 3000].includes(S.site.half)) rs2.add(new Option("半径 " + S.site.half / 1000 + "km", S.site.half));
    rs2.value = S.site.half;
    rs2.onchange = () => {
      store.set(key("half"), parseInt(rs2.value, 10));
      const u = new URL(location.href);
      u.searchParams.delete("r");
      location.href = u.href;
    };
    chk("chkLabels", (v) => { S.labels = v; applyVisibility(); });
    chk("chkNotes", (v) => { S.showNotes = v; applyVisibility(); });
    chk("chkRing", (v) => { S.ring = v; applyVisibility(); });
    chk("chkTeacher", (v) => {
      S.teacher = v;
      $("teacherTools").classList.toggle("hidden", !v);
      document.querySelectorAll(".teacher-only").forEach((e) => e.classList.toggle("hidden", !v));
      if (!v && S.mode === "edit") setMode("view");
    });
    $("chkSample").checked = S.sampleOn;
    chk("chkSample", (v) => {
      S.sampleOn = v;
      const prefs = store.get(key("prefs"), {});
      prefs.sampleOn = v;
      store.set(key("prefs"), prefs);
      rebuildGeology(true);
    });
    // 地層をかくす（予想用）
    const hideLbl = document.createElement("label");
    hideLbl.innerHTML = '<input type="checkbox" id="chkHide"> 地下の地層をかくす（予想するとき用）';
    document.querySelector(".checks").appendChild(hideLbl);
    chk("chkHide", (v) => {
      S.hideStrata = v;
      $("peelRange").classList.toggle("locked", v);
      if (v) { setPeeled(new Set()); $("peelRange").value = 0; $("secShowModel").checked = false; }
      updatePeelLabel();
      $("secShowModel").disabled = v;
      buildAll();
      if (S.section) openSectionSheet();
    });

    document.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
    document.querySelectorAll("#modebar button[data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    // 画面の下のボタン・左のパネル・説明のバー・「動かす」が重ならないように、実際の位置を測ってすきまを空ける
    let layoutRaf = 0;
    const layoutUI = () => {
      layoutRaf = 0;
      const root = document.documentElement.style, mb = $("modebar"), np = $("navpad"), vh = window.innerHeight, vw = window.innerWidth;
      // 右下の「動かす」：その分、下のボタンの列を左によせる
      const nr = np.getBoundingClientRect(), npShown = nr.width > 0 && getComputedStyle(np).display !== "none";
      const npW = npShown && nr.top < vh - 20 ? Math.max(0, vw - nr.left + 8) : 0;
      root.setProperty("--npW", npW + "px");
      // 左のパネルが開いていて下のほうまであるときは、説明のバーを その右に出す
      const cr = $("controls").getBoundingClientRect();
      root.setProperty("--lpW", (cr.width > 0 && !$("controls").classList.contains("collapsed") && cr.bottom > vh * 0.45 && vw > 760 ? cr.right + 8 : 0) + "px");
      // 下のボタンの列の、上のはし（画面の下からの高さ）
      const mr = mb.getBoundingClientRect(), mbShown = mr.height > 0 && getComputedStyle(mb).display !== "none";
      root.setProperty("--mbTop", (mbShown ? Math.max(0, vh - mr.top) : 34) + "px");
      // 説明のバー（切り口・柱をえらぶ）が出ているときは、ヒントの文をその上にずらす
      let fh = 0;
      document.querySelectorAll(".floatbar").forEach((f) => { if (!f.classList.contains("hidden")) fh = Math.max(fh, f.getBoundingClientRect().height + 10); });
      root.setProperty("--fbH", fh + "px");
    };
    const relayout = () => { if (!layoutRaf) layoutRaf = requestAnimationFrame(layoutUI); };
    S.relayout = relayout;
    window.addEventListener("resize", relayout);
    if (window.ResizeObserver) { const ro = new ResizeObserver(relayout); ["modebar", "navpad", "cutBar", "cutGuideBar", "pickBar", "controls"].forEach((id) => $(id) && ro.observe($(id))); }
    new MutationObserver(relayout).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    document.querySelectorAll(".floatbar, #controls").forEach((f) => new MutationObserver(relayout).observe(f, { attributes: true, attributeFilter: ["class"] }));
    relayout();
    // 下のボタンの列：横にスライドできるとき、はしをうすくして「まだある」ことを知らせる
    const mbEl = $("modebar");
    const mbEdge = () => {
      const more = mbEl.scrollWidth - mbEl.clientWidth > 4;
      mbEl.classList.toggle("more-left", more && mbEl.scrollLeft > 4);
      mbEl.classList.toggle("more-right", more && mbEl.scrollLeft < mbEl.scrollWidth - mbEl.clientWidth - 4);
    };
    mbEl.addEventListener("scroll", mbEdge, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(mbEdge).observe(mbEl);
    // マウスのホイール（たて）でも横に動かせる
    mbEl.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && mbEl.scrollWidth > mbEl.clientWidth) { mbEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    setTimeout(mbEdge, 300);
    // ページ全体のピンチ拡大（iPad・iPhone の Safari）を止める。模型の上のピンチは、模型のズームに使う
    ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
    document.addEventListener("touchmove", (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
    // ボタンをたたむ・出す（スマホは はじめから たたんでおく）。えらんだ状態は次も同じ
    const setFold = (id, cls, on, labelOn) => {
      document.body.classList.toggle(cls, on);
      $(id).textContent = on ? labelOn : "✕";
      store.set("chisou3d:" + cls, on);
    };
    const small = window.innerWidth < 600;
    setFold("mbFold", "mb-folded", store.get("chisou3d:mb-folded", small), "☰ ボタンを出す");
    setFold("npFold", "np-folded", store.get("chisou3d:np-folded", small), "🎮 動かす");
    $("mbFold").onclick = () => setFold("mbFold", "mb-folded", !document.body.classList.contains("mb-folded"), "☰ ボタンを出す");
    $("npFold").onclick = () => setFold("npFold", "np-folded", !document.body.classList.contains("np-folded"), "🎮 動かす");
    // 右下の操作ボタン
    document.querySelectorAll("#navpad [data-pan]").forEach((b) => (b.onclick = () => nudge("pan", b.dataset.pan.split(",").map(Number))));
    document.querySelectorAll("#navpad [data-rot]").forEach((b) => (b.onclick = () => nudge("rotate", parseFloat(b.dataset.rot))));
    document.querySelectorAll("#navpad [data-zoom]").forEach((b) => (b.onclick = () => nudge("zoom", parseFloat(b.dataset.zoom))));
    document.querySelectorAll("#navpad [data-tilt]").forEach((b) => (b.onclick = () => nudge("tilt", parseFloat(b.dataset.tilt))));
    document.querySelectorAll("#navpad [data-drag]").forEach((b) => (b.onclick = () => applyDragMode(b.dataset.drag)));
    $("navHome").onclick = () => setView("tilt", true);
    applyDragMode(S.dragMode);
    $("controlsToggle").onclick = () => { $("controls").classList.toggle("collapsed"); updateViewOffset(); };
    if (window.innerWidth < 1100) $("controls").classList.add("collapsed");
    updateViewOffset();
    document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => {
      if (b.dataset.close === "section") clearSection();
      else $(b.dataset.close).classList.add("hidden");
    }));
    $("compass").onclick = () => {
      const t = controls.target, off = camera.position.clone().sub(t);
      const r = Math.hypot(off.x, off.z);
      camera.position.set(t.x, camera.position.y, t.z + r);
    };
    $("attrMore").onclick = (e) => { e.preventDefault(); C.Help.openSources(); };
    $("sampleBadge").onclick = () => (!S.bores.length ? C.Help.openHelp(5) : alert(S.site.sample.note + "\n\n先生モードで「仮データを表示」を外すと消えます。"));

    // 断面図
    $("secUndo").onclick = () => secView && secView.undo();
    // 断面図の大きさ
    // 下のボタン（見る・断面図を作成…）がいつも見えるように、シートはボタンの下までにする（全画面のときだけ上まで）
    let mbH = 64;
    const maxSheetH = () => { const mb = $("modebar"); if (mb && mb.offsetHeight) mbH = mb.offsetHeight; return window.innerHeight - mbH - 24; };
    const setSheetH = (px, full) => {
      const h = full ? window.innerHeight : Math.max(160, Math.min(maxSheetH(), px));
      document.documentElement.style.setProperty("--sheetH", h + "px");
      document.body.classList.toggle("sheet-full", !!full);
      $("secFull").textContent = full ? "⛶ 全画面をやめる" : "⛶ 全画面";
      if (!full) store.set("chisou3d:sheetH", h);
      if (secView) secView.resize();
      updateViewOffset();
      if (S.relayout) S.relayout();
    };
    const sh0 = store.get("chisou3d:sheetH", 0);
    if (sh0) document.documentElement.style.setProperty("--sheetH", Math.min(sh0, maxSheetH()) + "px");
    window.addEventListener("resize", () => { if (document.body.classList.contains("sheet-open") && !document.body.classList.contains("sheet-full") && curH() > maxSheetH()) setSheetH(maxSheetH()); });
    const curH = () => $("sectionSheet").offsetHeight || window.innerHeight * 0.46;
    $("secBigger").onclick = () => setSheetH(curH() + window.innerHeight * 0.15);
    $("secSmaller").onclick = () => setSheetH(curH() - window.innerHeight * 0.15);
    $("secFull").onclick = () => (document.body.classList.contains("sheet-full") ? setSheetH(window.innerHeight * 0.46) : setSheetH(window.innerHeight, true));
    const grip = $("sheetGrip");
    grip.addEventListener("pointerdown", (e) => {
      grip.setPointerCapture(e.pointerId);
      const move = (ev) => setSheetH(window.innerHeight - ev.clientY);
      const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });
    // 断面図の範囲：A〜Bだけ／模型のはしまで
    document.querySelectorAll("#secExtentBox button").forEach((b) => (b.onclick = () => {
      S.secExtent = b.dataset.ext;
      store.set("chisou3d:secExtent", S.secExtent);
      if (S.section) openSectionSheet();
    }));
    S.secExtent = store.get("chisou3d:secExtent", "ab");
    // 大地のでき方（①〜⑥）
    const stageUI = () => {
      const on = secView && secView.stage > 0;
      $("secStage").classList.toggle("on", !!on);
      $("secStagePrev").classList.toggle("hidden", !on);
      $("secStageNext").classList.toggle("hidden", !on);
      const tl = $("secTimeline"), was = !tl.classList.contains("hidden");
      tl.classList.toggle("hidden", !on);
      if (on) {
        const list = secView.stages(), i = list.findIndex((x) => x.n === secView.stage);
        const r = $("secStageRange");
        r.max = list.length * 100; r.min = 0;
        if (!S.stageAnim) r.value = Math.round((i + (secView.stageT == null ? 1 : secView.stageT)) * 100);
        $("secStageTicks").innerHTML = list.map((x, k) => '<button type="button" data-k="' + k + '" class="' + (k === i ? "on" : "") + '"><b>' + x.text.slice(0, 1) + "</b>" + esc((x.age || "").replace(/（.*$/, "").replace("ごろ", "")) + "</button>").join("");
        $("secStageTicks").querySelectorAll("button").forEach((b) => (b.onclick = () => playStage(+b.dataset.k, +b.dataset.k + 1)));
        // 本当の時間の長さ（まっすぐな時間の物さし）：大昔がとても長く、今に近い出来事はほんの少し
        const T = Math.max(...list.map((x) => x.from || 0)) || 1;
        $("secStageBar").innerHTML = list.map((x, k) => {
          if (x.from == null) return "";
          const left = (1 - x.from / T) * 100, width = Math.max(0.4, ((x.from - x.to) / T) * 100);
          return '<i class="' + (k === i ? "on" : "") + '" style="left:' + left + "%;width:" + width + '%" title="' + esc(x.age) + '"></i>';
        }).join("") + '<span class="tl-now">今 ▶</span><span class="tl-old">◀ ' + (T >= 10000 ? Math.round(T / 10000) + "万" : T) + "年前</span>";
      }
      if (on !== was) stageLayout(!!on);
      if (on !== was && secView) secView.resize();
    };
    // 大地のでき方を見ている間は「見る用の画面」：いらない段をたたみ、シートを大きく、たての強調を自動に
    const stageLayout = (on) => {
      if (!!S.stageLayoutOn === on) return;
      S.stageLayoutOn = on;
      $("sectionSheet").classList.toggle("stage-mode", on);
      if (on) {
        S.stageSaved = { full: document.body.classList.contains("sheet-full"), h: curH(), ve: store.get("chisou3d:secVe", "auto"), hs: store.get("chisou3d:secHScale", 1) };
        setSecHScale(1); setSecVe("auto");
        if (!S.stageSaved.full) setSheetH(window.innerHeight - 40);
      } else if (S.stageSaved) {
        const sv = S.stageSaved; S.stageSaved = null;
        setSecHScale(sv.hs); setSecVe(sv.ve);
        if (sv.full) setSheetH(window.innerHeight, true); else setSheetH(sv.h);
      }
    };
    S.stageLayout = stageLayout;
    // つまみの位置 v（0〜段階の数×100）→ どの出来事の、どこまで進んだか
    const setStageV = (v) => {
      const list = secView.stages();
      v = Math.max(1, Math.min(list.length * 100, v));
      const idx = Math.min(list.length - 1, Math.floor((v - 0.001) / 100));
      secView.stage = list[idx].n;
      secView.stageT = (v - idx * 100) / 100;
      secView.draw(); stageUI();
    };
    /** from→to（段階の番号）へ、なめらかに時間を進める */
    const playStage = (fromIdx, toIdx) => {
      if (S.stageAnim) cancelAnimationFrame(S.stageAnim);
      // ③（火山灰と川のくり返し）は出来事が多いので、ゆっくり進める
      const list = secView.stages(), wt = (i) => (list[i] && list[i].n === 3 ? 6 : 1);
      const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx), segs = [];
      for (let i = lo; i < hi; i++) segs.push(wt(i));
      const total = segs.reduce((a, b) => a + b, 0) || 1, dur = total * 3500, t0 = performance.now();
      const vAt = (k) => { let acc = k * total; for (let j = 0; j < segs.length; j++) { if (acc <= segs[j]) return (lo + j + acc / segs[j]) * 100; acc -= segs[j]; } return hi * 100; };
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        S.stageAnim = k < 1 ? requestAnimationFrame(step) : 0;
        const v = fromIdx <= toIdx ? vAt(k) : vAt(1 - k);
        if (S.onStageFrame) S.onStageFrame(k);
        $("secStageRange").value = v;
        setStageV(v);
      };
      S.stageAnim = requestAnimationFrame(step);
    };
    const stageStep = (dir) => {
      const list = secView.stages().map((x) => x.n);
      let i = list.indexOf(secView.stage);
      const done = (secView.stageT == null ? 1 : secView.stageT) >= 0.999;
      if (dir > 0) { const from = done ? i + 1 : i; if (from < list.length) playStage(from, from + 1); }
      else { const to = Math.max(0, done ? i - 1 : i - 1); setStageV((to + 1) * 100); }
    };
    $("secStage").onclick = () => {
      if (!secView) return;
      if (S.hideStrata) return flashHint("⚠ 「地下の地層をかくす」がオンの間は見られません。左のパネルのチェックを外してください");
      if (S.stageAnim) { cancelAnimationFrame(S.stageAnim); S.stageAnim = 0; }
      if (secView.stage > 0) { secView.stage = 0; secView.stageT = 1; secView.draw(); stageUI(); }
      else { secView.stage = secView.stages()[0].n; secView.stageT = 0; stageUI(); playStage(0, 1); }
    };
    $("secStageRange").oninput = () => { if (S.stageAnim) { cancelAnimationFrame(S.stageAnim); S.stageAnim = 0; } setStageV(+$("secStageRange").value); };
    $("secStagePlay").onclick = () => { const n = secView.stages().length; playStage(0, n); };
    // 🎥 動画で保存：はじめから通して再生しながら、断面図（年代・説明・火山の小窓つき）を録画する
    const recBtn = $("secStageRec");
    const stopRec = () => { if (S.rec && S.rec.mr.state !== "inactive") S.rec.mr.stop(); };
    recBtn.onclick = () => {
      if (S.rec) return stopRec();
      const src = $("secCanvas");
      const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
      const type = window.MediaRecorder && types.find((x) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x));
      if (!type || !src.captureStream) return alert("このブラウザでは動画の保存ができません。Safari・Chrome・Edge の新しい版でためしてください。");
      const W = src.width, head = Math.round(src.width * 0.09), H = src.height + head;
      const rc = document.createElement("canvas"); rc.width = W; rc.height = H + (H % 2); rc.width += W % 2;
      const g = rc.getContext("2d"), font = getComputedStyle(document.body).fontFamily;
      const drawFrame = () => {
        g.fillStyle = "#fff"; g.fillRect(0, 0, rc.width, rc.height);
        g.fillStyle = "#fffbef"; g.fillRect(0, 0, rc.width, head);
        const fs = Math.round(head * 0.26);
        g.fillStyle = "#9a5b00"; g.font = "bold " + Math.round(head * 0.42) + "px " + font; g.textAlign = "right";
        const yr = ($("secYear").textContent || "").trim(), yrW = g.measureText(yr).width;
        g.fillText(yr, W - fs, head * 0.52);
        g.textAlign = "left"; g.fillStyle = "#1f2a33"; g.font = "bold " + fs + "px " + font;
        const el = $("secStageText"), txt = el.classList.contains("hidden") ? "" : (el.querySelector(".st-text") || el).textContent;
        let ttl = "大地のでき方　" + S.site.title + "　断面" + ($("secInfo").textContent || "");
        while (ttl.length > 4 && g.measureText(ttl).width > W - yrW - fs * 2.5) ttl = ttl.slice(0, -2) + "…";
        g.fillText(ttl, fs * 0.6, fs * 1.3);
        g.font = fs * 0.9 + "px " + font;
        const maxW = W - yrW - fs * 2.5; let line = "", y = fs * 2.6;
        for (const ch of txt) { if (g.measureText(line + ch).width > maxW) { g.fillText(line, fs * 0.6, y); line = ""; y += fs * 1.1; if (y > head) break; } line += ch; }
        if (y <= head) g.fillText(line, fs * 0.6, y);
        g.drawImage(src, 0, head);
        const vc = document.querySelector("#volcanoBox:not(.hidden) canvas");
        if (vc) { const vw = W * 0.2, vh = vw * vc.height / vc.width; g.drawImage(vc, W - vw - fs, head + src.height - vh - fs * 2.4, vw, vh); g.strokeStyle = "#999"; g.strokeRect(W - vw - fs, head + src.height - vh - fs * 2.4, vw, vh); }
      };
      drawFrame();
      const mr = new MediaRecorder(rc.captureStream(30), { mimeType: type, videoBitsPerSecond: 6000000 });
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        cancelAnimationFrame(S.rec.raf); S.rec = null; S.onStageFrame = null;
        recBtn.textContent = "🎥 動画で保存"; recBtn.classList.remove("on");
        const blob = new Blob(chunks, { type: type.split(";")[0] });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = "大地のでき方-" + S.site.title + "-" + stamp() + (type.includes("mp4") ? ".mp4" : ".webm");
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        flashHint("🎥 動画を保存しました（" + Math.round(blob.size / 1024 / 1024 * 10) / 10 + "MB）");
      };
      S.rec = { mr, raf: 0 };
      const loop = () => { drawFrame(); S.rec.raf = requestAnimationFrame(loop); };
      loop();
      mr.start(500);
      recBtn.textContent = "⏹ 録画をやめる"; recBtn.classList.add("on");
      S.onStageFrame = (k) => { if (k >= 1) { S.onStageFrame = null; setTimeout(stopRec, 1500); } };
      const n = secView.stages().length; playStage(0, n);
    };
    $("secStagePrev").onclick = () => stageStep(-1);
    $("secStageNext").onclick = () => stageStep(1);
    // 考えメモ
    $("secMemoBtn").onclick = () => { $("secMemo").classList.toggle("hidden"); if (secView) secView.resize(); };
    for (const id of ["memoName", "memoPredict", "memoResult"]) $(id).addEventListener("input", saveMemo);
    // たての強調：×1（本当の形）〜自動
    const setSecVe = (v) => {
      store.set("chisou3d:secVe", v);
      document.querySelectorAll("#secVeBox button").forEach((b) => b.classList.toggle("on", b.dataset.ve === v));
      if (v !== "auto") { $("secVEx").value = v; $("secVExV").textContent = "×" + (+v).toFixed(1).replace(/\.0$/, ""); }
      else $("secVExV").textContent = "自動";
      if (secView) { secView.veFixed = v === "auto" ? 0 : parseFloat(v); secView.draw(); if (S.applySecZoom) S.applySecZoom(); }
    };
    document.querySelectorAll("#secVeBox button").forEach((b) => (b.onclick = () => setSecVe(b.dataset.ve)));
    // たての強調のスライダー：×1〜×10を指で自由に（ボタンと同じ設定を動かす）
    $("secVEx").oninput = () => setSecVe(String(Math.round($("secVEx").value * 10) / 10));
    // 横の倍率のスライダー：1倍〜1/10（長い断面図でも、地層が太く見える）
    const setSecHScale = (n) => {
      n = Math.max(1, Math.min(10, Math.round(n * 10) / 10));
      store.set("chisou3d:secHScale", n);
      $("secHScale").value = n;
      $("secHScaleV").textContent = n === 1 ? "1倍" : "1/" + n.toFixed(1).replace(/\.0$/, "");
      if (secView) { secView.hScale = 1 / n; secView.draw(); }
    };
    $("secHScale").oninput = () => setSecHScale(parseFloat($("secHScale").value));
    $("secVPan").oninput = () => { if (secView) { secView.vpan = $("secVPan").value / 1000; secView.vshift = 0; secView.draw(); } };
    S.setSecVe = setSecVe; S.setSecHScale = setSecHScale;
    S.applySecVe = () => { setSecHScale(store.get("chisou3d:secHScale", 1)); setSecVe(store.get("chisou3d:secVe", "auto")); };
    // 横に拡大：たての強調はそのままで、断面の一部を大きく見る（「本当の形」のまま5mの目盛りが読める）
    let secZoomSel = "1";
    const setSecZoom = (v) => {
      secZoomSel = v;
      document.querySelectorAll("#secZoomBox button").forEach((b) => b.classList.toggle("on", b.dataset.z === v));
      if (!secView) return;
      secView.zoom = v === "5m" ? secView.zoomFor5m(22) : parseFloat(v);
      secView.vshift = 0;
      $("secPan").classList.toggle("hidden", secView.zoom <= 1.01);
      secView.draw();
    };
    document.querySelectorAll("#secZoomBox button").forEach((b) => (b.onclick = () => setSecZoom(b.dataset.z)));
    $("secPan").oninput = () => { if (secView) { secView.pan = $("secPan").value / 1000; secView.draw(); } };
    // マウスのホイール（横スクロール・Shift＋ホイール）でも左右に動かせる
    $("secCanvas").addEventListener("wheel", (e) => {
      if (!secView || (secView.zoom <= 1.01 && !secView._vclip)) return;
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx && e.deltaY) {
        // ふつうのホイール：上下に動かす（たての幅がせまいとき）
        e.preventDefault();
        if (secView._vclip) {
          secView.vpan = Math.max(0, Math.min(1, (secView.vpan || 0) + e.deltaY / 1500));
          $("secVPan").value = Math.round(secView.vpan * 1000);
        } else secView.vshift = (secView.vshift || 0) - e.deltaY / 40;
        secView.draw();
        return;
      }
      if (!dx || secView.zoom <= 1.01) return;
      e.preventDefault();
      secView.pan = Math.max(0, Math.min(1, secView.pan + dx / 1500 / secView.zoom));
      $("secPan").value = Math.round(secView.pan * 1000);
      secView.draw();
    }, { passive: false });
    S.applySecZoom = () => setSecZoom(secZoomSel);
    $("secRedo").onclick = () => { clearSection(); setMode("section"); };
    $("secShowBores").onchange = () => { if (secView) { secView.showBores = $("secShowBores").checked; secView.draw(); } $("secBores").classList.toggle("dim", !$("secShowBores").checked); };
    $("secClear").onclick = () => { if (secView && confirm("かいた予想の線を全部消しますか？（柱や地層は消えません）")) secView.clear(); };
    $("secShowModel").parentElement.addEventListener("click", () => {
      if (S.hideStrata) flashHint("⚠ 「地下の地層をかくす」がオンの間は答え合わせできません。左のパネルのチェックを外してください");
    });
    S.secShowOthers = false; // 開くたびに「えらんだ柱状図だけ」から始める
    $("secOnlyChosen").onchange = () => { S.secShowOthers = $("secOnlyChosen").checked; openSectionSheet(); };
    $("secNames").onchange = () => { if (secView) { secView.showNames = $("secNames").checked; secView.draw(); } };
    $("secConnect").onchange = () => { if (secView) { secView.connect = $("secConnect").checked; secView.draw(); } };
    $("secShowModel").onchange = () => { if (secView) { secView.showModel = $("secShowModel").checked; secView.draw(); } };
    // 模型を切る（3Dだけ）
    $("cutFlip").onclick = () => {
      S.sectionFlip = !S.sectionFlip;
      applySectionClip();
      buildSectionRibbon();
      const t = controls.target, off = camera.position.clone().sub(t);
      camera.position.set(t.x - off.x, camera.position.y, t.z - off.z);
    };
    $("cutSheet").onclick = () => {
      // 切ったまま、断面図（2D）モードへ
      S.mode = "section";
      document.querySelectorAll("#modebar button[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === "section"));
      $("cutBar").classList.add("hidden");
      S.sectionPts = S.section.pts.slice();
      openSectionSheet();
      setHint("");
    };
    const setCutOpt = (k, id) => { $(id).checked = S[k]; $(id).onchange = () => { S[k] = $(id).checked; store.set("chisou3d:" + k, S[k]); buildSectionRibbon(); }; };
    setCutOpt("cutNoData", "cutNoData");
    setCutOpt("cutReal", "cutReal");
    $("cutRedo").onclick = () => { clearSection(); S.sectionPts = []; updateMarkers(); $("cutGuideBar").classList.remove("hidden"); syncCutGuideUI(); buildCutGuide(); setHint(modeHint()); };
    // 切る線（赤いガイド）の向き・位置・切る
    $("cutAng").oninput = () => { S.cutGuide.ang = (+$("cutAng").value * Math.PI) / 180; syncCutGuideUI(); buildCutGuide(); };
    $("cutOff").oninput = () => { S.cutGuide.off = (+$("cutOff").value / 100) * S.site.half; syncCutGuideUI(); buildCutGuide(); };
    $("cutGo").onclick = () => { const e = cutGuideEnds(); if (e) makeSection(e); };
    $("cutGuideEnd").onclick = () => setMode("view");
    $("cutEnd").onclick = () => setMode("view");
    // 柱をえらんで断面
    $("pickUndo").onclick = () => { S.pickIds.pop(); updatePickBar(); };
    $("pickClear").onclick = () => { S.pickIds = []; updatePickBar(); };
    $("pickOk").onclick = () => {
      if (S.pickIds.length < 2) return;
      const pts = S.sectionPts.slice();
      S.mode = "section";
      document.querySelectorAll("#modebar button[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === "section"));
      $("pickBar").classList.add("hidden");
      S.pickIds = [];
      S.sectionPts = pts;
      makeSection(pts.slice());
    };
    $("secFlip").onclick = () => {
      S.sectionFlip = !S.sectionFlip;
      applySectionClip();
      buildSectionRibbon();
      if (secView) { secView.reversed = S.sectionFlip; secView.draw(); }
      // カメラも反対側へ
      const t = controls.target, off = camera.position.clone().sub(t);
      camera.position.set(t.x - off.x, camera.position.y, t.z - off.z);
    };
    $("secSave").onclick = saveSectionImage;

    // メモ
    const colors = ["#ffd54f", "#ff9eb5", "#a5e3a0", "#9fd3ff"];
    colors.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.style.background = c;
      if (i === 0) b.classList.add("active");
      b.onclick = () => { S.noteColor = c; $("noteColors").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); };
      $("noteColors").appendChild(b);
    });
    // 写真つきメモ：写真は小さくしてから保存する（長い辺 900px）
    let notePhotoData = null;
    $("notePhoto").onchange = () => {
      const f = $("notePhoto").files[0];
      notePhotoData = null; $("notePhotoPrev").innerHTML = "";
      if (!f) return;
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => {
        const k = Math.min(1, 900 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        notePhotoData = cv.toDataURL("image/jpeg", 0.72);
        $("notePhotoPrev").innerHTML = '<img src="' + notePhotoData + '" alt="">';
        URL.revokeObjectURL(url);
      };
      img.src = url;
    };
    $("noteDialog").addEventListener("close", () => {
      if ($("noteDialog").returnValue !== "ok" || !noteTarget) return;
      const text = $("noteText").value.trim();
      if (!text) return;
      const author = $("noteAuthor").value.trim();
      store.set("chisou3d:author", author);
      const nt = { id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), x: noteTarget.x, z: noteTarget.z, text, author, color: S.noteColor, time: Date.now() };
      if (notePhotoData) nt.photo = notePhotoData;
      S.notes.push(nt);
      store.set(key("notes"), S.notes);
      if (nt.photo && JSON.stringify(store.get(key("notes"), [])).indexOf(nt.id) < 0) {
        // 端末の保存場所がいっぱい：写真なしで保存し直す
        delete nt.photo; store.set(key("notes"), S.notes);
        alert("この端末の保存場所がいっぱいで、写真を保存できませんでした。メモの文字だけ保存しました。（「メモを書き出す」で保存してから古いメモを消すと、あきができます）");
      }
      buildNotes();
    });
    $("btnNotesList").onclick = showNotesList;
    $("btnShot").onclick = () => { renderer.render(scene, camera); download("土地模型-" + stamp() + ".png", renderer.domElement.toDataURL("image/png")); };

    // ボーリング入力
    $("bAddRow").onclick = () => addLogRow();
    $("bDelete").onclick = deleteBore;
    $("boreDialog").addEventListener("close", () => { if ($("boreDialog").returnValue === "ok") saveBoreDialog(); });

    // 書き出し・読み込み
    $("btnExport").onclick = () => openIO("export");
    $("btnImport").onclick = () => openIO("import");
    $("ioDownload").onclick = () => download("chisou3d-" + S.site.id + "-" + stamp() + ".json", $("ioText").value);
    $("ioLoad").onclick = () => doImport($("ioText").value);
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.onchange = async () => { if (file.files[0]) $("ioText").value = await file.files[0].text(); };
    const fbtn = document.createElement("button");
    fbtn.type = "button";
    fbtn.textContent = "ファイルを選ぶ";
    fbtn.onclick = () => file.click();
    $("ioLoad").before(fbtn);
    fbtn.classList.add("io-file");
    $("ioDialog").addEventListener("close", () => {});
    const origOpen = openIO;
    openIO = function (m) { origOpen(m); fbtn.classList.toggle("hidden", m !== "import"); };

    buildLegend();
  }

  // テスト・デバッグ用
  // ================= 先生→子ども：設定つきリンク ／ 子ども→先生：Googleフォームで送る =================
  const b64u = {
    enc: (bytes) => { let t = ""; for (const b of bytes) t += String.fromCharCode(b); return btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
    dec: (str) => { const t = atob(str.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(t, (c) => c.charCodeAt(0)); },
  };
  async function packState(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (window.CompressionStream) {
      try {
        const buf = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
        return "z" + b64u.enc(new Uint8Array(buf));
      } catch (e) { /* ちぢめられないときは そのまま */ }
    }
    return "j" + b64u.enc(raw);
  }
  async function unpackState(str) {
    const kind = str[0], bytes = b64u.dec(str.slice(1));
    let raw = bytes;
    if (kind === "z") raw = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    return JSON.parse(new TextDecoder().decode(raw));
  }
  async function readShared() {
    const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try { return await unpackState(m[1]); } catch (e) { console.warn("リンクを読めませんでした", e); return null; }
  }
  const R1 = (v) => Math.round(v * 10) / 10;
  /** 予想の線を短くする（近すぎる点を省いて、0.1m単位に） */
  function packStrokes(strokes) {
    return strokes.map((st) => {
      const out = [];
      let last = null;
      const minGap = Math.max(2, (S.section ? S.section.length : 500) / 400);
      st.pts.forEach((p, i) => {
        if (!last || i === st.pts.length - 1 || Math.hypot(p[0] - last[0], (p[1] - last[1]) * 5) > minGap) { out.push([Math.round(p[0]), R1(p[1])]); last = p; }
      });
      return { c: st.color, p: out };
    });
  }
  /** いまの見え方を、リンクに入れる形にまとめる */
  function captureState(o) {
    o = o || {};
    const st = { v: 1, site: S.site.id, r: S.site.half, map: S.mapType, relief: S.relief,
      cam: [camera.position.x, camera.position.y, camera.position.z, controls.target.x, controls.target.y, controls.target.z].map(Math.round) };
    if (S.section) {
      st.mode = S.mode === "cut" ? "cut" : "section";
      st.pts = S.section.pts.map((p) => [Math.round(p.x), Math.round(p.z)].concat(p.boreId ? [p.boreId] : []));
      if (S.sectionFlip) st.flip = 1;
      st.ve = store.get("chisou3d:secVe", "auto");
      const hs = store.get("chisou3d:secHScale", 1); if (hs !== 1) st.hs = hs;
      if (S.secExtent === "full") st.ext = "full";
      if ($("secConnect").checked) st.conn = 1;
      if ($("secShowModel").checked) st.model = 1;
      if (!$("secNames").checked) st.nonames = 1;
    }
    if (S.hiddenBores.size) st.hid = [...S.hiddenBores];
    if (Object.keys(S.boreMarks).length) st.marks = S.boreMarks;
    if (S.peel) { st.peel = [...S.peeled]; st.pm = S.peelMode; }
    if (S.showRivers) st.riv = 1;
    if (S.showYato) st.yato = 1;
    if (S.lift) st.lift = 1;
    if (o.strokes && secView && secView.strokes.length) st.strokes = packStrokes(secView.strokes);
    if (o.memo) st.memo = { name: $("memoName").value, predict: $("memoPredict").value, result: $("memoResult").value };
    if (o.kid) st.kid = o.kid;
    if (o.form && S.formCfg) st.form = S.formCfg;
    return st;
  }
  const setChk = (id, v) => { const el = $(id); if (el && el.checked !== !!v) { el.checked = !!v; el.dispatchEvent(new Event("change")); } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /** リンクの中身を、画面にあてはめる */
  async function applyShared(st) {
    if (st.form) S.formCfg = st.form; // 子どもの画面にも送り先を
    if (st.kid) {
      S.kid = st.kid;
      document.querySelectorAll(".teacher-switch, #teacherTools").forEach((e) => e.classList.add("hidden"));
      if (st.kid.lock) {
        S.answerLocked = true;
        $("secShowModel").disabled = true;
        $("secShowModel").parentElement.dataset.tip = "先生が答え合わせを止めています";
        $("secStage").disabled = true;
      }
    }
    if (st.map && st.map !== S.mapType) await setMap(st.map);
    if (st.relief && st.relief !== S.relief) setRelief(st.relief);
    setChk("chkRiver", st.riv);
    if (!$("chkYato").parentElement.classList.contains("hidden")) setChk("chkYato", st.yato);
    setChk("chkLift", st.lift);
    if (st.marks) { S.boreMarks = Object.assign({}, st.marks); }
    S.hiddenBores = new Set(st.hid || []);
    if (st.pm) S.peelMode = st.pm;
    setPeeled(new Set(st.peel || []));
    updatePeelLabel();
    buildAll();
    if (st.hs && S.setSecHScale) S.setSecHScale(+st.hs);
    if (st.ve && S.setSecVe) S.setSecVe(String(st.ve));
    if (st.ext) { const b = document.querySelector('#secExtentBox [data-ext="' + st.ext + '"]'); if (b) b.click(); }
    if (st.pts && st.pts.length >= 2) {
      setMode(st.mode === "cut" ? "cut" : "section");
      const pts = st.pts.map((a) => ({ x: a[0], z: a[1], boreId: a[2] }));
      S.sectionPts = pts.slice();
      makeSection(pts.slice());
      if (st.flip) $(st.mode === "cut" ? "cutFlip" : "secFlip").click();
      if (st.mode !== "cut") {
        await wait(250);
        setChk("secConnect", st.conn);
        if (!S.answerLocked) setChk("secShowModel", st.model);
        setChk("secNames", !st.nonames);
        if (st.strokes && secView) {
          secView.strokes = st.strokes.map((k) => ({ color: k.c, pts: k.p }));
          secView.draw();
        }
        if (st.memo) {
          $("memoName").value = st.memo.name || ""; $("memoPredict").value = st.memo.predict || ""; $("memoResult").value = st.memo.result || "";
          $("secMemo").classList.remove("hidden"); secView && secView.resize();
        }
      }
    }
    if (st.cam) {
      camera.position.set(st.cam[0], st.cam[1], st.cam[2]);
      controls.target.set(st.cam[3], st.cam[4], st.cam[5]);
      controls.update();
    }
    if (st.memo && st.memo.name) flashHint("📮 " + st.memo.name + " さんが送った予想です");
    else if (st.kid) flashHint("🔗 先生が準備した画面から始まります");
  }
  function baseUrl() { const u = new URL(location.href); u.hash = ""; return u.href; }

  /** 送り先のGoogleフォーム：「事前入力したURL」から、どの質問に何を入れるかを読みとる */
  function parseFormUrl(url) {
    let u;
    try { u = new URL(url.trim()); } catch (e) { return null; }
    if (!/docs\.google\.com$/.test(u.hostname) || !/\/forms\//.test(u.pathname)) return null;
    const f = {};
    for (const [k, v] of u.searchParams) {
      if (!/^entry\.\d+$/.test(k)) continue;
      const t = v.trim().toUpperCase();
      if (/NAME|なまえ|名前/.test(t)) f.name = k; else if (/PREDICT|予想/.test(t)) f.predict = k; else if (/RESULT|分か/.test(t)) f.result = k; else if (/LINK|リンク/.test(t)) f.link = k;
    }
    if (!f.link) return null;
    return { url: u.origin + u.pathname.replace(/\/(formResponse|viewform)$/, "") + "/viewform", f };
  }
  async function sendToTeacher() {
    const cfg = S.formCfg;
    if (!cfg) return alert("送り先がまだ決まっていません。先生に聞いてください。");
    if (!$("memoName").value.trim()) { $("secMemo").classList.remove("hidden"); secView && secView.resize(); $("memoName").focus(); return flashHint("📝 名前・班を書いてから送ってね"); }
    saveMemo();
    const st = captureState({ strokes: true, memo: true });
    const link = baseUrl() + "#k=" + (await packState(st));
    const u = new URL(cfg.url);
    u.searchParams.set("usp", "pp_url");
    if (cfg.f.name) u.searchParams.set(cfg.f.name, $("memoName").value);
    if (cfg.f.predict) u.searchParams.set(cfg.f.predict, $("memoPredict").value);
    if (cfg.f.result) u.searchParams.set(cfg.f.result, $("memoResult").value);
    u.searchParams.set(cfg.f.link, link);
    window.open(u.href, "_blank");
    flashHint("📮 フォームが開きます。いちばん下の「送信」をおしてね");
  }
  async function openShareDialog() {
    S.formCfg = S.formCfg || store.get("chisou3d:formCfg", null);
    $("shareFormUrl").value = S.formCfg ? S.formCfg.src || "" : "";
    $("shareFormState").textContent = S.formCfg ? "✅ 送り先のフォームが決まっています" : "（まだ決まっていません。下の手順でフォームを作って、URLをはりつけてください）";
    $("shareOut").value = "";
    $("shareFileNote").classList.toggle("hidden", location.protocol !== "file:");
    $("shareDialog").showModal();
  }
  async function makeKidLink() {
    const st = captureState({ strokes: $("shareStrokes").checked, kid: { lock: $("shareLock").checked ? 1 : 0 }, form: true });
    $("shareOut").value = baseUrl() + "#k=" + (await packState(st));
    $("shareOut").select();
  }
  function initShare() {
    S.formCfg = store.get("chisou3d:formCfg", null);
    $("btnShare").onclick = openShareDialog;
    $("shareMake").onclick = makeKidLink;
    $("shareCopy").onclick = async () => {
      if (!$("shareOut").value) await makeKidLink();
      try { await navigator.clipboard.writeText($("shareOut").value); flashHint("📋 リンクをコピーしました"); } catch (e) { $("shareOut").select(); document.execCommand("copy"); flashHint("📋 リンクをコピーしました"); }
    };
    $("shareFormSave").onclick = () => {
      const v = $("shareFormUrl").value.trim();
      if (!v) { S.formCfg = null; store.set("chisou3d:formCfg", null); $("shareFormState").textContent = "送り先を消しました"; return; }
      const cfg = parseFormUrl(v);
      if (!cfg) { $("shareFormState").textContent = "⚠ 読みとれませんでした。フォームの「事前入力したURLを取得」で作ったURLか、LINK と書いた質問があるか確かめてください"; return; }
      cfg.src = v;
      S.formCfg = cfg; store.set("chisou3d:formCfg", cfg);
      $("shareFormState").textContent = "✅ 送り先を決めました（名前" + (cfg.f.name ? "○" : "×") + "・予想" + (cfg.f.predict ? "○" : "×") + "・分かったこと" + (cfg.f.result ? "○" : "×") + "・リンク○）";
    };
    $("secSend").onclick = sendToTeacher;
  }

  // ---------- 遠くの火山（大地のでき方③で出す。ドラッグで動かせる小さな窓） ----------
  let volEl = null, volState = null, volUserClosed = false;
  function volcanoBox(v) {
    volState = v;
    if (!v) { volUserClosed = false; if (volEl) volEl.classList.add("hidden"); return; }
    if (volUserClosed) return;
    if (!volEl) {
      volEl = document.createElement("div");
      volEl.id = "volcanoBox";
      volEl.innerHTML = '<div class="vb-head">🌋 遠くの火山 <small>（ドラッグで動かせます）</small><button type="button" class="vb-close" title="閉じる">✕</button></div><canvas width="640" height="400"></canvas><div class="vb-foot">富士山・箱根などの火山から、火山灰が風で運ばれてきた</div>';
      document.body.appendChild(volEl);
      volEl.querySelector(".vb-close").addEventListener("pointerdown", (e) => e.stopPropagation());
      volEl.querySelector(".vb-close").onclick = () => { volUserClosed = true; volEl.classList.add("hidden"); };
      const pos = store.get("chisou3d:volcanoPos", null);
      if (pos) { volEl.style.left = Math.min(pos.x, window.innerWidth - 120) + "px"; volEl.style.top = Math.min(pos.y, window.innerHeight - 80) + "px"; }
      else {
        // はじめは、断面図のシートの すぐ上（右がわ）に置く。場所がなければ左上
        const sh = $("sectionSheet").getBoundingClientRect(), h = volEl.offsetHeight || 260;
        const top = sh.top - h - 8;
        if (top >= 60) { volEl.style.right = "90px"; volEl.style.top = top + "px"; }
        else {
          // シートが大きいとき：断面図の右下（いちばん下の古い地層の上。動きの少ない所）に置く
          const cr = $("secCanvas").getBoundingClientRect();
          // 川のある側とは反対に置く（川の動きがかくれないように）
          const dd = secView && secView.data, rv = dd && dd.rivers && dd.rivers[0];
          let rf = rv ? rv.d / dd.length : 1; if (S.sectionFlip) rf = 1 - rf;
          if (rf > 0.5) volEl.style.left = cr.left + 64 + "px";
          else volEl.style.right = Math.max(8, window.innerWidth - cr.right + 56) + "px";
          volEl.style.top = Math.max(60, cr.bottom - h - 30) + "px";
        }
      }
      let drag = null;
      volEl.addEventListener("pointerdown", (e) => { const r = volEl.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; volEl.setPointerCapture(e.pointerId); e.preventDefault(); });
      volEl.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const x = Math.max(0, Math.min(window.innerWidth - volEl.offsetWidth, e.clientX - drag.dx)), y = Math.max(0, Math.min(window.innerHeight - volEl.offsetHeight, e.clientY - drag.dy));
        volEl.style.left = x + "px"; volEl.style.top = y + "px"; volEl.style.right = "auto";
      });
      const end = () => { if (!drag) return; drag = null; const r = volEl.getBoundingClientRect(); store.set("chisou3d:volcanoPos", { x: Math.round(r.left), y: Math.round(r.top) }); };
      volEl.addEventListener("pointerup", end); volEl.addEventListener("pointercancel", end);
      const cv = volEl.querySelector("canvas"), ctx = cv.getContext("2d");
      const frame = () => {
        requestAnimationFrame(frame);
        if (volEl.classList.contains("hidden")) return;
        const c = performance.now() / 1000, on = volState && volState.active;
        ctx.setTransform(640 / 360, 0, 0, 400 / 220, 0, 0);
        ctx.clearRect(0, 0, 360, 220);
        const g = ctx.createLinearGradient(0, 0, 0, 220); g.addColorStop(0, "#dfeefa"); g.addColorStop(1, "#f6f1e3");
        ctx.fillStyle = g; ctx.fillRect(0, 0, 360, 220);
        // 火山
        ctx.fillStyle = "#8d6e63"; ctx.beginPath(); ctx.moveTo(40, 200); ctx.lineTo(150, 95); ctx.lineTo(180, 95); ctx.lineTo(290, 200); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#6d4c41"; ctx.beginPath(); ctx.moveTo(150, 95); ctx.lineTo(165, 120); ctx.lineTo(180, 95); ctx.fill();
        ctx.fillStyle = "#7c9a5e"; ctx.fillRect(0, 196, 360, 24);
        if (on) {
          ctx.fillStyle = "#ff6d00"; ctx.beginPath(); ctx.moveTo(150, 96); ctx.lineTo(165, 70 - 10 * Math.abs(Math.sin(c * 5))); ctx.lineTo(180, 96); ctx.fill();
          for (let k = 0; k < 14; k++) {
            const ph = (k / 14 + c * 0.15) % 1, r = 8 + ph * 34;
            ctx.globalAlpha = 0.6 * (1 - ph); ctx.fillStyle = "#5f5f5f";
            ctx.beginPath(); ctx.arc(165 + ph * 170, 80 - ph * 55 + Math.sin(k * 1.7) * 6, r, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1; ctx.fillStyle = "rgba(110,60,30,0.7)";
          for (let k = 0; k < 40; k++) { const ph = (k * 0.37 + c * 0.5) % 1; ctx.beginPath(); ctx.arc(200 + ((k * 53) % 150), 40 + ph * 160, 1.6, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = "#8a3b12"; ctx.font = 'bold 18px "BIZ UDPGothic","Meiryo",sans-serif'; ctx.fillText("ふん火中！ 火山灰 → 風で運ばれる ➜", 12, 28);
        } else {
          ctx.fillStyle = "#5a6873"; ctx.font = 'bold 18px "BIZ UDPGothic","Meiryo",sans-serif'; ctx.fillText("いまは しずか（ふん火していない）", 12, 28);
        }
      };
      requestAnimationFrame(frame);
    }
    volEl.classList.remove("hidden");
  }

  window.__chisou = { S, setMode, makeSection, showBore, showYato, get secView() { return secView; }, get camera() { return camera; }, get controls() { return controls; } };
})();
