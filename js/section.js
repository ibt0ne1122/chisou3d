/*
 * section.js — 断面図（2D）
 *  ・地形の線とボーリングの柱をかく
 *  ・子どもがペンで「地層のつながりの予想」をかける
 *  ・「模型の地層を見る」で、推定した地層を重ねて答え合わせ
 */
(function () {
  const C = (window.CHISOU = window.CHISOU || {});

  class SectionView {
    constructor(canvas, opts) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.opts = opts || {};
      this.data = null;
      this.strokes = [];
      this.showModel = false;
      this.reversed = false;
      this.showBores = true;
      this.stage = 0;
      this.zoom = 1; // 横の拡大（1＝全体）
      this.vshift = 0; // 上下に動かした量(m)
      this.hScale = 1; // 横の倍率（1＝そのまま〜0.1＝1/10にちぢめる）
      this.vpan = 0; // たてがはみ出すとき、どこを見るか（0＝地面〜1＝いちばん深い所）
      this.showNames = true; // 柱の名前
      this.pan = 0.5; // 拡大したとき、どこを見るか（0＝左はし〜1＝右はし）
      this.pen = null;
      this.drawing = null;
      this._bind();
    }

    setData(data, strokes) {
      this.data = data;
      this.strokes = strokes || [];
      this.resize();
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.cv.width = Math.max(10, Math.round(r.width * dpr));
      this.cv.height = Math.max(10, Math.round(r.height * dpr));
      this.dpr = dpr;
      this.draw();
    }

    // データ座標(距離d, 標高e) ⇔ 画面座標
    _layout() {
      const d = this.data;
      const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
      const m = { l: 58, r: 48, t: 34, b: 34 };
      // 拡大しているときは、見えている区間（d0〜d0+win）だけを表示
      const zoom = Math.max(1, this.zoom || 1);
      const win = d.length / zoom;
      const d0 = Math.max(0, Math.min(1, this.pan)) * (d.length - win);
      const inWin = (dist) => { const dd = this.reversed ? d.length - dist : dist; return dd >= d0 - 1 && dd <= d0 + win + 1; };
      let zmax = -Infinity, gmin = Infinity;
      for (const s of d.samples) if (inWin(s.d)) { zmax = Math.max(zmax, s.g); gmin = Math.min(gmin, s.g); }
      const gmax = zmax;
      for (const b of d.bores) if (inWin(b.d)) zmax = Math.max(zmax, b.elev);
      if (!isFinite(zmax)) for (const s of d.samples) zmax = Math.max(zmax, s.g);
      zmax = Math.ceil((zmax + 8) / 5) * 5;
      // 下は、断面にあるボーリングのいちばん深い所まで（資料のない深い所は見せない）
      let deep = Infinity;
      for (const b of d.bores) deep = Math.min(deep, b.elev - b.depth);
      let zmin = isFinite(deep) ? Math.floor((deep - 3) / 5) * 5 : d.base;
      if (zmin >= zmax - 10) zmin = zmax - 10;
      let sx = (W - m.l - m.r) / win;
      let sy = (H - m.t - m.b) / (zmax - zmin);
      // 自動でも、たてが横より縮むことはしない（深い柱があるときは下を切る）
      const vf = this.veFixed || (sy < sx ? 1 : 0);
      let vclip = false;
      if (vf) {
        // たての強調を決めたとき：縮尺はそのままで、いちばん深い柱の下で図を終わりにする
        sy = sx * vf;
        const need = (zmax - zmin) * sy, avail = H - m.t - m.b;
        if (need < avail) m.b += avail - Math.max(need, Math.min(avail, 80));
        else {
          // 見える高さの幅がせまいとき：地面が必ず枠に入るように、上のはしを地面に近づける
          const range = avail / sy;
          let top = zmax;
          if (isFinite(gmax) && zmax - gmax > range * 0.12) top = gmax + range * 0.12;
          const lowest = zmin + range; // いちばん下まで動かしたときの上のはし
          if (top > lowest) { vclip = true; top -= Math.max(0, Math.min(1, this.vpan || 0)) * (top - lowest); }
          zmax = top + (this.vshift || 0); // マウスのホイールで上下に動かした分
          zmin = zmax - range;
        }
      }
      // 横の倍率：たての大きさはそのままで、横の長さだけを短くかく（図がせまくなり、まん中に寄る）
      const hs = Math.max(0.1, Math.min(1, this.hScale || 1));
      if (hs < 0.999) {
        const cut = (W - m.l - m.r) * (1 - hs);
        m.l += cut / 2; m.r += cut / 2;
        sx *= hs;
      }
      return { W, H, m, zmin, zmax, sx, sy, ve: sy / sx, d0, win, zoom, vclip };
    }
    /** たての5mが px ピクセル以上になる拡大の大きさ */
    zoomFor5m(px) {
      if (!this.data) return 1;
      this.zoom = 1;
      const L = this._layout();
      return Math.max(1, Math.min(40, px / (5 * L.sy)));
    }
    toScreen(dist, e, L) {
      L = L || this._layout();
      const dd = this.reversed ? this.data.length - dist : dist;
      return { x: L.m.l + (dd - L.d0) * L.sx, y: L.m.t + (L.zmax - e) * L.sy };
    }
    toData(x, y, L) {
      L = L || this._layout();
      let dd = (x - L.m.l) / L.sx + L.d0;
      if (this.reversed) dd = this.data.length - dd;
      return { d: dd, e: L.zmax - (y - L.m.t) / L.sy };
    }

    draw() {
      const ctx = this.ctx, d = this.data;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const L = d ? this._layout() : null;
      ctx.clearRect(0, 0, this.cv.width, this.cv.height);
      if (!d) return;
      const { W, H, m } = L;
      if (this.opts.onLayout) this.opts.onLayout(L);
      const P = (dist, e) => this.toScreen(dist, e, L);
      const font = '"BIZ UDPGothic","Hiragino Kaku Gothic ProN","Meiryo",sans-serif';

      // 空
      ctx.fillStyle = "#eef6fb";
      ctx.fillRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
      // ここから先は、枠の中だけにかく（拡大したときにはみ出さないように）
      ctx.save();
      ctx.beginPath(); ctx.rect(m.l, m.t, W - m.l - m.r, H - m.t - m.b); ctx.clip();
      const axisTexts = [];
      // 地下（答えを見せないときは一色）
      const groundPath = () => {
        ctx.beginPath();
        d.samples.forEach((s, i) => { const p = P(s.d, s.g); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        const pe = P(d.samples[d.samples.length - 1].d, L.zmin), ps = P(d.samples[0].d, L.zmin);
        ctx.lineTo(pe.x, pe.y); ctx.lineTo(ps.x, ps.y); ctx.closePath();
      };
      groundPath();
      ctx.fillStyle = "#e9e2d3";
      ctx.fill();
      // 模型の底より下（資料がない所）
      if (L.zmin < d.base) {
        const yb = P(0, d.base).y;
        ctx.fillStyle = "#eceff1";
        ctx.fillRect(m.l, yb, W - m.l - m.r, H - m.b - yb);
        ctx.fillStyle = "#9aa5ad"; ctx.font = "12px " + font; ctx.textAlign = "left";
        if (H - m.b - yb > 20) ctx.fillText("ここから下は、ボーリングの資料がありません", m.l + 130, yb + 16);
      }

      if (this.stage === 0) {
        if (this._volShown !== false && this.opts.onVolcano) this.opts.onVolcano(null);
        if (this.opts.onStageText) this.opts.onStageText(null);
        this._volShown = false;
      }
      if (this.stage > 0) {
        this._drawStage(ctx, L, P, font);
      } else if (this.showModel) {
        d.layers.forEach((layer, li) => {
          ctx.beginPath();
          d.samples.forEach((s, i) => { const p = P(s.d, s.tops[li]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
          for (let i = d.samples.length - 1; i >= 0; i--) { const s = d.samples[i]; const p = P(s.d, s.bots[li]); ctx.lineTo(p.x, p.y); }
          ctx.closePath();
          ctx.fillStyle = layer.color;
          ctx.globalAlpha = 0.8;
          ctx.fill();
          ctx.globalAlpha = 1;
        });
        // 層の名前をいちばん厚い所に書く
        ctx.font = "bold 12px " + font;
        ctx.textAlign = "center";
        d.layers.forEach((layer, li) => {
          let best = null, bt = 0;
          d.samples.forEach((s) => { const t = s.tops[li] - s.bots[li]; if (t > bt) { bt = t; best = s; } });
          if (!best) return;
          const p1 = P(best.d, best.tops[li]), p2 = P(best.d, best.bots[li]);
          if (p2.y - p1.y < 13) return;
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          const tw = ctx.measureText(layer.short || layer.name).width + 8;
          ctx.fillRect((p1.x) - tw / 2, (p1.y + p2.y) / 2 - 9, tw, 17);
          ctx.fillStyle = "#1f2a33";
          ctx.fillText(layer.short || layer.name, p1.x, (p1.y + p2.y) / 2 + 4);
        });
      }

      // 本物の柱状図どうしを「同じ地層」でつなぐ（となりの柱と柱のあいだ）
      if (this.connect && this.stage === 0) this._drawConnect(ctx, L, P, groundPath);

      // 目盛り（標高）
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.fillStyle = "#5a6873";
      ctx.font = "12px " + font;
      ctx.textAlign = "right";
      ctx.font = (5 * L.sy < 16 ? "11px " : "12px ") + font;
      // 線は5mごと。数字は、文字が重ならない間かくで（5m→10m→…）
      const gstep = 5 * L.sy >= 3 ? 5 : niceStep((L.zmax - L.zmin) / 6);
      let lstep = gstep;
      while (lstep * L.sy < 13) lstep = lstep % 25 === 0 ? lstep * 2 : lstep === 10 ? 25 : lstep * 2;
      for (let z = Math.ceil(L.zmin / gstep) * gstep; z <= L.zmax; z += gstep) {
        const y = P(0, z).y;
        const lab = z % lstep === 0;
        ctx.strokeStyle = z === 0 ? "rgba(0,80,160,0.35)" : lab ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.07)";
        ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(W - m.r, y); ctx.stroke();
        if (lab) {
          axisTexts.push(["right", z + "m", m.l - 6, y + 4]);
          if (lstep !== 10) axisTexts.push(["left", z + "m", W - m.r + 6, y + 4]);
        } else if (lstep === 10 && z % 5 === 0 && y > m.t && y < H - m.b) {
          // 数字が入りきらないときは、5mの目盛りを右がわに書いて、左右で5mごとにする
          axisTexts.push(["tickR", "", W - m.r, y]);
          axisTexts.push(["left", z + "m", W - m.r + 6, y + 4]);
        } else if (y > m.t && y < H - m.b) {
          axisTexts.push(["tickL", "", m.l, y]);
        }
      }
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.font = "12px " + font;
      ctx.textAlign = "center";

      // 地面の線（でき方の①〜③では、今の地面の代わりに「けずられる前の地面」をかく）
      if (this.stage > 0 && this.stage <= 3) {
        ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(59,42,26,0.45)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); d.samples.forEach((s, i) => { const p = P(s.d, s.g); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
        ctx.restore();
      } else {
      ctx.beginPath();
      d.samples.forEach((s, i) => { const p = P(s.d, s.g); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.strokeStyle = "#3b2a1a";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.lineWidth = 1;

      // 折れ線の曲がり角（A・B・C…）
      for (const v of d.vertices || []) {
        const p = P(v.d, L.zmax);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(208,52,44,0.5)";
        ctx.beginPath(); ctx.moveTo(p.x, m.t); ctx.lineTo(p.x, H - m.b); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#d0342c";
        ctx.font = "bold 13px " + font;
        ctx.fillText(v.label, p.x, m.t + 14);
      }

      }
      // ボーリングの柱（わかっている資料）
      const colW = 18;
      const cols = [];
      if (this.showBores && !(this.stage > 0 && this.stage <= 3)) for (const b of d.bores) {
        const top = P(b.d, b.elev);
        if (top.x < m.l - 12 || top.x > W - m.r + 12) continue; // 拡大して見えていない柱
        const bottomY = P(b.d, b.elev - b.depth).y;
        if (b.hidden) {
          // かくした柱：中身は見せず「？」
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = "#1f2a33";
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.fillRect(top.x - colW / 2, top.y, colW, bottomY - top.y);
          ctx.strokeRect(top.x - colW / 2, top.y, colW, bottomY - top.y);
          ctx.setLineDash([]);
          ctx.fillStyle = "#d0342c";
          ctx.font = "bold 20px " + font;
          ctx.fillText("？", top.x, (top.y + bottomY) / 2 + 7);
        } else {
          const right = top.x < W - m.r - 70; // 名前は柱の右（はしでは左）に
          ctx.font = "11px " + font;
          ctx.textAlign = right ? "left" : "right";
          for (const s of b.segs) {
            const y1 = P(b.d, b.elev - s.from).y, y2 = P(b.d, b.elev - s.to).y;
            ctx.fillStyle = s.color;
            ctx.fillRect(top.x - colW / 2, y1, colW, Math.max(1, y2 - y1));
            ctx.strokeStyle = "rgba(0,0,0,0.55)";
            ctx.strokeRect(top.x - colW / 2, y1, colW, Math.max(1, y2 - y1));
            if (y2 - y1 >= 12 && s.name) {
              const tx = right ? top.x + colW / 2 + 3 : top.x - colW / 2 - 3;
              const tw = ctx.measureText(s.name).width;
              ctx.fillStyle = "rgba(255,255,255,0.8)";
              ctx.fillRect(right ? tx - 1 : tx - tw - 1, (y1 + y2) / 2 - 7, tw + 2, 13);
              ctx.fillStyle = "#1f2a33";
              ctx.fillText(s.name, tx, (y1 + y2) / 2 + 4);
            }
          }
          ctx.textAlign = "center";
        }
        if (b.mark) {
          // 目立たせた柱：柱に色のふち
          ctx.strokeStyle = b.mark; ctx.lineWidth = 3;
          ctx.strokeRect(top.x - colW / 2 - 2, top.y - 2, colW + 4, bottomY - top.y + 4); ctx.lineWidth = 1;
        }
        cols.push({ b, x: top.x, top: top.y, bot: bottomY });
      }
      this._cols = cols;
      // 柱の名前：柱や、ほかの名前と重ならない高さをさがして置く（とどかない時は細い線で柱と結ぶ）
      if (this.showNames && cols.length) {
        ctx.textAlign = "center";
        const boxes = cols.map((c) => ({ x1: c.x - colW / 2 - 2, x2: c.x + colW / 2 + 2, y1: c.top - 2, y2: c.bot + 2 }));
        const hit = (r) => boxes.some((q) => r.x1 < q.x2 && r.x2 > q.x1 && r.y1 < q.y2 && r.y2 > q.y1);
        for (const c of cols.slice().sort((a, b2) => (b2.b.mark ? 1 : 0) - (a.b.mark ? 1 : 0) || a.top - b2.top)) {
          const b = c.b;
          ctx.font = "bold 12px " + font;
          const nm = (b.mark && !b.hidden ? "★" : "") + (b.name.length > 12 ? b.name.slice(0, 11) + "…" : b.name) + (b.hidden ? "（予想しよう）" : "");
          const half = ctx.measureText(nm).width / 2 + 4, hh = 28;
          const lx = Math.min(W - m.r - half, Math.max(m.l + half, c.x));
          let ly = null;
          // 柱のすぐ上から、上へ順に空いている所をさがす
          for (let y = c.top - 6; y - hh >= m.t + 2; y -= 6) {
            const r = { x1: lx - half, x2: lx + half, y1: y - hh, y2: y };
            if (!hit(r)) { ly = y; break; }
          }
          if (ly == null) ly = Math.max(m.t + hh + 2, c.top - 6);
          boxes.push({ x1: lx - half, x2: lx + half, y1: ly - hh, y2: ly });
          if (c.top - ly > 14) { // はなれた時は、柱までの線
            ctx.strokeStyle = "rgba(31,95,153,0.5)"; ctx.beginPath(); ctx.moveTo(c.x, ly); ctx.lineTo(c.x, c.top); ctx.stroke();
          }
          ctx.fillStyle = b.mark || "rgba(255,255,255,0.85)";
          ctx.fillRect(lx - half, ly - hh, half * 2, hh);
          ctx.fillStyle = b.mark ? (b.mark === "#fbc02d" ? "#3a2a00" : "#fff") : b.hidden ? "#d0342c" : b.sample ? "#b85c00" : "#1f5f99";
          ctx.fillText(nm, lx, ly - 15);
          ctx.font = "11px " + font;
          ctx.fillStyle = b.mark ? ctx.fillStyle : "#5a6873";
          ctx.fillText("線から" + Math.round(b.off) + "m", lx, ly - 3);
        }
      }

      // 目印（学校など）
      ctx.font = "14px " + font;
      for (const lm of d.landmarks) {
        const p = P(lm.d, lm.g);
        const ly = Math.max(m.t + 16, p.y - 44);
        ctx.strokeStyle = "#1f2a33";
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, ly + 4); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        const tw = ctx.measureText((lm.icon || "") + lm.name).width + 8;
        ctx.fillRect(p.x - tw / 2, ly - 14, tw, 19);
        ctx.fillStyle = "#1f2a33";
        ctx.fillText((lm.icon || "") + lm.name, p.x, ly);
      }

      // 川が横切る所
      for (const r of d.rivers || []) {
        let gy = 0;
        for (const smp of d.samples) if (Math.abs(smp.d - r.d) < d.length / 300 + 1) { gy = smp.g; break; }
        const p = P(r.d, gy);
        ctx.fillStyle = "#1565ff";
        ctx.beginPath(); ctx.moveTo(p.x - 8, p.y - 14); ctx.lineTo(p.x + 8, p.y - 14); ctx.lineTo(p.x, p.y - 2); ctx.closePath(); ctx.fill();
        ctx.font = "bold 13px " + font;
        ctx.textAlign = "center";
        const t = "🌊" + r.name;
        const tw = ctx.measureText(t).width + 8;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(p.x - tw / 2, p.y - 34, tw, 18);
        ctx.fillStyle = "#1565ff";
        ctx.fillText(t, p.x, p.y - 20);
      }

      // 谷戸が横切る所
      for (const r of d.yato || []) {
        let gy = 0;
        for (const smp of d.samples) if (Math.abs(smp.d - r.d) < d.length / 300 + 1) { gy = smp.g; break; }
        const p = P(r.d, gy);
        ctx.fillStyle = "#0f8f86";
        ctx.beginPath(); ctx.moveTo(p.x - 7, p.y - 12); ctx.lineTo(p.x + 7, p.y - 12); ctx.lineTo(p.x, p.y - 2); ctx.closePath(); ctx.fill();
        ctx.font = "bold 12px " + font;
        ctx.textAlign = "center";
        const t = "〰" + r.name;
        const tw = ctx.measureText(t).width + 8;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(p.x - tw / 2, p.y - 50, tw, 17);
        ctx.fillStyle = "#0f8f86";
        ctx.fillText(t, p.x, p.y - 37);
        ctx.strokeStyle = "rgba(15,143,134,0.6)"; ctx.beginPath(); ctx.moveTo(p.x, p.y - 33); ctx.lineTo(p.x, p.y - 12); ctx.stroke();
      }

      // 子どもの予想の線
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const st of this.strokes.concat(this.drawing ? [this.drawing] : [])) {
        ctx.beginPath();
        st.pts.forEach((pt, i) => { const p = P(pt[0], pt[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.strokeStyle = st.color;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      // 上ほど新しい・下ほど古い（地層の重なり＝時間の順番）
      if (this.showModel || this.stage > 0) {
        const ax = m.l + 16, y1 = m.t + 36, y2 = H - m.b - 10;
        ctx.strokeStyle = "#1f2a33"; ctx.fillStyle = "#1f2a33"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ax, y2); ctx.lineTo(ax, y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax - 6, y1 + 8); ctx.lineTo(ax, y1); ctx.lineTo(ax + 6, y1 + 8); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.font = "bold 12px " + font; ctx.textAlign = "left";
        const tag = (t, y) => { const w = ctx.measureText(t).width + 6; ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(ax + 6, y - 11, w, 15); ctx.fillStyle = "#1f2a33"; ctx.fillText(t, ax + 9, y); };
        tag("上ほど新しい", y1 + 10); tag("下ほど古い", y2 - 2);
      }
      ctx.restore(); // 枠の中だけ ここまで

      // 目盛りの数字（枠の外）
      ctx.font = (5 * L.sy < 16 ? "11px " : "12px ") + font;
      ctx.fillStyle = "#5a6873"; ctx.strokeStyle = "rgba(0,0,0,0.35)";
      for (const [al, t, x, y] of axisTexts) {
        if (al === "tickL") { ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x, y); ctx.stroke(); continue; }
        if (al === "tickR") { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 4, y); ctx.stroke(); continue; }
        ctx.textAlign = al; ctx.fillText(t, x, y);
      }
      ctx.font = "12px " + font;
      ctx.save(); ctx.translate(Math.max(14, m.l - 50), m.t + (H - m.t - m.b) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.fillText("標高", 0, 0); ctx.restore();
      // 目盛り（距離）…左はしからの長さ
      ctx.textAlign = "center";
      const dstep = niceStep(Math.max(L.win / 8, 64 / L.sx)); // 文字が重ならない間かく
      for (let x = Math.ceil(L.d0 / dstep) * dstep; x <= L.d0 + L.win + 0.5; x += dstep) {
        ctx.fillText(Math.round(x) + "m", L.m.l + (x - L.d0) * L.sx, H - m.b + 16);
      }
      // 拡大しているときは、全体のどこを見ているかを下に小さく
      if (L.zoom > 1.01) {
        const bw = W - m.l - m.r, by = H - 8;
        ctx.fillStyle = "rgba(0,0,0,0.1)"; ctx.fillRect(m.l, by, bw, 5);
        ctx.fillStyle = "#1f7a8c"; ctx.fillRect(m.l + (L.d0 / d.length) * bw, by, Math.max(4, (L.win / d.length) * bw), 5);
      }

      // 両はしの方角
      const [left, right] = this.reversed ? [d.ends[1], d.ends[0]] : d.ends;
      ctx.font = "bold 15px " + font;
      ctx.fillStyle = "#1f2a33";
      // 横を短くかいて図がせまいときは、方角を図の外側へ、説明を図の下へ
      const narrow = W - m.l - m.r < 420;
      ctx.textAlign = narrow ? "right" : "left";
      ctx.fillText("◀ " + left, narrow ? m.l + 24 : m.l + 4, m.t - 10);
      ctx.textAlign = narrow ? "left" : "right";
      ctx.fillText(right + " ▶", narrow ? W - m.r - 24 : W - m.r - 4, m.t - 10);
      ctx.textAlign = "center";
      ctx.font = "12px " + font;
      ctx.fillStyle = "#5a6873";
      if (narrow) ctx.textAlign = "left";
      ctx.fillText((Math.abs(L.ve - 1) < 0.05 ? "たて・横が同じ縮尺（本当の形）" : "たての長さは横の約" + L.ve.toFixed(1) + "倍に強調") + ((this.hScale || 1) < 0.999 ? "（横を1/" + (1 / this.hScale).toFixed(1).replace(/\.0$/, "") + "の長さでかいた）" : ""), narrow ? 8 : (m.l + W - m.r) / 2, narrow ? 14 : m.t - 10);
      ctx.strokeStyle = "#8a99a6";
      ctx.strokeRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
    }

    /** となり合う柱の、同じ層（同じ色）を帯でつなぐ。つながらない層は、あいだで細くなって消えるようにかく */
    _drawConnect(ctx, L, P, groundPath) {
      const d = this.data;
      // 柱ごとに、同じ色が続くところを1つのまとまり（ユニット）にする
      const units = (b) => {
        const out = [];
        for (const s of b.segs) {
          const last = out[out.length - 1];
          if (last && last.color === s.color) last.to = s.to;
          else out.push({ color: s.color, from: s.from, to: s.to });
        }
        // 1mより薄い層は、上の層にふくめる（細かい重なりで図が読みにくくならないように）
        const merged = [];
        for (const u of out) {
          const last = merged[merged.length - 1];
          if (last && (u.to - u.from < 1 || last.color === u.color)) last.to = u.to;
          else merged.push(Object.assign({}, u));
        }
        return merged.map((u) => ({ color: u.color, top: b.elev - u.from, bot: b.elev - u.to }));
      };
      const list = d.bores.filter((b) => b.segs && b.segs.length).slice().sort((a, b) => a.d - b.d);
      ctx.save();
      groundPath(); ctx.clip(); // 地面より上にははみ出さない
      for (let i = 0; i < list.length - 1; i++) {
        const A = list[i], B = list[i + 1];
        if (A.hidden || B.hidden) continue; // かくした柱（予想中）の所はつながない
        const ua = units(A), ub = units(B);
        // 上から順に、同じ色どうしを交差しないように対応づける（LCS）
        const n = ua.length, m = ub.length, T = [];
        for (let x = 0; x <= n; x++) T.push(new Array(m + 1).fill(0));
        for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--)
          T[x][y] = ua[x].color === ub[y].color ? T[x + 1][y + 1] + 1 : Math.max(T[x + 1][y], T[x][y + 1]);
        const pairs = [], usedA = new Set(), usedB = new Set();
        for (let x = 0, y = 0; x < n && y < m;) {
          if (ua[x].color === ub[y].color) { pairs.push([ua[x], ub[y]]); usedA.add(x); usedB.add(y); x++; y++; }
          else if (T[x + 1][y] >= T[x][y + 1]) x++; else y++;
        }
        const xa = A.d, xb = B.d, xma = xa + (xb - xa) * 0.3, xmb = xb - (xb - xa) * 0.3;
        const poly = (pts, color, alpha, faint) => {
          ctx.beginPath();
          pts.forEach(([dd, e], k) => { const p = P(dd, e); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
          ctx.closePath();
          ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill();
          ctx.globalAlpha = 1;
          if (!faint) { ctx.strokeStyle = "rgba(40,30,20,0.55)"; ctx.lineWidth = 1; ctx.stroke(); }
        };
        for (const [u, v] of pairs) poly([[xa, u.top], [xb, v.top], [xb, v.bot], [xa, u.bot]], u.color, 0.85);
        // 片方の柱にしかない層：あいだで細くなって消える（どこまで続くかは分からない）
        ua.forEach((u, k) => { if (!usedA.has(k)) poly([[xa, u.top], [xma, (u.top + u.bot) / 2], [xa, u.bot]], u.color, 0.5, true); });
        ub.forEach((u, k) => { if (!usedB.has(k)) poly([[xb, u.top], [xmb, (u.top + u.bot) / 2], [xb, u.bot]], u.color, 0.5, true); });
      }
      ctx.restore();
    }

    /** 大地のでき方（①〜⑥）。ボーリング資料から推定した、おおまかな順番 */
    stages() {
      const d = this.data;
      if (!d || !d.surfIdx) return [];
      const has = (pred) => d.layers.some((l, i) => pred(l) && d.samples.some((s) => s.tops[i] - s.bots[i] > 0.3));
      const out = [];
      out.push({ n: 1, text: "大昔、海の底に どろ が少しずつしずんでたまり、長い時間をかけて固まった（泥岩）。" });
      out.push({ n: 2, text: "流れる水のはたらきで運ばれた れき・砂・ねんど が、海や川の底に何度も積み重なった。下の層ほど古い。" });
      if (has((l) => l.origin === "volcano")) out.push({ n: 3, text: "遠くの火山の火山灰が積もる → 川が右へ左へ動きながらけずる → また積もる…をくり返して、広い谷と関東ローム層ができた。" });
      else out.push({ n: 3, text: "川が長い時間をかけて大地をけずり、谷ができた。点線は、けずられる前の地面。" });
      if (has((l) => l.mode === "valley")) out.push({ n: 5, text: "あたたかくなって海面が上がり、川が運んできた やわらかい土砂 が、谷の底にたまった（沖積層）。" });
      if (has((l) => l.origin === "human")) out.push({ n: 6, text: "人が土を盛って、家や道路をつくった。これが今の大地。" });
      const circ = "①②③④⑤⑥";
      out.forEach((o, k) => (o.text = circ[k] + " " + o.text));
      // おおよその年代（横浜のあたりの目安。場所の設定 stageAges で変えられる）
      const ages = Object.assign({}, SectionView.AGES, (this.opts.site && this.opts.site.stageAges) || {});
      for (const o of out) Object.assign(o, ages[o.n] || {});
      return out;
    }
    _drawStage(ctx, L, P, font) {
      const d = this.data, S = d.samples, n = this.stage;
      const surf = d.surfIdx, last = surf.length - 1;
      const poly = (li, topF, botF, alpha) => {
        ctx.beginPath();
        S.forEach((s, i) => { const p = P(s.d, topF(s)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        for (let i = S.length - 1; i >= 0; i--) { const p = P(S[i].d, botF(S[i])); ctx.lineTo(p.x, p.y); }
        ctx.closePath();
        ctx.fillStyle = d.layers[li].color; ctx.globalAlpha = alpha || 0.9; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.stroke();
      };
      // けずられる前の、平らな大地の高さ（今残っている古い地層のいちばん高い所）
      let H0 = -Infinity;
      for (const s of S) H0 = Math.max(H0, s.eros);
      const loamI = d.layers.findIndex((l) => l.origin === "volcano");
      let T = 0;
      if (loamI >= 0) { const th = S.map((s) => s.tops[loamI] - s.bots[loamI]).filter((t) => t > 0.5).sort((a, b) => a - b); T = th.length ? th[Math.floor(th.length / 2)] : 0; }
      const t = Math.max(0, Math.min(1, this.stageT == null ? 1 : this.stageT)); // その出来事が どこまで進んだか（0〜1）
      const clock = this.clock || 0; // 水や火山灰を動かすための時計（秒）
      const preTop = (si, s) => (si === 0 ? H0 : Math.min(H0, s.rawB[si]));
      const preBot = (si, s) => (si === last ? L.zmin : Math.min(H0, s.rawB[si + 1]));
      const clip = (top, bot, D) => Math.max(bot, Math.min(top, D));
      const lineAt = (f) => (dd) => { const k = Math.max(0, Math.min(S.length - 1, Math.round((dd / d.length) * (S.length - 1)))); return f(S[k]); };
      const band = (topF, botF, color, alpha) => {
        ctx.beginPath();
        S.forEach((s, i) => { const p = P(s.d, topF(s)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        for (let i = S.length - 1; i >= 0; i--) { const p = P(S[i].d, botF(S[i])); ctx.lineTo(p.x, p.y); }
        ctx.closePath(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      };
      const tag = (x, y, text, color) => {
        ctx.font = "bold 14px " + font; ctx.textAlign = "center";
        const w = ctx.measureText(text).width + 12;
        x = Math.max(L.m.l + w / 2 + 2, Math.min(L.W - L.m.r - w / 2 - 2, x)); // 枠からはみ出さない
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(x - w / 2, y - 15, w, 20);
        ctx.fillStyle = color; ctx.fillText(text, x, y);
      };
      const skyTop = L.zmax + 50;
      /** 水の流れ（動く波の線と、流れの向きの矢じるし） */
      const water = (topF, botF, dir) => {
        band(topF, botF, "#5aa9e6", 0.35);
        ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.6;
        const span = L.win || d.length, x0 = L.d0 || 0;
        for (let row = 0; row < 3; row++) {
          ctx.beginPath(); let started = false;
          for (let k = 0; k <= 120; k++) {
            const dd = x0 + (k / 120) * span, top = lineAt(topF)(dd), bot = lineAt(botF)(dd);
            if (top - bot < 0.3) { started = false; continue; }
            const e = bot + (top - bot) * (0.25 + row * 0.25) + Math.sin((k / 6) - clock * 2.2 * dir + row) * Math.min(0.6, (top - bot) * 0.08);
            const p = P(dd, e);
            started ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); started = true;
          }
          ctx.stroke();
        }
        // 流れの矢じるし
        ctx.fillStyle = "rgba(20,90,170,0.8)"; ctx.font = "bold 16px " + font; ctx.textAlign = "center";
        for (let k = 0; k < 5; k++) {
          const f = ((k / 5 + clock * 0.08 * dir) % 1 + 1) % 1, dd = x0 + f * span, top = lineAt(topF)(dd), bot = lineAt(botF)(dd);
          if (top - bot < 1) continue;
          const p = P(dd, (top + bot) / 2); ctx.fillText(dir > 0 ? "➜" : "⬅", p.x, p.y + 5);
        }
        ctx.restore();
      };
      /** しずんでいく つぶ（水の中）・降ってくる火山灰（空の中） */
      const particles = (count, color, r, topF, botF, speed, drift) => {
        ctx.fillStyle = color;
        const span = L.win || d.length, x0 = L.d0 || 0;
        for (let k = 0; k < count; k++) {
          const f0 = ((k * 0.618) % 1), ph = ((k * 0.377 + clock * speed) % 1);
          const dd = x0 + (((f0 + ph * drift) % 1) + 1) % 1 * span;
          const top = lineAt(topF)(dd), bot = lineAt(botF)(dd);
          if (top <= bot) continue;
          const p = P(dd, top - ph * (top - bot)); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        }
      };
      /** 遠くでふん火する火山（左上）。けむりは ふくらみながら右へ流れる */
      const volcano = (groundF) => {
        // 地面より上の空に、小さく遠くの景色としてかく
        const bx = L.m.l + 150;
        let gy = Infinity; for (let dd = (L.d0 || 0); dd < (L.d0 || 0) + (L.win || d.length) * 0.3; dd += (L.win || d.length) / 60) gy = Math.min(gy, P(dd, lineAt(groundF)(dd)).y);
        const room = gy - L.m.t - 30, k = Math.max(0.4, Math.min(1, room / 90)), by = Math.max(L.m.t + 70 * k, gy - 12);
        ctx.save();
        ctx.translate(bx, by); ctx.scale(k, k); ctx.translate(-bx, -by);
        ctx.globalAlpha = 0.85; ctx.fillStyle = "#8d6e63";
        ctx.beginPath(); ctx.moveTo(bx - 55, by); ctx.lineTo(bx - 10, by - 55); ctx.lineTo(bx + 10, by - 55); ctx.lineTo(bx + 55, by); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#e65100"; ctx.beginPath(); ctx.moveTo(bx - 10, by - 55); ctx.lineTo(bx, by - 62 - 4 * Math.sin(clock * 6)); ctx.lineTo(bx + 10, by - 55); ctx.fill();
        for (let k = 0; k < 9; k++) {
          const ph = ((k / 9 + clock * 0.12) % 1), rr = 6 + ph * 22;
          ctx.globalAlpha = 0.55 * (1 - ph); ctx.fillStyle = "#6d6d6d";
          ctx.beginPath(); ctx.arc(bx + ph * 160, by - 62 - ph * 45 - Math.sin(k) * 6, rr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1; ctx.font = "bold 12px " + font; ctx.textAlign = "center"; ctx.fillStyle = "#6b3a1a";
        ctx.fillText("🌋 遠くの火山（富士山・箱根など）", bx + 20, by + 16);
        ctx.restore();
      };
      const midD = (L.d0 || 0) + (L.win || d.length) / 2;
      let mudTop = -Infinity; for (const s of S) mudTop = Math.max(mudTop, preTop(last, s));
      const lvl1 = L.zmin + (mudTop - L.zmin) * (n === 1 ? t : 1);
      const D2 = n === 2 ? mudTop + (H0 - mudTop) * t : Infinity;
      const oldTopPre = (s, D) => { let top = clip(preTop(last, s), preBot(last, s), n === 1 ? lvl1 : Infinity); if (n >= 2) for (let si = last - 1; si >= 0; si--) top = Math.max(top, clip(preTop(si, s), preBot(si, s), D)); return top; };
      if (n === 1 || n === 2) {
        // ①② 海や湖の底に、つぶが少しずつ積もっていく（水は横に流れている）
        poly(surf[last], (s) => clip(preTop(last, s), preBot(last, s), lvl1), (s) => preBot(last, s));
        if (n === 2) for (let si = last - 1; si >= 0; si--) poly(surf[si], (s) => clip(preTop(si, s), preBot(si, s), D2), (s) => preBot(si, s));
        const top = () => H0 + 14, bot = (s) => oldTopPre(s, D2);
        water(top, bot, 1);
        particles(50, "rgba(90,70,40,0.6)", 1.8, top, bot, 0.25, 0.15);
        const p = P(midD, H0 + 11); tag(p.x, p.y, n === 1 ? "🌊 海の底に、どろが少しずつ しずんで積もる" : "🌊 流れる水が運んだ れき・砂・どろ が、少しずつ積み重なる", "#1d5f99");
      } else if (n === 3) {
        // ③ 火山灰が降り続く中で、川が大地をけずる（2つが同時に進む）
        const oldShown = (l) => l.mode === "surface";
        const gS = (s) => { let g = -Infinity; d.layers.forEach((l, li) => { if (oldShown(l) && s.tops[li] - s.bots[li] > 0.05) g = Math.max(g, s.tops[li]); }); return isFinite(g) ? g : s.g; };
        // 積もる（A）とけずる（C）を、A C A C A C A C A と交互にくり返す
        const segs = 9, sx9 = Math.min(segs - 1e-6, t * segs), si9 = Math.floor(sx9), f9 = sx9 - si9, ashSeg = si9 % 2 === 0;
        const ashDone = Math.floor((si9 + 1) / 2) + (ashSeg ? f9 : 0), cutDone = Math.floor(si9 / 2) + (ashSeg ? 0 : f9);
        const ashP = t >= 1 ? 1 : ashDone / 5, cutP = t >= 1 ? 1 : cutDone / 4;
        let maxDeep = 0.01; for (const q of S) maxDeep = Math.max(maxDeep, H0 - gS(q));
        const act = (s) => Math.min(1, (H0 - gS(s)) / (maxDeep * 0.35)); // 深くけずられる所ほど、火山灰もけずられる
        const keep = (s) => (t >= 1 ? 1 : ashSeg ? (si9 === 0 ? 1 : 1 - act(s) * (1 - f9)) : 1 - act(s) * f9);
        const cut = (s) => Math.min(H0, H0 - cutP * (H0 - gS(s)));
        for (let si = last; si >= 0; si--) poly(surf[si], (s) => Math.min(clip(preTop(si, s), preBot(si, s), Infinity), cut(s)), (s) => Math.min(preBot(si, s), cut(s)));
        const lt = (s) => (loamI >= 0 ? Math.max(0, s.tops[loamI] - s.bots[loamI]) : 0);
        const ground = (s) => cut(s) + lt(s) * ashP * keep(s);
        if (loamI >= 0) poly(loamI, ground, cut);
        // 空（けずられた所・まだ積もっていない所）
        band(() => skyTop, ground, "#eef6fb", 1);
        ctx.beginPath(); S.forEach((s, i) => { const p = P(s.d, ground(s)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
        // 川（谷のいちばん低い所）：水が流れ、けずる
        const rivers = d.rivers && d.rivers.length ? d.rivers.map((r) => r.d) : [S.reduce((a, b) => (gS(b) < gS(a) ? b : a)).d];
        for (const rd of rivers) {
          // 谷底のはば（今の谷底の低い所）を調べ、川はその中を右へ左へ動きながら けずる
          const k0 = S.reduce((a, b, k) => (Math.abs(b.d - rd) < Math.abs(S[a].d - rd) ? k : a), 0);
          let lo = k0, hi = k0, gmin = gS(S[k0]);
          for (let k = Math.max(0, k0 - 40); k <= Math.min(S.length - 1, k0 + 40); k++) if (gS(S[k]) < gmin) { gmin = gS(S[k]); }
          const floorLim = gmin + Math.max(2, (H0 - gmin) * 0.12);
          while (lo > 0 && gS(S[lo - 1]) <= floorLim) lo--;
          while (hi < S.length - 1 && gS(S[hi + 1]) <= floorLim) hi++;
          const dL = S[lo].d, dR = S[hi].d, half = Math.max(4, (dR - dL) / 2), mid = (dL + dR) / 2;
          // 時間（つまみ）とともに、川の流れる場所が ゆっくり左右に動く
          const rdNow = mid + half * 0.9 * Math.sin(t * Math.PI * 7 + 0.4 * Math.sin(clock * 0.8));
          const sR = S.reduce((a, b) => (Math.abs(b.d - rdNow) < Math.abs(a.d - rdNow) ? b : a));
          const p = P(sR.d, ground(sR));
          if (ashSeg && t < 1) { ctx.fillStyle = "#1565ff"; ctx.beginPath(); ctx.ellipse(p.x, p.y - 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill(); continue; }
          // 川が通ってきた あと（谷底の はば）
          const pl = P(dL, gmin), pr = P(dR, gmin);
          ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(21,101,255,0.55)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(pl.x, pl.y + 6); ctx.lineTo(pr.x, pr.y + 6); ctx.stroke(); ctx.restore();
          const w = 16 + 4 * Math.sin(clock * 3);
          ctx.fillStyle = "#1565ff"; ctx.beginPath(); ctx.ellipse(p.x, p.y - 3, w, 5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.moveTo(p.x - w + 4 + ((clock * 20) % 10), p.y - 3); ctx.lineTo(p.x - w + 12 + ((clock * 20) % 10), p.y - 3); ctx.stroke();
          ctx.fillStyle = "#1565ff"; ctx.font = "bold 16px " + font; ctx.textAlign = "center";
          const goingRight = Math.cos(t * Math.PI * 7) > 0;
          ctx.fillText(goingRight ? "↘" : "↙", p.x + (goingRight ? 18 : -18), p.y + 12 + 2 * Math.sin(clock * 4));
          // 斜面が ときどき くずれて、土が川へ ずり落ちる
          ctx.fillStyle = "rgba(110,80,50,0.8)";
          for (const side of [-1, 1]) {
            const kk = side < 0 ? Math.max(0, lo - 3) : Math.min(S.length - 1, hi + 3);
            const top = S[side < 0 ? Math.max(0, lo - 12) : Math.min(S.length - 1, hi + 12)], bot = S[kk];
            for (let q = 0; q < 4; q++) {
              const ph = ((q * 0.27 + clock * 0.45) % 1);
              const dd = top.d + (bot.d - top.d) * ph, e = ground(top) + (ground(bot) - ground(top)) * ph;
              const pp = P(dd, e); ctx.beginPath(); ctx.arc(pp.x, pp.y - 2, 2.2, 0, Math.PI * 2); ctx.fill();
            }
          }
          tag(p.x, p.y - 16, "💧川が 右へ左へ動きながら けずる → 谷が広がる", "#1565ff");
        }
        if (loamI >= 0) {
          this._volcano = { active: ashSeg || t >= 1 };
          if (ashSeg || t >= 1) { particles(70, "rgba(120,60,30,0.65)", 1.7, () => L.zmax, ground, 0.35, 0.25); }
          const p = P((L.d0 || 0) + (L.win || d.length) * 0.62, Math.min(L.zmax - 3, H0 + T + 10));
          const round = Math.min(5, Math.floor(si9 / 2) + 1);
          tag(p.x, p.y, ashSeg ? "🌋 ふん火 → 火山灰が 降り積もる（" + round + "回め）" : "💧 川が 谷をけずる（" + round + "回め）", ashSeg ? "#8a3b12" : "#1565ff");
        }
      } else {
        // ④⑤ 今の地層。谷の土砂・盛土が少しずつ たまる
        const show = (l) => l.mode === "surface" || l.origin === "volcano" || (n >= 5 && l.mode === "valley") || (n >= 6 && l.origin === "human");
        const grow = (l) => (n === 5 && l.mode === "valley") || (n === 6 && l.origin === "human");
        d.layers.forEach((l, li) => { if (show(l)) poly(li, (s) => (grow(l) ? s.bots[li] + (s.tops[li] - s.bots[li]) * t : s.tops[li]), (s) => s.bots[li]); });
        if (n === 5) {
          const vi = d.layers.findIndex((l) => l.mode === "valley");
          if (vi >= 0) {
            // 谷の底を流れる水と、たまっていく土砂のつぶ
            const has = (s) => s.tops[vi] - s.bots[vi] > 0.3;
            const vtop = (s) => (has(s) ? s.bots[vi] + (s.tops[vi] - s.bots[vi]) * t : s.bots[vi]);
            const wtop = (s) => (has(s) ? Math.max(s.tops[vi] + 1.5, vtop(s) + 1.5) : vtop(s));
            water(wtop, vtop, 1);
            particles(40, "rgba(80,110,130,0.7)", 1.6, wtop, vtop, 0.3, 0.1);
            let best = null; S.forEach((s) => { const th = s.tops[vi] - s.bots[vi]; if (th > 0.3 && (!best || th > best.th)) best = { s, th }; });
            if (best) { const p = P(best.s.d, best.s.tops[vi] + 4); tag(p.x, p.y - 12, "🌊 川が運んだ土砂が、谷の底に たまっていく", "#1d5f99"); }
          }
        }
        if (n === 6 && t < 1) { const p = P(midD, H0 + 6); tag(p.x, p.y, "🏗️ 人が土を運んで盛り、平らな土地をつくる", "#6b4a00"); }
        // けずられる前の地面を点線で
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "rgba(31,42,51,0.6)"; ctx.lineWidth = 1.5;
        const y = P(0, H0).y; ctx.beginPath(); ctx.moveTo(L.m.l, y); ctx.lineTo(L.W - L.m.r, y); ctx.stroke(); ctx.restore();
      }
      // 何年前？（大きく）
      const stNow = this.stages().find((x) => x.n === n);
      if (stNow && stNow.from != null) {
        const yrs = stNow.from + (stNow.to - stNow.from) * t;
        const txt = yrs >= 10000 ? "約" + (Math.round(yrs / 1000) / 10).toFixed(yrs >= 1000000 ? 0 : 1).replace(/\.0$/, "") + "万年前" : yrs >= 1 ? "約" + Math.round(yrs) + "年前" : "今";
        if (this.opts.onYear) this.opts.onYear(txt); // 断面図の外（時間の流れの帯）に大きく出す
      }
      if (this.opts.onVolcano) { const v = this.cv.offsetParent ? this._volcano || null : null; this.opts.onVolcano(v); this._volShown = !!v; }
      this._volcano = null;
      // 水・火山灰を動かしつづける（大地のでき方を見ている間だけ）
      if (!this._raf && this.cv.offsetParent) this._raf = requestAnimationFrame(() => { this._raf = 0; if (this.stage > 0 && this.cv.offsetParent) { this.clock = performance.now() / 1000; this.draw(); } });
      // 説明
      const st = this.stages().find((x) => x.n === n);
      // 説明は断面図の外（時間の流れの帯の下）に出す
      if (this.opts.onStageText) this.opts.onStageText(st || null);
    }

    _bind() {
      const cv = this.cv;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      cv.addEventListener("pointerdown", (e) => {
        if (this.data && !this.pen && this._cols && this.opts.onBore) {
          // ペンを持っていないとき：柱をさわると、くわしい柱状図
          const q = pos(e);
          const c = this._cols.find((k) => Math.abs(q.x - k.x) <= 14 && q.y >= k.top - 4 && q.y <= k.bot + 4);
          if (c && !c.b.hidden) return this.opts.onBore(c.b.id);
        }
        if (!this.data || !this.pen) return;
        cv.setPointerCapture(e.pointerId);
        const p = this.toData(pos(e).x, pos(e).y);
        this.drawing = { color: this.pen, pts: [[p.d, p.e]] };
        this.draw();
      });
      cv.addEventListener("pointermove", (e) => {
        if (!this.drawing) return;
        const p = this.toData(pos(e).x, pos(e).y);
        this.drawing.pts.push([p.d, p.e]);
        this.draw();
      });
      const end = () => {
        if (!this.drawing) return;
        if (this.drawing.pts.length > 1) this.strokes.push(this.drawing);
        this.drawing = null;
        this.draw();
        if (this.opts.onChange) this.opts.onChange(this.strokes);
      };
      cv.addEventListener("pointerup", end);
      cv.addEventListener("pointercancel", end);
      window.addEventListener("resize", () => { if (this.data) this.resize(); });
    }

    undo() { this.strokes.pop(); this.draw(); if (this.opts.onChange) this.opts.onChange(this.strokes); }
    clear() { this.strokes = []; this.draw(); if (this.opts.onChange) this.opts.onChange(this.strokes); }
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }

  // 大地のでき方の、おおよその年代（from, to：何年前）。横浜のあたりの目安
  SectionView.AGES = {
    1: { age: "約250万〜50万年前ごろ", from: 2500000, to: 500000 },
    2: { age: "約50万〜13万年前ごろ", from: 500000, to: 130000 },
    3: { age: "約13万〜1万年前ごろ（ふん火で火山灰が積もる時期と、寒くなって海面が下がり川が深くけずる時期が、何度もくり返した）", from: 130000, to: 10000 },
    5: { age: "約1万年前〜今（あたたかくなって海面が上がり、谷に土砂がたまった）", from: 10000, to: 0 },
    6: { age: "約60年前〜今（町が広がったころから）", from: 60, to: 0 },
  };
  C.SectionView = SectionView;
})();
