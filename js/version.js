/*
 * version.js — いま開いている画面の「版」を出し、公開されている版より古ければ「読み込み直す」を出す
 *   版の名前は公開のとき（tools/make_public.sh）に書きこまれる。開発中の画面では「開発中」。
 *   <span data-chisou-ver></span> に版を書き、画面の上に新しい版のお知らせを出す。
 */
(function () {
  var MY = "2026.11.13-1802"; // 公開のときに、版の名前（例：2026.11.12-1530）に置きかわる
  var dev = MY.indexOf("__") === 0;
  function label(v) { return dev ? "開発中" : v; }
  function show() {
    var els = document.querySelectorAll("[data-chisou-ver]");
    for (var i = 0; i < els.length; i++) els[i].textContent = label(MY);
  }
  function reloadFresh() {
    // iPad の Safari が古い画面を覚えていても、新しく読み直すように、アドレスに印をつける
    var u = new URL(location.href);
    u.searchParams.set("_r", Date.now().toString(36));
    location.replace(u.href);
  }
  function check() {
    if (dev || !/^https?:$/.test(location.protocol)) return;
    fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.v || j.v === MY || document.getElementById("verBanner")) return;
      var b = document.createElement("div");
      b.id = "verBanner";
      b.style.cssText = "position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:9999;background:#fff4dc;border:2px solid #c98a00;border-radius:14px;padding:6px 10px;font:bold 14px/1.5 'BIZ UDPGothic',sans-serif;color:#5c3a00;box-shadow:0 2px 10px rgba(0,0,0,.2);display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:94vw";
      b.innerHTML = "🔄 新しい版（" + j.v + "）があります。この画面は " + MY + " 版です。";
      var go = document.createElement("button");
      go.textContent = "読み込み直す";
      go.style.cssText = "background:#1f7a8c;color:#fff;border:0;border-radius:10px;padding:4px 12px;font:bold 14px sans-serif";
      go.onclick = reloadFresh;
      var x = document.createElement("button");
      x.textContent = "✕"; x.style.cssText = "background:none;border:0;font-size:16px";
      x.onclick = function () { b.remove(); };
      b.appendChild(go); b.appendChild(x);
      document.body.appendChild(b);
    }).catch(function () {});
  }
  window.CHISOU_VERSION = { v: MY, dev: dev, reload: reloadFresh };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { show(); check(); });
  else { show(); check(); }
})();
