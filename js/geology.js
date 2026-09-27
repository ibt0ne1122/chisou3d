/*
 * geology.js — ボーリング資料から「地下の地層の広がり」を推定する
 *
 * 層の種類（mode）
 *   "cover"   : 地面をおおう層（関東ローム層・盛土など）。厚さをボーリングから推定し、地形に沿わせる
 *   "valley"  : 谷を埋める層（沖積層）。谷底の低い所だけに、ボーリングから推定した厚さでたまる
 *   "surface" : 広がって積み重なった層（ねんど・砂・れき・泥岩など）。層の境目の「標高」を推定し、
 *               谷などで削られた所は地形で切り取る
 *
 * 推定のしかた: 境目の標高は「平面（ゆるいかたむき）＋近いボーリングほど強く効く補正（IDW）」で広げる。
 */
(function () {
  const C = (window.CHISOU = window.CHISOU || {});

  function idwFactory(points, power) {
    power = power || 2;
    return function (x, z) {
      if (!points.length) return 0;
      let sw = 0, sv = 0;
      for (const p of points) {
        const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d2 < 1) return p.v;
        const w = 1 / Math.pow(d2, power / 2);
        sw += w;
        sv += w * p.v;
      }
      return sv / sw;
    };
  }

  function planeFit(points) {
    const n = points.length;
    if (n === 0) return null;
    const mean = points.reduce((s, p) => s + p.v, 0) / n;
    if (n < 3) return { a: mean, b: 0, c: 0 };
    // 最小二乗法 v = a + b x + c z
    let sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, sv = 0, sxv = 0, szv = 0;
    for (const p of points) {
      sx += p.x; sz += p.z; sxx += p.x * p.x; szz += p.z * p.z; sxz += p.x * p.z;
      sv += p.v; sxv += p.x * p.v; szv += p.z * p.v;
    }
    const M = [[n, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]];
    const V = [sv, sxv, szv];
    const det = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M);
    if (Math.abs(D) < 1e-6 * Math.pow(n * (sxx + szz) + 1, 1.5)) return { a: mean, b: 0, c: 0 };
    const col = (k) => M.map((row, i) => row.map((v, j) => (j === k ? V[i] : v)));
    const a = det(col(0)) / D, b = det(col(1)) / D, c = det(col(2)) / D;
    // 極端なかたむき（ボーリングが一列に並んでいる時など）はやめて水平にする
    if (Math.hypot(b, c) > 0.2) return { a: mean, b: 0, c: 0 };
    return { a, b, c };
  }

  /** 境目の標高を推定する関数：平面＋IDWでの残差補正 */
  function surfaceInterp(points) {
    if (!points.length) return null;
    const pl = planeFit(points);
    const res = points.map((p) => ({ x: p.x, z: p.z, v: p.v - (pl.a + pl.b * p.x + pl.c * p.z) }));
    const idw = idwFactory(res, 2);
    return (x, z) => pl.a + pl.b * x + pl.c * z + idw(x, z);
  }

  /** site の boreholes を、模型の座標・標高つきに整える */
  function prepareBoreholes(list, layers, frame, groundAt) {
    const ids = new Set(layers.map((l) => l.id));
    return list.map((b) => {
      const loc = frame.toLocal(b.lat, b.lon);
      const demElev = groundAt(loc.x, loc.z);
      const elev = typeof b.elevation === "number" ? b.elevation : demElev;
      let from = 0;
      const segs = (b.logs || []).map((s) => {
        const seg = { from, to: Number(s.to), layer: ids.has(s.layer) ? s.layer : null, soil: s.soil || "", n: s.n, note: s.note || "" };
        from = seg.to;
        return seg;
      });
      return Object.assign({}, b, { x: loc.x, z: loc.z, elev, demElev, segs, depth: from });
    });
  }

  /**
   * 仮データ（サンプル）のボーリングをつくる。
   * 実際の地形の高さを使い、「水平に積み重なった地層を川が削り、谷に土砂がたまった」という
   * 考え方で、それぞれの場所の柱状図を計算する。
   */
  function makeSampleBoreholes(sample, frame, groundAt, stats) {
    const lo = stats.p05, R = Math.max(5, stats.p95 - stats.p05);
    const out = [];
    let k = 0;
    for (const p of sample.points) {
      k++;
      let lat = p.lat, lon = p.lon;
      if (lat == null) {
        const ll = frame.toLatLon(p.east || 0, -(p.north || 0));
        lat = ll.lat; lon = ll.lon;
      }
      const loc = frame.toLocal(lat, lon);
      const G = groundAt(loc.x, loc.z);
      if (isNaN(G)) continue;
      const tilt = ((sample.dipEastPerKm || 0) * loc.x + (sample.dipNorthPerKm || 0) * -loc.z) / 1000;
      const logs = [];
      let d = 0;
      const push = (thick, layer, soil) => {
        if (thick < 0.2) return;
        d += thick;
        logs.push({ to: Math.round(d * 10) / 10, layer, soil });
      };
      if (sample.fill && G < lo + sample.fill.belowFrac * R) push(sample.fill.thick, sample.fill.layer, sample.fill.soil);
      const al = sample.alluvium;
      if (al) {
        const f = Math.min(1, Math.max(0, (lo + al.belowFrac * R - G) / (al.belowFrac * R * 0.5)));
        push(al.maxThick * f, al.layer, al.soil);
      }
      const lm = sample.loam;
      if (lm) {
        const f = Math.min(1, Math.max(0, (G - (lo + lm.aboveFrac * R)) / (0.15 * R)));
        push(lm.maxThick * f, lm.layer, lm.soil);
      }
      // 地層：上から順に、それぞれの「下面の標高」まで
      let cur = G - d;
      const bottomElev = lo - (sample.depthBelowLow || 10);
      sample.strata.forEach((st, i) => {
        const last = i === sample.strata.length - 1;
        const bot = last ? bottomElev : Math.max(bottomElev, lo + st.bottomFrac * R + tilt);
        if (cur > bot) { push(cur - bot, st.layer, st.soil); cur = bot; }
      });
      out.push({
        id: "sample-" + k,
        name: p.name || "仮のボーリング" + k,
        lat, lon,
        sample: true,
        source: sample.source || "仮データ（考え方を示すための架空の資料）",
        note: sample.note || "",
        logs,
      });
    }
    return out;
  }

  /**
   * 格子の各点について、各層の上面・下面の標高を計算する
   * grid: { n, half, ground: Float32Array((n+1)^2) }
   */
  function buildModel(layers, grid, bores, opts) {
    opts = opts || {};
    const n = grid.n, N = (n + 1) * (n + 1), step = (2 * grid.half) / n;
    const L = layers.length;
    const idx = {};
    layers.forEach((l, i) => (idx[l.id] = i));
    const surfIdx = layers.map((l, i) => (l.mode === "surface" ? i : -1)).filter((i) => i >= 0);
    const surfPos = {};
    surfIdx.forEach((li, s) => (surfPos[li] = s));

    // --- ボーリングから観測値を集める ---
    const coverObs = {}; // layerId -> [{x,z,v:厚さ}]
    const valleyTop = {}, valleyThick = {};
    const bndExact = surfIdx.map(() => []); // s番目の地層の「上面」の標高（s>=1）
    const bndApprox = surfIdx.map(() => []);
    for (const b of bores) {
      if (!b.segs.length || isNaN(b.elev)) continue;
      for (const l of layers) {
        if (l.mode === "cover") {
          const t = b.segs.filter((s) => s.layer === l.id).reduce((a, s) => a + (s.to - s.from), 0);
          (coverObs[l.id] = coverObs[l.id] || []).push({ x: b.x, z: b.z, v: t });
        } else if (l.mode === "valley") {
          const ss = b.segs.filter((s) => s.layer === l.id);
          if (ss.length) {
            const t = ss.reduce((a, s) => a + (s.to - s.from), 0);
            (valleyTop[l.id] = valleyTop[l.id] || []).push({ x: b.x, z: b.z, v: b.elev - ss[0].from });
            (valleyThick[l.id] = valleyThick[l.id] || []).push({ x: b.x, z: b.z, v: t });
          }
        }
      }
      // 地層（surface）の境目
      let prevSurf = -1; // 直前に通った地層の番号(s)
      let prevWasCover = true;
      for (const seg of b.segs) {
        const li = seg.layer == null ? -1 : idx[seg.layer];
        const isSurf = li >= 0 && layers[li].mode === "surface";
        if (!isSurf) { if (prevSurf < 0) prevWasCover = true; continue; }
        const s = surfPos[li];
        const e = b.elev - seg.from;
        if (prevSurf >= 0 && s > prevSurf) {
          for (let k = prevSurf + 1; k <= s; k++) bndExact[k].push({ x: b.x, z: b.z, v: e });
        } else if (prevSurf < 0 && prevWasCover) {
          for (let k = 1; k <= s; k++) bndApprox[k].push({ x: b.x, z: b.z, v: e });
        }
        if (s > prevSurf) prevSurf = s;
      }
    }
    const coverI = {}, valleyTopI = {}, valleyThickI = {};
    for (const id in coverObs) {
      // 「その層があるか・ないか」を先に近くのボーリングから決め（ない所は0）、
      // ある所では、その層があったボーリングだけから厚さを決める
      const pts = coverObs[id];
      const present = pts.filter((p) => p.v > 0.05);
      const has = idwFactory(pts.map((p) => ({ x: p.x, z: p.z, v: p.v > 0.05 ? 1 : 0 })), 3);
      const thick = idwFactory(present, 2);
      coverI[id] = present.length ? (x, z) => {
        const h = has(x, z);
        const f = h <= 0.35 ? 0 : h >= 0.55 ? 1 : (h - 0.35) / 0.2;
        return f ? thick(x, z) * f : 0;
      } : () => 0;
    }
    for (const id in valleyTop) { valleyTopI[id] = surfaceInterp(valleyTop[id]); valleyThickI[id] = idwFactory(valleyThick[id], 2); }
    const bndI = bndExact.map((pts, s) => (s === 0 ? null : surfaceInterp(pts.length ? pts : bndApprox[s])));

    // --- 模型の底の標高 ---
    let gmin = Infinity;
    for (let i = 0; i < N; i++) if (grid.ground[i] < gmin) gmin = grid.ground[i];
    let bmin = Infinity;
    for (const b of bores) if (!isNaN(b.elev)) bmin = Math.min(bmin, b.elev - b.depth);
    let base = typeof opts.baseElevation === "number" ? opts.baseElevation : Math.floor((Math.min(gmin - 15, bmin - 5)) / 5) * 5;

    const tops = layers.map(() => new Float32Array(N));
    const bots = layers.map(() => new Float32Array(N));
    // けずられる前の地層の境目（「大地のでき方を再生」で使う）：rawB[s] は s番目の地層の上面
    const rawB = surfIdx.map(() => new Float32Array(N));
    const eros = new Float32Array(N);
    const tol = opts.valleyTolerance != null ? opts.valleyTolerance : 2;
    const fadeW = opts.valleyFade != null ? opts.valleyFade : 4;
    const B = new Float64Array(surfIdx.length + 1);

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const k = j * (n + 1) + i;
        const x = -grid.half + i * step, z = -grid.half + j * step;
        const G = grid.ground[k];
        let cur = G;
        for (let li = 0; li < L; li++) {
          const l = layers[li];
          if (l.mode === "surface") continue;
          let t = 0;
          if (l.mode === "cover" && coverI[l.id]) t = Math.max(0, coverI[l.id](x, z));
          if (l.mode === "valley" && valleyTopI[l.id]) {
            const d = G - valleyTopI[l.id](x, z);
            const f = d <= tol ? 1 : d >= tol + fadeW ? 0 : 1 - (d - tol) / fadeW;
            t = Math.max(0, valleyThickI[l.id](x, z)) * f;
          }
          t = Math.min(t, Math.max(0, cur - base));
          tops[li][k] = cur;
          bots[li][k] = cur - t;
          cur -= t;
        }
        const E = cur; // 削られた面（地層の最上面）
        // 境目の標高（上から順に、下の境目ほど低くなるように）
        B[0] = Infinity;
        for (let s = 1; s < surfIdx.length; s++) B[s] = bndI[s] ? bndI[s](x, z) : NaN;
        B[surfIdx.length] = -Infinity;
        for (let s = surfIdx.length - 1; s >= 1; s--) if (isNaN(B[s])) B[s] = B[s + 1];
        for (let s = 1; s < surfIdx.length; s++) B[s] = Math.min(B[s], B[s - 1]);
        eros[k] = E;
        for (let s = 1; s < surfIdx.length; s++) rawB[s][k] = Math.max(base, isFinite(B[s]) ? B[s] : base);
        for (let s = 0; s < surfIdx.length; s++) {
          const li = surfIdx[s];
          const top = Math.max(base, Math.min(E, B[s]));
          const bot = s === surfIdx.length - 1 ? base : Math.max(base, Math.min(E, B[s + 1]));
          tops[li][k] = top;
          bots[li][k] = Math.min(top, bot);
        }
      }
    }
    return { layers, n, half: grid.half, step, ground: grid.ground, tops, bots, base, rawB, eros, surfIdx };
  }

  /** 模型の任意の点(x,z)での地面・各層の上面/下面（格子から双線形補間） */
  function sampleModel(model, x, z) {
    const n = model.n;
    let fi = (x + model.half) / model.step, fj = (z + model.half) / model.step;
    fi = Math.min(n, Math.max(0, fi)); fj = Math.min(n, Math.max(0, fj));
    const i0 = Math.min(n - 1, Math.floor(fi)), j0 = Math.min(n - 1, Math.floor(fj));
    const di = fi - i0, dj = fj - j0;
    const k00 = j0 * (n + 1) + i0, k10 = k00 + 1, k01 = k00 + n + 1, k11 = k01 + 1;
    const f = (a) => a[k00] * (1 - di) * (1 - dj) + a[k10] * di * (1 - dj) + a[k01] * (1 - di) * dj + a[k11] * di * dj;
    return { g: f(model.ground), tops: model.tops.map(f), bots: model.bots.map(f), rawB: model.rawB.map(f), eros: f(model.eros) };
  }

  C.Geology = { prepareBoreholes, makeSampleBoreholes, buildModel, sampleModel, idwFactory, surfaceInterp };
})();
