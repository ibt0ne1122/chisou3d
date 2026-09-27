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
      const sx = (W - m.l - m.r) / win;
      let sy = (H - m.t - m.b) / (zmax - zmin);
      // 自動でも、たてが横より縮むことはしない（深い柱があるときは下を切る）
      const vf = this.veFixed || (sy < sx ? 1 : 0);
      if (vf) {
        // たての強調を決めたとき：縮尺はそのままで、いちばん深い柱の下で図を終わりにする
        sy = sx * vf;
        const need = (zmax - zmin) * sy, avail = H - m.t - m.b;
        if (need < avail) m.b += avail - Math.max(need, Math.min(avail, 80));
        else {
          // 見える高さの幅がせまいとき：地面が必ず枠に入るように、上のはしを地面に近づける
          const range = avail / sy;
          if (isFinite(gmax) && zmax - gmax > range * 0.12) zmax = gmax + range * 0.12;
          zmax += this.vshift || 0; // マウスのホイールで上下に動かした分
          zmin = zmax - range;
        }
      }
      return { W, H, m, zmin, zmax, sx, sy, ve: sy / sx, d0, win, zoom };
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
      ctx.save(); ctx.translate(14, m.t + (H - m.t - m.b) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.fillText("標高", 0, 0); ctx.restore();
      // 目盛り（距離）…左はしからの長さ
      ctx.textAlign = "center";
      const dstep = niceStep(L.win / 8);
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
      ctx.textAlign = "left";
      ctx.fillText("◀ " + left, m.l + 4, m.t - 10);
      ctx.textAlign = "right";
      ctx.fillText(right + " ▶", W - m.r - 4, m.t - 10);
      ctx.textAlign = "center";
      ctx.font = "12px " + font;
      ctx.fillStyle = "#5a6873";
      ctx.fillText((Math.abs(L.ve - 1) < 0.05 ? "たて・横が同じ縮尺（本当の形）" : "たての長さは横の約" + L.ve.toFixed(1) + "倍に強調"), (m.l + W - m.r) / 2, m.t - 10);
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
      out.push({ n: 1, text: "① 大昔、海や湖の底に どろ がたまり、長い時間をかけて固まった（泥岩）。" });
      out.push({ n: 2, text: "② 流れる水のはたらきで運ばれた れき・砂・ねんど が、何度も積み重なった。下の層ほど古い。" });
      if (has((l) => l.origin === "volcano")) out.push({ n: 3, text: "③ 火山からふき出された 火山灰 が、風に運ばれて降りつもった（関東ローム層）。" });
      out.push({ n: 4, text: "④ 川が長い時間をかけて大地をけずり、谷ができた。点線は、けずられる前の地面。" });
      if (has((l) => l.mode === "valley")) out.push({ n: 5, text: "⑤ 川が運んできた やわらかい土砂 が、谷の底にたまった（沖積層）。" });
      if (has((l) => l.origin === "human")) out.push({ n: 6, text: "⑥ 人が土を盛って、家や道路をつくった。これが今の大地。" });
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
      const preTop = (si, s) => (si === 0 ? H0 : Math.min(H0, s.rawB[si]));
      const preBot = (si, s) => (si === last ? L.zmin : Math.min(H0, s.rawB[si + 1]));
      const clip = (top, bot, D) => Math.max(bot, Math.min(top, D));
      const band = (topF, botF, color, alpha) => { // 色の帯（水・空など）
        ctx.beginPath();
        S.forEach((s, i) => { const p = P(s.d, topF(s)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        for (let i = S.length - 1; i >= 0; i--) { const p = P(S[i].d, botF(S[i])); ctx.lineTo(p.x, p.y); }
        ctx.closePath(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      };
      const tag = (x, y, text, color) => {
        ctx.font = "bold 14px " + font; ctx.textAlign = "center";
        const w = ctx.measureText(text).width + 12;
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(x - w / 2, y - 15, w, 20);
        ctx.fillStyle = color; ctx.fillText(text, x, y);
      };
      const midD = S[Math.floor(S.length / 2)].d;
      const drawPre = (upto, tLast) => {
        // けずられる前の大地（upto 番目の層まで）。tLast：いちばん上の層が どこまで積もったか
        let mudTop = -Infinity; for (const s of S) mudTop = Math.max(mudTop, preTop(last, s));
        for (let si = last; si >= upto; si--) {
          let D = Infinity;
          if (si === upto && tLast < 1) D = (upto === last ? L.zmin + (mudTop - L.zmin) * tLast : mudTop + (H0 - mudTop) * tLast);
          poly(surf[si], (s) => clip(preTop(si, s), preBot(si, s), D), (s) => preBot(si, s));
        }
        if (upto === 0 && tLast < 1 && surf.length > 1) {} // （②の途中は、上のDで表す）
      };
      const Htop = H0 + T;
      if (n === 1 || n === 2) {
        // ①② 海や湖の底に、つぶが少しずつ積もっていく
        const lvl = n === 1 ? L.zmin + (Math.max(...S.map((s) => preTop(last, s))) - L.zmin) * t : null;
        if (n === 1) drawPre(last, t);
        else {
          drawPre(last, 1);
          let mudTop = -Infinity; for (const s of S) mudTop = Math.max(mudTop, preTop(last, s));
          const D = mudTop + (H0 - mudTop) * t;
          for (let si = last - 1; si >= 0; si--) poly(surf[si], (s) => clip(preTop(si, s), preBot(si, s), D), (s) => preBot(si, s));
        }
        // 水（海・湖）：積もった所の上に
        let mudTop2 = -Infinity; for (const q of S) mudTop2 = Math.max(mudTop2, preTop(last, q));
        const D2 = mudTop2 + (H0 - mudTop2) * t;
        const surfNow = (s) => {
          if (n === 1) return clip(preTop(last, s), preBot(last, s), lvl);
          let top = preTop(last, s);
          for (let si = last - 1; si >= 0; si--) top = Math.max(top, clip(preTop(si, s), preBot(si, s), D2));
          return top;
        };
        band(() => Htop + 12, surfNow, "#5aa9e6", 0.35);
        // しずんでいく つぶ
        ctx.fillStyle = "rgba(90,70,40,0.55)";
        for (let k = 0; k < 40; k++) {
          const dd = ((k * 97) % 100) / 100 * d.length, ph = (k * 37 % 100) / 100;
          const top = Htop + 10, bottom = surfNow(S[Math.min(S.length - 1, Math.floor(dd / d.length * (S.length - 1)))]);
          const e = top - ((ph + t * 3) % 1) * (top - bottom);
          const p = P(dd, e); ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill();
        }
        const p = P(midD, Htop + 8); tag(p.x, p.y, n === 1 ? "🌊 海の底に、どろが少しずつ しずんで積もる" : "🌊 流れる水が運んだ れき・砂・どろ が、少しずつ積み重なる", "#1d5f99");
      } else if (n === 3) {
        // ③ 火山灰が少しずつ降り積もる
        drawPre(0, 1);
        if (loamI >= 0 && T > 0) poly(loamI, () => H0 + T * t, () => H0);
        ctx.fillStyle = "rgba(120,60,30,0.6)";
        for (let k = 0; k < 60; k++) {
          const dd = ((k * 61) % 100) / 100 * d.length, ph = (k * 29 % 100) / 100;
          const e = Htop + 14 - ((ph + t * 4) % 1) * (14 - T * t + T);
          const p = P(dd, e); ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        const p = P(d.length * 0.12, Htop + 10); tag(p.x + 60, p.y, "🌋 遠くの火山がふん火 → 火山灰が風で運ばれて降り積もる", "#8a3b12");
      } else if (n === 4 && t < 0.999) {
        // ④ 川が少しずつ大地をけずって、谷が深くなる
        drawPre(0, 1);
        if (loamI >= 0 && T > 0) poly(loamI, () => H0 + T, () => H0);
        const shown = (l) => l.mode === "surface" || l.origin === "volcano";
        const g4 = (s) => { let g = -Infinity; d.layers.forEach((l, li) => { if (shown(l) && s.tops[li] - s.bots[li] > 0.05) g = Math.max(g, s.tops[li]); }); return isFinite(g) ? g : s.g; };
        const cut = (s) => Math.min(Htop, Math.max(g4(s), Htop - t * (Htop - g4(s))));
        band(() => L.zmax + 50, cut, "#eef6fb", 1); // けずられた所は空に
        ctx.beginPath(); S.forEach((s, i) => { const p = P(s.d, cut(s)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
        // 川（谷のいちばん低い所）
        const rivers = (d.rivers && d.rivers.length ? d.rivers.map((r) => r.d) : [S.reduce((a, b) => (g4(b) < g4(a) ? b : a)).d]);
        for (const rd of rivers) {
          const s = S.reduce((a, b) => (Math.abs(b.d - rd) < Math.abs(a.d - rd) ? b : a));
          const p = P(s.d, cut(s));
          ctx.fillStyle = "#1565ff"; ctx.beginPath(); ctx.ellipse(p.x, p.y - 3, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
          tag(p.x, p.y - 14, "💧川がけずる↓", "#1565ff");
        }
      } else {
        // 今の地層（けずられた後）。⑤⑥は、谷の土砂・盛土が少しずつ たまる
        const show = (l) => l.mode === "surface" || l.origin === "volcano" || (n >= 5 && l.mode === "valley") || (n >= 6 && l.origin === "human");
        const grow = (l) => (n === 5 && l.mode === "valley") || (n === 6 && l.origin === "human");
        d.layers.forEach((l, li) => { if (show(l)) poly(li, (s) => (grow(l) ? s.bots[li] + (s.tops[li] - s.bots[li]) * t : s.tops[li]), (s) => s.bots[li]); });
        if (n === 5 && t < 1) {
          const vi = d.layers.findIndex((l) => l.mode === "valley");
          if (vi >= 0) {
            let best = null; S.forEach((s) => { const th = s.tops[vi] - s.bots[vi]; if (th > 0.3 && (!best || th > best.th)) best = { s, th }; });
            if (best) { const p = P(best.s.d, best.s.bots[vi] + best.th * t); tag(p.x, p.y - 12, "🌊 川が運んだ土砂が、谷の底に たまっていく", "#1d5f99"); }
          }
        }
        if (n === 6 && t < 1) { const p = P(midD, Htop + 6); tag(p.x, p.y, "🏗️ 人が土を運んで盛り、平らな土地をつくる", "#6b4a00"); }
        // けずられた部分を点線で
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "rgba(31,42,51,0.6)"; ctx.lineWidth = 1.5;
        const y = P(0, H0 + T).y; ctx.beginPath(); ctx.moveTo(L.m.l, y); ctx.lineTo(L.W - L.m.r, y); ctx.stroke(); ctx.restore();
      }
      // 説明
      const st = this.stages().find((x) => x.n === n);
      if (st) {
        // 説明は断面図の下のほう（「上ほど新しい」などと重ならない所）に
        ctx.font = "bold 15px " + font; ctx.textAlign = "left";
        const x0 = L.m.l + 120, maxW = L.W - L.m.r - x0 - 10;
        const ageT = st.age ? "⏳ " + st.age : "";
        ctx.font = "bold 14px " + font; const wa = ctx.measureText(ageT).width;
        ctx.font = "bold 15px " + font;
        const w = Math.min(maxW, Math.max(ctx.measureText(st.text).width, wa) + 20);
        const bh = ageT ? 66 : 46, y0 = L.H - L.m.b - bh - 12;
        ctx.fillStyle = "rgba(255,253,235,0.96)"; ctx.strokeStyle = "#d4a017";
        ctx.fillRect(x0, y0, w, bh); ctx.strokeRect(x0, y0, w, bh);
        let ty = y0 + 20;
        if (ageT) { ctx.font = "bold 14px " + font; ctx.fillStyle = "#9a5b00"; ctx.fillText(ageT, x0 + 10, ty, w - 20); ty += 20; ctx.font = "bold 15px " + font; }
        ctx.fillStyle = "#1f2a33"; ctx.fillText(st.text, x0 + 10, ty, w - 20);
        ctx.font = "11px " + font; ctx.fillStyle = "#5a6873";
        ctx.fillText("※ボーリング資料から推定した、おおまかな順番です。年代は横浜のあたりの目安", x0 + 10, ty + 18, w - 20);
      }
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
    3: { age: "約13万〜1万年前ごろ", from: 130000, to: 10000 },
    4: { age: "約7万〜2万年前ごろ（寒い時代で、海面が今より100mほど低く、川が深くけずった）", from: 70000, to: 20000 },
    5: { age: "約1万年前〜今（あたたかくなって海面が上がり、谷に土砂がたまった）", from: 10000, to: 0 },
    6: { age: "約60年前〜今（町が広がったころから）", from: 60, to: 0 },
  };
  C.SectionView = SectionView;
})();
