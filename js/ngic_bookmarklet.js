/*
 * ngic_bookmarklet.js — 国土地盤情報データベースの閲覧画面で動かす「柱状図あつめ」ブックマークレット
 *
 * 使い方：国土地盤情報データベース（https://publicweb.ngic.or.jp/public/publicweb.php）で「閲覧」を押して地図を開き、
 *         お気に入り（ブックマーク）に登録したこのボタンを押す。
 *         → 中心の緯度経度と半径を聞かれる → まわりの柱状図XMLを1本ずつ（間をあけて）集める
 *         → 「柱状図まとめ_○本.json」がダウンロードされる → 3D土地模型の「📄 柱状図XMLを読み込む」で読み込む
 * 閲覧画面の中で動くので、画面で1本ずつダウンロードするのと同じあつかい。サーバーに負担をかけないよう、ゆっくり集める。
 */
(function () {
  const C = (window.CHISOU = window.CHISOU || {});

  function collector() {
    if (!/ngic\.or\.jp/.test(location.host)) {
      alert("国土地盤情報データベースの地図（閲覧画面）を開いてから押してください。\nhttps://publicweb.ngic.or.jp/public/publicweb.php →「閲覧」");
      return;
    }
    var def = "";
    try { var c = window.app && app.map && app.map.getCenter(); if (c) def = c.lat.toFixed(6) + "," + c.lng.toFixed(6); } catch (e) {}
    var ll = prompt("模型の中心の「緯度,経度」を入れてください（いまの地図の中心が入っています）", def);
    if (!ll) return;
    var mm = ll.match(/(-?\d+\.\d+)[,\s、]+(-?\d+\.\d+)/);
    if (!mm) { alert("「35.530280,139.490678」のような形で入れてください"); return; }
    var lat0 = +mm[1], lon0 = +mm[2];
    var R = +prompt("集める半径（m）を入れてください（例：1000〜3000）", "2000");
    if (!R) return;
    var box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:99999;top:10px;left:50%;transform:translateX(-50%);background:#fff;border:3px solid #1f7a8c;border-radius:12px;padding:12px 18px;font:16px sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.3);max-width:90vw";
    document.body.appendChild(box);
    var say = function (t) { box.textContent = t; };
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var z = 13, n = Math.pow(2, z);
    var tile = function (lat, lon) { var s = Math.sin(lat * Math.PI / 180); return [Math.floor((lon + 180) / 360 * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)]; };
    var dl = R * 1.05 / 111000, dn = R * 1.05 / (111000 * Math.cos(lat0 * Math.PI / 180));
    var a = tile(lat0 + dl, lon0 - dn), b = tile(lat0 - dl, lon0 + dn);
    (async function () {
      var list = {};
      for (var x = a[0]; x <= b[0]; x++) for (var y = a[1]; y <= b[1]; y++) {
        say("ボーリングの場所を調べています…");
        var js = null;
        for (var t = 0; t < 4 && !js; t++) {
          try { var r = await fetch("/viewer/server/markers.php?x=" + x + "&y=" + y + "&z=" + z); js = await r.json(); } catch (e) { await sleep(5000); }
        }
        if (js && js.data) js.data.values.forEach(function (v) { list[v.id] = v; });
        await sleep(2000);
      }
      var items = Object.keys(list).map(function (k) {
        var v = list[k], dx = (v.longitude - lon0) * 111000 * Math.cos(lat0 * Math.PI / 180), dy = (v.latitude - lat0) * 111000;
        v.dist = Math.round(Math.hypot(dx, dy)); return v;
      }).filter(function (v) { return v.dist <= R; }).sort(function (p, q) { return p.dist - q.dist; });
      if (!items.length) { say("この範囲にはボーリングが見つかりませんでした。"); return; }
      if (!confirm(items.length + "本のボーリングが見つかりました。柱状図を集めます（約" + Math.ceil(items.length * 3 / 60) + "分）。\nこの画面を開いたままにしてください。始めますか？")) { box.remove(); return; }
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var v = items[i];
        say("柱状図を集めています… " + (i + 1) + " / " + items.length + "（この画面を閉じないでください）");
        var ok = false;
        for (var t2 = 0; t2 < 5 && !ok; t2++) {
          await sleep(t2 ? 8000 : 2500); // ゆっくり（サーバーに負担をかけない）
          try {
            var r2 = await fetch("/viewer/refer/?data=boring&type=xml&id=" + v.id);
            var buf = new Uint8Array(await r2.arrayBuffer());
            if (buf.length > 500) {
              var s = "";
              for (var k = 0; k < buf.length; k += 8192) s += String.fromCharCode.apply(null, buf.subarray(k, k + 8192));
              out.push({ id: String(v.id), lat: v.latitude, lon: v.longitude, dist: v.dist, xml: btoa(s) });
              ok = true;
            }
          } catch (e) {}
        }
      }
      var blob = new Blob([JSON.stringify({ type: "chisou3d-ngic-bundle", center: { lat: lat0, lon: lon0 }, radius: R, date: new Date().toISOString(), items: out })], { type: "application/json" });
      var el = document.createElement("a");
      el.href = URL.createObjectURL(blob);
      el.download = "柱状図まとめ_" + out.length + "本.json";
      document.body.appendChild(el);
      el.click();
      say("できました！ " + out.length + "本の柱状図を「柱状図まとめ_" + out.length + "本.json」に保存しました。3D土地模型の先生モード →「📄 柱状図XMLを読み込む」で読み込んでください。");
    })();
  }

  C.NGIC_BOOKMARKLET = "javascript:" + encodeURIComponent("(" + collector.toString() + ")()");
})();
