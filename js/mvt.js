/*
 * mvt.js — 地図のベクトルタイル（.pbf）から、地図の文字（注記）を取り出す小さな読み取り器
 *   国土地理院の「地理院地図Vector」のタイル（experimental_bvmap）の label レイヤーを読む。
 *   しくみ：Protocol Buffers（データを小さく詰める形式）を1バイトずつ読んでいく
 */
(function () {
  const C = (window.CHISOU = window.CHISOU || {});

  function Reader(buf) { this.b = buf; this.p = 0; }
  Reader.prototype.varint = function () {
    let r = 0, s = 0, c;
    do { c = this.b[this.p++]; r += (c & 0x7f) * Math.pow(2, s); s += 7; } while (c & 0x80);
    return r;
  };
  Reader.prototype.bytes = function () { const n = this.varint(), a = this.b.subarray(this.p, this.p + n); this.p += n; return a; };
  Reader.prototype.skip = function (wt) {
    if (wt === 0) this.varint(); else if (wt === 1) this.p += 8; else if (wt === 2) this.p += this.varint(); else if (wt === 5) this.p += 4;
  };
  const utf8 = new TextDecoder("utf-8");

  function readValue(buf) {
    const r = new Reader(buf), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let v = null;
    while (r.p < buf.length) {
      const k = r.varint(), f = k >> 3, wt = k & 7;
      if (f === 1) v = utf8.decode(r.bytes());
      else if (f === 2) { v = dv.getFloat32(r.p, true); r.p += 4; }
      else if (f === 3) { v = dv.getFloat64(r.p, true); r.p += 8; }
      else if (f === 4 || f === 5) v = r.varint();
      else if (f === 6) { const z = r.varint(); v = z % 2 ? -(z + 1) / 2 : z / 2; }
      else if (f === 7) v = !!r.varint();
      else r.skip(wt);
    }
    return v;
  }
  function packed(buf) { const r = new Reader(buf), out = []; while (r.p < buf.length) out.push(r.varint()); return out; }

  /** タイルの中の、指定したレイヤーの「点」を取り出す → [{props, x, y, extent}] （x,y はタイルの中の位置） */
  function decodePoints(bytes, layerName) {
    const r = new Reader(bytes), out = [];
    while (r.p < bytes.length) {
      const k = r.varint(), f = k >> 3, wt = k & 7;
      if (f !== 3 || wt !== 2) { r.skip(wt); continue; }
      const lb = r.bytes(), lr = new Reader(lb);
      let name = "", extent = 4096;
      const keys = [], values = [], feats = [];
      while (lr.p < lb.length) {
        const k2 = lr.varint(), f2 = k2 >> 3, wt2 = k2 & 7;
        if (f2 === 1) name = utf8.decode(lr.bytes());
        else if (f2 === 2) feats.push(lr.bytes());
        else if (f2 === 3) keys.push(utf8.decode(lr.bytes()));
        else if (f2 === 4) values.push(readValue(lr.bytes()));
        else if (f2 === 5) extent = lr.varint();
        else lr.skip(wt2);
      }
      if (name !== layerName) continue;
      for (const fb of feats) {
        const fr = new Reader(fb);
        let tags = [], type = 0, geom = [];
        while (fr.p < fb.length) {
          const k3 = fr.varint(), f3 = k3 >> 3, wt3 = k3 & 7;
          if (f3 === 2) tags = packed(fr.bytes());
          else if (f3 === 3) type = fr.varint();
          else if (f3 === 4) geom = packed(fr.bytes());
          else fr.skip(wt3);
        }
        if (type !== 1 || geom.length < 3) continue; // 点だけ
        const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);
        const props = {};
        for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
        out.push({ props, x: zz(geom[1]), y: zz(geom[2]), extent });
      }
    }
    return out;
  }

  async function fetchTile(url) {
    const r = await fetch(url);
    if (!r.ok) return null;
    let buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b && typeof DecompressionStream !== "undefined") {
      const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")));
      buf = new Uint8Array(await ds.arrayBuffer());
    }
    return buf;
  }

  // 注記の種類（annoCtg）→ 目印のアイコン・大事さ
  const CAT = { 422: ["🚉", 1], 885: ["🏫", 2], 634: ["🏫", 3], 631: ["🎓", 3],
    870: ["🌳", 2], 534: ["🌳", 2], 531: ["🌲", 3],
    881: ["🏛️", 2], 880: ["🏛️", 3], 673: ["🏟️", 3],
    884: ["🚒", 3], 883: ["🚓", 4], 886: ["🏥", 3], 887: ["📮", 5],
    662: ["🛕", 4], 661: ["⛩️", 4], 532: ["🏺", 4],
    322: ["🌊", 0], 321: ["🌊", 0] };

  /** 模型の範囲の地図の文字から、目印をつくる */
  async function gsiMarks(frame, half, onProgress) {
    const z = 16, n = Math.pow(2, z);
    const a = frame.toPixel(-half, -half, z), b = frame.toPixel(half, half, z);
    const jobs = [], found = {};
    let done = 0;
    for (let ty = Math.floor(a.y / 256); ty <= Math.floor(b.y / 256); ty++) {
      for (let tx = Math.floor(a.x / 256); tx <= Math.floor(b.x / 256); tx++) {
        jobs.push(fetchTile("https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/" + z + "/" + tx + "/" + ty + ".pbf").catch(() => null).then((buf) => {
          if (onProgress) onProgress(++done);
          if (!buf) return;
          for (const p of decodePoints(buf, "label")) {
            const cat = CAT[p.props.annoCtg];
            if (!cat || !p.props.knj) continue;
            const X = tx + p.x / p.extent, Y = ty + p.y / p.extent;
            const lon = (X / n) * 360 - 180, lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / n))) * 180) / Math.PI;
            const name = String(p.props.knj).replace(/^(市立|都立|県立|区立|町立|村立)/, "");
            const key = name + cat[0];
            if (!found[key]) found[key] = { name, icon: cat[0], pri: cat[1], lat, lon, area: 0 };
          }
        }));
      }
    }
    await Promise.all(jobs);
    return Object.values(found);
  }

  /** タイルの中の、指定したレイヤーの「線」を取り出す → [{props, lines:[[[x,y],...]], extent}] */
  function decodeLines(bytes, layerName) {
    const r = new Reader(bytes), out = [];
    while (r.p < bytes.length) {
      const k = r.varint(), f = k >> 3, wt = k & 7;
      if (f !== 3 || wt !== 2) { r.skip(wt); continue; }
      const lb = r.bytes(), lr = new Reader(lb);
      let name = "", extent = 4096;
      const keys = [], values = [], feats = [];
      while (lr.p < lb.length) {
        const k2 = lr.varint(), f2 = k2 >> 3, wt2 = k2 & 7;
        if (f2 === 1) name = utf8.decode(lr.bytes());
        else if (f2 === 2) feats.push(lr.bytes());
        else if (f2 === 3) keys.push(utf8.decode(lr.bytes()));
        else if (f2 === 4) values.push(readValue(lr.bytes()));
        else if (f2 === 5) extent = lr.varint();
        else lr.skip(wt2);
      }
      if (name !== layerName) continue;
      const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);
      for (const fb of feats) {
        const fr = new Reader(fb);
        let tags = [], type = 0, geom = [];
        while (fr.p < fb.length) {
          const k3 = fr.varint(), f3 = k3 >> 3, wt3 = k3 & 7;
          if (f3 === 2) tags = packed(fr.bytes());
          else if (f3 === 3) type = fr.varint();
          else if (f3 === 4) geom = packed(fr.bytes());
          else fr.skip(wt3);
        }
        if (type !== 2) continue; // 線だけ
        const props = {};
        for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
        const lines = []; let cur = null, x = 0, y = 0, i = 0;
        while (i < geom.length) {
          const c = geom[i++], id = c & 7, cnt = c >> 3;
          for (let j = 0; j < cnt && (id === 1 || id === 2); j++) {
            x += zz(geom[i++]); y += zz(geom[i++]);
            if (id === 1) { cur = []; lines.push(cur); }
            cur.push([x, y]);
          }
        }
        out.push({ props, lines, extent });
      }
    }
    return out;
  }
  /** 模型の範囲の線路（国土地理院の地図の「鉄道中心線」）。JR かどうか・トンネルかどうかも */
  async function gsiRails(frame, half) {
    const z = 14, n = Math.pow(2, z);
    const a = frame.toPixel(-half, -half, z), b = frame.toPixel(half, half, z);
    const jobs = [], out = [];
    for (let ty = Math.floor(a.y / 256); ty <= Math.floor(b.y / 256); ty++) {
      for (let tx = Math.floor(a.x / 256); tx <= Math.floor(b.x / 256); tx++) {
        jobs.push(fetchTile("https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/" + z + "/" + tx + "/" + ty + ".pbf").catch(() => null).then((buf) => {
          if (!buf) return;
          for (const f of decodeLines(buf, "railway")) {
            // 車両基地などの側線（snglDbl＝3、路線コードなし）はかかない。本線（単線・複線・駅の部分）だけ
            if (!f.props.rtCode || f.props.snglDbl === 3) continue;
            const rt = String(f.props.rtCode || "");
            // 路線コードの5けた目：1＝JR、2＝JR以外（私鉄など）
            const jr = rt.length > 4 ? rt.charAt(4) === "1" : false;
            const tunnel = f.props.railState === 2 || f.props.railState === 3;
            for (const ln of f.lines) {
              out.push({ jr, tunnel, pts: ln.map(([x, y]) => {
                const X = tx + x / f.extent, Y = ty + y / f.extent;
                return { lon: (X / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / n))) * 180) / Math.PI };
              }) });
            }
          }
        }));
      }
    }
    await Promise.all(jobs);
    return out;
  }

  C.MVT = { decodePoints, decodeLines, gsiMarks, gsiRails };
})();
