/*
 * geo.js — 緯度経度と模型の座標の変換、国土地理院タイル（標高・地図）の読み込み
 *
 * 模型の座標: 中心（学校など）を原点に、x = 東へ何m、z = 南へ何m、y = 標高(m)
 */
(function () {
  const C = (window.CHISOU = window.CHISOU || {});
  const TILE = 256;

  function lonLatToPixel(lon, lat, z) {
    const n = TILE * Math.pow(2, z);
    const s = Math.sin((lat * Math.PI) / 180);
    return {
      x: ((lon + 180) / 360) * n,
      y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
    };
  }

  function pixelToLonLat(x, y, z) {
    const n = TILE * Math.pow(2, z);
    const t = Math.PI * (1 - (2 * y) / n);
    return { lon: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(t)) * 180) / Math.PI };
  }

  /** 中心点を原点にした「m単位のローカル座標」 */
  class Frame {
    constructor(center, half) {
      this.center = center;
      this.half = half;
      const p = lonLatToPixel(center.lon, center.lat, 20);
      this.cx = p.x;
      this.cy = p.y;
      // ズーム20での1ピクセルあたりのメートル（中心の緯度で計算）
      this.mpp = (156543.03392804097 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, 20);
    }
    toLocal(lat, lon) {
      const p = lonLatToPixel(lon, lat, 20);
      return { x: (p.x - this.cx) * this.mpp, z: (p.y - this.cy) * this.mpp };
    }
    toLatLon(x, z) {
      const ll = pixelToLonLat(this.cx + x / this.mpp, this.cy + z / this.mpp, 20);
      return { lat: ll.lat, lon: ll.lon };
    }
    toPixel(x, z, zoom) {
      const f = Math.pow(2, zoom - 20);
      return { x: (this.cx + x / this.mpp) * f, y: (this.cy + z / this.mpp) * f };
    }
  }

  function loadImage(url, timeoutMs) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      let done = false;
      const timer = setTimeout(() => finish(null), timeoutMs || 20000);
      function finish(v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      }
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = url;
    });
  }

  function tileUrl(tpl, z, x, y) {
    return tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  }

  function tileRange(frame, half, zoom) {
    const a = frame.toPixel(-half, -half, zoom);
    const b = frame.toPixel(half, half, zoom);
    return {
      a, b,
      tx0: Math.floor(a.x / TILE), tx1: Math.floor(b.x / TILE),
      ty0: Math.floor(a.y / TILE), ty1: Math.floor(b.y / TILE),
    };
  }

  /** 地理院の標高PNGタイル（1画素＝標高）を読み込み、sample(x,z)で標高を返す */
  async function loadDem(frame, half, zoom, tpl, onTile) {
    const r = tileRange(frame, half, zoom);
    const tiles = {};
    const jobs = [];
    let ok = 0;
    for (let ty = r.ty0; ty <= r.ty1; ty++) {
      for (let tx = r.tx0; tx <= r.tx1; tx++) {
        jobs.push(
          loadImage(tileUrl(tpl, zoom, tx, ty)).then((img) => {
            if (onTile) onTile();
            if (!img) return;
            const cv = document.createElement("canvas");
            cv.width = cv.height = TILE;
            const ctx = cv.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            let data;
            try {
              data = ctx.getImageData(0, 0, TILE, TILE).data;
            } catch (e) {
              return; // CORSで読めなかった
            }
            const h = new Float32Array(TILE * TILE);
            for (let i = 0; i < TILE * TILE; i++) {
              const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2];
              const v = R * 65536 + G * 256 + B;
              if (v === 8388608) h[i] = NaN; // 無効値
              else h[i] = (v < 8388608 ? v : v - 16777216) * 0.01;
            }
            tiles[tx + "/" + ty] = h;
            ok++;
          })
        );
      }
    }
    await Promise.all(jobs);
    function px(gx, gy) {
      const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
      const t = tiles[tx + "/" + ty];
      if (!t) return NaN;
      return t[(gy - ty * TILE) * TILE + (gx - tx * TILE)];
    }
    return {
      ok,
      count: jobs.length,
      sample(x, z) {
        const p = frame.toPixel(x, z, zoom);
        const fx = p.x - 0.5, fy = p.y - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const dx = fx - x0, dy = fy - y0;
        const v00 = px(x0, y0), v10 = px(x0 + 1, y0), v01 = px(x0, y0 + 1), v11 = px(x0 + 1, y0 + 1);
        if (isNaN(v00) || isNaN(v10) || isNaN(v01) || isNaN(v11)) {
          // どれかが無効なら、有効な値の平均
          let s = 0, n = 0;
          for (const v of [v00, v10, v01, v11]) if (!isNaN(v)) { s += v; n++; }
          return n ? s / n : NaN;
        }
        return v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) + v01 * (1 - dx) * dy + v11 * dx * dy;
      },
    };
  }

  /** 地図タイルをつなぎ合わせて、模型の範囲ぴったりの画像（canvas）をつくる */
  async function loadMapCanvas(frame, half, zoom, tpl, onTile, transparent) {
    const r = tileRange(frame, half, zoom);
    const W = Math.max(1, Math.round(r.b.x - r.a.x));
    const H = Math.max(1, Math.round(r.b.y - r.a.y));
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");
    if (!transparent) {
      ctx.fillStyle = "#e8e4d8";
      ctx.fillRect(0, 0, W, H);
    }
    const jobs = [];
    let ok = 0;
    for (let ty = r.ty0; ty <= r.ty1; ty++) {
      for (let tx = r.tx0; tx <= r.tx1; tx++) {
        jobs.push(
          loadImage(tileUrl(tpl, zoom, tx, ty)).then((img) => {
            if (onTile) onTile();
            if (!img) return;
            ctx.drawImage(img, tx * TILE - r.a.x, ty * TILE - r.a.y);
            ok++;
          })
        );
      }
    }
    await Promise.all(jobs);
    return { canvas: cv, ok, count: jobs.length };
  }

  const GSI = "https://cyberjapandata.gsi.go.jp/xyz/";
  C.MAP_TYPES = {
    std: { name: "地理院地図（標準）", url: GSI + "std/{z}/{x}/{y}.png", zoom: 16 },
    pale: { name: "地理院地図（淡色）", url: GSI + "pale/{z}/{x}/{y}.png", zoom: 16 },
    photo: { name: "航空写真", url: GSI + "seamlessphoto/{z}/{x}/{y}.jpg", zoom: 17 },
    local: { name: "高さで色分け（この場所用）", local: true },
    relief: { name: "色別標高図（地理院）", url: GSI + "relief/{z}/{x}/{y}.png", zoom: 15 },
    hillshade: { name: "陰影起伏図", url: GSI + "hillshademap/{z}/{x}/{y}.png", zoom: 16 },
    // 土地のなり立ちがわかる地図（主題図）
    landform: { name: "地形分類（自然地形）", url: GSI + "experimental_landformclassification1/{z}/{x}/{y}.png", zoom: 16, group: "土地のなり立ち" },
    lcmfc: { name: "治水地形分類図（川が作った地形）", url: GSI + "lcmfc2/{z}/{x}/{y}.png", zoom: 16, group: "土地のなり立ち" },
    lcm25k: { name: "土地条件図", url: GSI + "lcm25k_2012/{z}/{x}/{y}.png", zoom: 16, group: "土地のなり立ち" },
    // 昔の写真（町がどう変わったか）
    photo1974: { name: "航空写真 1974〜1978年ごろ", url: GSI + "gazo1/{z}/{x}/{y}.jpg", zoom: 17, group: "昔の写真" },
    photo1961: { name: "航空写真 1961〜1969年ごろ", url: GSI + "ort_old10/{z}/{x}/{y}.png", zoom: 17, group: "昔の写真" },
    photo1945: { name: "航空写真 1945〜1950年ごろ", url: GSI + "ort_USA10/{z}/{x}/{y}.png", zoom: 17, group: "昔の写真" },
  };
  // 重ねるハザードマップ（国土地理院 ハザードマップポータルサイト）の透明な地図
  const DISA = "https://disaportaldata.gsi.go.jp/raster/";
  C.HAZARDS = {
    flood: { name: "洪水で水につかる想定の場所（想定最大規模）", urls: [DISA + "01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png"], zoom: 16,
      legend: "水色〜赤：大雨で川があふれたとき、水につかると想定される場所（色がこいほど深い）" },
    dosha: { name: "土砂災害警戒区域（がけ崩れ・土石流・地すべり）",
      urls: [DISA + "05_kyukeishakeikaikuiki/{z}/{x}/{y}.png", DISA + "05_dosekiryukeikaikuiki/{z}/{x}/{y}.png", DISA + "05_jisuberikeikaikuiki/{z}/{x}/{y}.png"], zoom: 16,
      legend: "黄色・赤：がけ崩れや土石流などの危険がある区域" },
  };
  C.DEM_SOURCES = [
    { name: "5mメッシュ(レーザ)", url: GSI + "dem5a_png/{z}/{x}/{y}.png", zoom: 15 },
    { name: "5mメッシュ(写真)", url: GSI + "dem5b_png/{z}/{x}/{y}.png", zoom: 15 },
    { name: "10mメッシュ", url: GSI + "dem_png/{z}/{x}/{y}.png", zoom: 14 },
  ];

  C.Geo = { Frame, loadDem, loadMapCanvas, lonLatToPixel, pixelToLonLat };
})();
