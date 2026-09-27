/*
 * boringxml.js — ボーリング柱状図のXML（ボーリング交換用データ BED0210/0300/0400）を読み込む
 *
 * 国土地盤情報検索サイトなどでダウンロードできる、国の電子納品の形式。
 * タグ名が版によって少しちがうので、名前の一部で探す「ゆるい」読み方をしている。
 */
(function () {
  const C = (window.CHISOU = window.CHISOU || {});

  /** ファイルの文字コード（Shift_JIS / UTF-8）を見分けて文字にする */
  function decode(buf) {
    const head = new TextDecoder("ascii").decode(buf.slice(0, 300));
    const m = head.match(/encoding=["']([^"']+)["']/i);
    let enc = m ? m[1].toLowerCase() : "utf-8";
    if (/shift|sjis|ms932|windows-31j/.test(enc)) enc = "shift_jis";
    if (/euc/.test(enc)) enc = "euc-jp";
    try { return new TextDecoder(enc).decode(buf); } catch (e) { return new TextDecoder("utf-8").decode(buf); }
  }

  const num = (s) => {
    if (s == null) return NaN;
    const v = parseFloat(String(s).replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d.\-]/g, ""));
    return v;
  };
  const txt = (el) => (el ? el.textContent.trim() : "");
  /** 名前が pattern に合う最初の要素 */
  function find(root, pattern) {
    const all = root.getElementsByTagName("*");
    for (const el of all) if (pattern.test(el.tagName)) return el;
    return null;
  }
  function findAll(root, pattern) {
    return Array.from(root.getElementsByTagName("*")).filter((el) => pattern.test(el.tagName));
  }
  function childBy(el, pattern) {
    for (const c of el.children) if (pattern.test(c.tagName)) return c;
    return null;
  }

  /** 度・分・秒 → 度 */
  function dms(root, kind) {
    const d = num(txt(find(root, new RegExp("^" + kind + "_度$"))));
    const m = num(txt(find(root, new RegExp("^" + kind + "_分$"))));
    const s = num(txt(find(root, new RegExp("^" + kind + "_秒$"))));
    if (!isNaN(d)) return d + (isNaN(m) ? 0 : m / 60) + (isNaN(s) ? 0 : s / 3600);
    const v = num(txt(find(root, new RegExp("^" + kind + "$"))));
    return v;
  }

  /** 日本測地系（昔の座標）→ 世界測地系 のおおよその変換（誤差は数m） */
  function tokyoToWgs(lat, lon) {
    return {
      lat: lat - 0.00010695 * lat + 0.000017464 * lon + 0.0046017,
      lon: lon - 0.000046038 * lat - 0.000083043 * lon + 0.01004,
    };
  }

  /**
   * 土の名前 → 模型の層（いちばん後ろに出てくる言葉を「主な土」とみなす）
   *   例：「砂礫」→れき、「礫混じり砂」→砂、「砂質シルト」→シルト
   */
  function guessLayer(soil, n, depth, layerIds) {
    const has = (id) => layerIds.includes(id);
    const s = String(soil || "");
    if (/盛土|埋土|表土|客土|舗装|アスファルト|コンクリート/.test(s) && has("fill")) return "fill";
    // 凝灰質粘土＝火山灰が変化してできたねんど（ローム層の下部）
    if (/ローム|火山灰|軽石|スコリア|凝灰質|浮石|黒ボク|黒ぼく/.test(s) && !/凝灰岩/.test(s) && has("loam")) return "loam";
    if (/腐植|有機質|泥炭/.test(s) && has("alluvium")) return "alluvium";
    if (/泥岩|土丹|固結|砂岩|凝灰岩|岩盤|頁岩/.test(s) && has("mudstone")) return "mudstone";
    const keys = [["砂", "sand"], ["礫", "gravel"], ["れき", "gravel"], ["レキ", "gravel"], ["玉石", "gravel"], ["砂利", "gravel"], ["シルト", "silt"], ["粘土", "silt"], ["粘性土", "silt"], ["岩", "mudstone"]];
    let best = null, bi = -1;
    for (const [k, id] of keys) { const i = s.lastIndexOf(k); if (i > bi) { bi = i; best = id; } }
    if (best === "silt") {
      // やわらかい（N値が小さい）ねんど・シルトは、谷にたまった新しい層（沖積層）と考える
      if (has("alluvium") && !isNaN(n) && n <= 4) return "alluvium";
      return has("clay") ? "clay" : null;
    }
    if (best && has(best)) return best;
    return /土/.test(s) && has("clay") ? "clay" : null;
  }

  /** XML文字列 → ボーリングのデータ（模型の形式） */
  /** fallback: {lat, lon} … XMLに座標がないときに使う位置（データベースの地図の点など） */
  function parse(text, layerIds, fileName, fallback) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error((fileName || "") + "：XMLとして読めませんでした");
    const root = doc.documentElement;
    let lat = dms(root, "緯度"), lon = dms(root, "経度");
    let posNote = "";
    if ((isNaN(lat) || isNaN(lon) || lat === 0) && fallback) { lat = fallback.lat; lon = fallback.lon; posNote = "（位置はデータベースの地図の点）"; }
    if (isNaN(lat) || isNaN(lon)) throw new Error((fileName || "") + "：緯度・経度が見つかりませんでした");
    const datum = txt(find(root, /測地系/));
    let datumNote = "";
    // 測地系コード：0＝日本測地系（古い座標）、1・2＝世界測地系
    if (posNote) { /* 変換しない */ } else if (/日本|tokyo/i.test(datum) || (/^\d+$/.test(datum) && parseInt(datum, 10) === 0)) { const w = tokyoToWgs(lat, lon); lat = w.lat; lon = w.lon; datumNote = "（日本測地系から変換）"; }
    const project = txt(find(root, /^調査名$/)) || txt(find(root, /事業工事名/));
    const no = txt(find(root, /^ボーリング名$/));
    const shortProject = project.replace(/(に伴う|に係る|のための|における|地質調査|土質調査|地盤調査|調査業務|業務委託|設計業務).*$/, "").replace(/^(令和|平成|昭和|R|H)\S*年度/, "").trim();
    const name = (shortProject ? shortProject.slice(0, 16) + (shortProject.length > 16 ? "…" : "") + " " : "") + (no || "") || (fileName || "ボーリング").replace(/\.xml$/i, "");
    const date = txt(find(root, /調査期間_開始年月日|調査期間_開始年|調査期間/)).split(/\s+/)[0];
    const elevEl = find(root, /^孔口標高$/) || find(root, /^孔口標高/);
    let elevation = num(txt(elevEl && elevEl.children.length ? elevEl.children[0] : elevEl));
    // 標準貫入試験（N値）
    const spt = findAll(root, /^標準貫入試験$/).map((el) => ({
      d: num(txt(childBy(el, /開始深度/))),
      n: num(txt(childBy(el, /合計打撃回数|N値/))),
    })).filter((x) => !isNaN(x.d) && !isNaN(x.n));
    // 土の区分：「岩石土区分」を優先、なければ「工学的地質区分名現場土質名」
    let items = [];
    // 版によって名前がちがう：4.00＝工学的地質区分名現場土質名、3.00＝岩石土区分、2.10＝土質岩種区分
    for (const pat of [/^岩石土区分$/, /^工学的地質区分名現場土質名$/, /^土質岩種区分$/, /^土質区分$/]) {
      items = findAll(root, pat).map((el) => {
        const s1 = txt(childBy(el, /土質岩種区分1$/)), s2 = txt(childBy(el, /土質岩種区分2$/));
        const soil = s1 ? s1 + (s2 ? "・" + s2 : "") : txt(childBy(el, /(岩石土名|現場土質名|土質名)$/)) || txt(childBy(el, /名$/));
        return { to: num(txt(childBy(el, /下端深度/))), soil, key: s1 || soil };
      }).filter((x) => !isNaN(x.to));
      if (items.length) break;
    }
    if (!items.length) throw new Error((fileName || "") + "：地層（下端深度）が見つかりませんでした");
    items.sort((a, b) => a.to - b.to);
    let from = 0;
    let seenOld = false; // ローム層や固い地層をすでに通ったか
    const logs = items.map((it) => {
      const ns = spt.filter((x) => x.d >= from && x.d < it.to).map((x) => x.n);
      const n = ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : NaN;
      let layer = guessLayer(it.key || it.soil, n, from, layerIds) || (layerIds.includes("clay") ? "clay" : layerIds[layerIds.length - 1]);
      // 古い層の下にあるやわらかいねんどは、谷にたまった新しい層（沖積層）ではない
      if (layer === "alluvium" && seenOld && !/腐植|有機質|泥炭/.test(it.soil)) layer = layerIds.includes("clay") ? "clay" : layer;
      if (!["fill", "alluvium"].includes(layer)) seenOld = true;
      const row = { to: +it.to.toFixed(2), layer, soil: it.soil, auto: true };
      if (!isNaN(n)) row.n = n;
      from = it.to;
      return row;
    });
    const b = {
      id: "xml-" + (name + lat.toFixed(5) + lon.toFixed(5)).split("").reduce((h, c) => ((h * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36),
      name,
      lat: +lat.toFixed(6), lon: +lon.toFixed(6),
      source: "国土地盤情報データベース（一般財団法人国土地盤情報センター）" + (project ? "／" + project + (date ? "（" + date + "）" : "") : ""),
      note: "XMLから読み込み" + datumNote + posNote + "。層の当てはめは自動なので、先生が確認してください。",
      logs,
    };
    if (!isNaN(elevation)) b.elevation = elevation;
    return b;
  }

  /** 1本分：文字コードを見分けて読む（だめなら別の文字コードでも試す） */
  function parseBuffer(buf, layerIds, name, fallback) {
    let err = null;
    for (const enc of [null, "utf-8", "shift_jis"]) {
      try { return parse(enc ? new TextDecoder(enc).decode(buf) : decode(buf), layerIds, name, fallback); }
      catch (e) { err = err || e; }
    }
    throw err;
  }

  /** ブックマークレットで作った「柱状図まとめ」ファイル（.json）を読む */
  function readBundle(js, layerIds, ok, ng) {
    const names = {};
    for (const it of js.items || []) {
      try {
        const bin = Uint8Array.from(atob(it.xml), (c) => c.charCodeAt(0));
        const b = parseBuffer(bin.buffer, layerIds, it.id, { lat: it.lat, lon: it.lon });
        const off = Math.hypot((b.lon - it.lon) * 90500, (b.lat - it.lat) * 111000);
        if (off > 100) { b.lat = +(+it.lat).toFixed(6); b.lon = +(+it.lon).toFixed(6); b.note += "（位置はデータベースの地図の点に合わせた）"; }
        b.id = "ngic-" + it.id;
        b.url = "https://publicweb.ngic.or.jp/public/publicweb.php";
        b.note = "国土地盤情報データベースのID：" + it.id + "。" + b.note;
        names[b.name] = (names[b.name] || 0) + 1;
        if (names[b.name] > 1) b.name += "-" + names[b.name];
        ok.push(b);
      } catch (e) { ng.push(it.id + "：" + (e.message || e)); }
    }
  }

  async function readFiles(files, layerIds) {
    const ok = [], ng = [];
    for (const f of files) {
      if (/\.json$/i.test(f.name)) {
        try {
          const js = JSON.parse(await f.text());
          if (js.type === "chisou3d-ngic-bundle") { readBundle(js, layerIds, ok, ng); continue; }
          ng.push(f.name + "：柱状図まとめファイルではありません");
        } catch (e) { ng.push(f.name + "：読めませんでした"); }
        continue;
      }
      const buf = await f.arrayBuffer();
      let err = null, done = false;
      // 書いてある文字コードで読み、だめなら別の文字コードでも試す
      for (const enc of [null, "utf-8", "shift_jis"]) {
        try {
          const text = enc ? new TextDecoder(enc).decode(buf) : decode(buf);
          ok.push(parse(text, layerIds, f.name));
          done = true;
          break;
        } catch (e) { err = err || e; }
      }
      if (!done) ng.push(err.message || String(err));
    }
    return { ok, ng };
  }

  /**
   * 土の名前 →「つぶの大きさ」の仲間（教科書の言葉）：れき・砂・どろ・火山灰・人が盛った土
   *   れき…2mm以上／砂…0.06〜2mm／どろ…0.06mm以下（ねんど・シルト・泥岩も どろ の仲間）
   */
  function grainOf(soil, layer) {
    const s = String(soil || "");
    if (layer === "fill" || /盛土|埋土|表土|客土|舗装|コンクリート/.test(s)) return "fill";
    if (layer === "loam" || /ローム|火山灰|軽石|スコリア|凝灰質|浮石|黒ボク|黒ぼく/.test(s)) return "ash";
    const keys = [["砂", "sand"], ["礫", "gravel"], ["れき", "gravel"], ["レキ", "gravel"], ["玉石", "gravel"], ["砂利", "gravel"],
      ["シルト", "mud"], ["粘土", "mud"], ["粘性土", "mud"], ["泥", "mud"], ["どろ", "mud"], ["土丹", "mud"], ["腐植", "mud"], ["有機質", "mud"]];
    let best = null, bi = -1;
    for (const [k, id] of keys) { const i = s.lastIndexOf(k); if (i > bi) { bi = i; best = id; } }
    if (best) return best;
    return { gravel: "gravel", sand: "sand", clay: "mud", mudstone: "mud", alluvium: "mud" }[layer] || "unknown";
  }
  C.GRAINS = {
    gravel: { name: "れき", color: "#c8955a", desc: "つぶが2mm以上（ゴマのつぶより大きい）" },
    sand: { name: "砂", color: "#e6cf7e", desc: "つぶが0.06〜2mm（塩のつぶくらい）" },
    mud: { name: "どろ", color: "#7d8f99", desc: "つぶが0.06mm以下（かたくり粉くらい）。ねんど・シルト・泥岩もなかま" },
    ash: { name: "火山灰", color: "#b5523b", desc: "火山からふき出された物（関東ローム層）" },
    fill: { name: "人が盛った土", color: "#bdb3a3", desc: "家や道路をつくるときに盛った土" },
    unknown: { name: "その他", color: "#cccccc", desc: "" },
  };
  C.ORIGINS = {
    water: { icon: "💧", name: "水のはたらき" },
    volcano: { icon: "🌋", name: "火山のはたらき" },
    human: { icon: "👷", name: "人がつくった" },
  };

  C.BoringXML = { parse, parseBuffer, readFiles, guessLayer, decode, grainOf };
})();
