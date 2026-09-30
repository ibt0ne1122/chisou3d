/*
 * 流れる水の実験（シミュレーション）
 * 教科書の「水そうに、とい（坂）から土砂を水といっしょに流しこむ実験」を画面で再現する。
 * つぶが大きく重いほど早くしずむ（れき → 砂 → どろ）ので、
 *   ・入り口の近くには れき、遠くには どろ が積もる（横の分かれ方）
 *   ・1回流すごとに、下に れき・上に どろ の層ができる（たての重なり）
 * ことが見られる。数値は見やすさのための目安で、本物の速さではない。
 */
(function () {
  const C = window.CHISOU;
  const W = 720, H = 380;           // 絵の大きさ（ピクセル）
  const WATER_X = 130, WATER_Y = 96, BOTTOM = H - 18, COL = 2;
  const KINDS = [
    { id: "gravel", name: "れき", color: "#6b5a48", r: 3.4, sink: 110, n: 45 },
    { id: "sand", name: "砂", color: "#d8b24a", r: 2.0, sink: 32, n: 140 },
    { id: "mud", name: "どろ", color: "#8f8f8f", r: 1.3, sink: 10, n: 260 },
  ];
  let box, cv, ctx, sed, sctx, bed, parts, pours, spawnLeft, raf, last, speed, msgEl, t0, flow = 1;

  function reset() {
    bed = new Float32Array(Math.ceil(W / COL));
    parts = []; pours = 0; spawnLeft = []; speed = 2.5; flow = 1;
    if (box) box.querySelector('[data-a="fast"]').classList.remove("on");
    sctx.clearRect(0, 0, W, H);
    msg("「🌊 土砂を流す」を押してみよう。どこに、どのつぶが積もるかな？");
    draw();
  }
  function msg(t) { if (msgEl) msgEl.innerHTML = t; }

  function pour() {
    pours++;
    // れき・砂・どろ をまぜて、少しずつ流しこむ
    const list = [];
    for (const k of KINDS) for (let i = 0; i < k.n; i++) list.push(k);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    spawnLeft = spawnLeft.concat(list);
    msg("🌊 " + pours + "回目：土砂を水といっしょに流しこんでいます…　<b>どのつぶが先にしずむかな？</b>");
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
  }

  function spawn(dt) {
    const rate = 150; // 1秒あたりのつぶ
    let k = Math.min(spawnLeft.length, Math.max(1, Math.round(rate * dt)));
    while (k-- > 0) {
      const kind = spawnLeft.pop();
      // とい（坂）の上から出発
      parts.push({ kind, x: 10 + Math.random() * 14, y: 38 + Math.random() * 6, vx: 0, vy: 0, onRamp: true, seed: Math.random() * 10, sk: 0.55 + Math.random() * 0.9 });
    }
  }

  function rampY(x) { return 44 + (x / WATER_X) * (WATER_Y + 4 - 44); }
  function bedTop(x) { const c = Math.max(0, Math.min(bed.length - 1, Math.floor(x / COL))); return BOTTOM - bed[c]; }

  function deposit(p) {
    let c = Math.max(Math.floor(WATER_X / COL), Math.min(bed.length - 1, Math.floor(p.x / COL)));
    // 山になりすぎたら、低いとなりへころがる
    for (let g = 0; g < 40; g++) {
      const l = c > 0 ? bed[c - 1] : Infinity, r = c < bed.length - 1 ? bed[c + 1] : Infinity;
      if (bed[c] - Math.min(l, r) <= 2.2) break;
      c += l < r ? -1 : 1;
      if (c * COL < WATER_X) { c = Math.floor(WATER_X / COL); break; }
    }
    const add = (Math.PI * p.kind.r * p.kind.r * 0.55) / COL;
    const y1 = BOTTOM - bed[c] - add;
    sctx.fillStyle = p.kind.color;
    sctx.fillRect(c * COL, y1, COL, add + 0.6);
    bed[c] += add;
  }

  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000) * speed;
    last = now;
    if (spawnLeft.length) { spawn(dt); flow = 1; }
    else flow *= Math.exp(-dt / 6); // 流しこむのをやめると、水の流れはだんだん止まる
    const keep = [];
    for (const p of parts) {
      if (p.onRamp) {
        // とい の上をすべり落ちる
        p.x += 230 * dt;
        p.y = rampY(p.x) - 3 - Math.random() * 2;
        if (p.x >= WATER_X) { p.onRamp = false; p.vx = 60 + Math.random() * 200; p.vy = 20; }
        keep.push(p);
        continue;
      }
      // 水の中：流れはだんだん弱くなる。重いつぶほど早くしずむ
      // 流しこんだ勢いはすぐ弱まり、あとは ゆるい流れ（遠くほど弱い）に運ばれる
      const cur = 46 * flow * Math.exp(-(p.x - WATER_X) / 520);
      p.vx = cur + (p.vx - cur) * Math.exp(-2.2 * dt);
      const sink = p.kind.sink * p.sk * (0.85 + 0.3 * Math.sin(p.seed + now / 400));
      p.vy += (sink - p.vy) * Math.min(1, 6 * dt);
      p.x += p.vx * dt + Math.sin(p.seed * 3 + now / 300) * 6 * dt;
      p.y += p.vy * dt;
      if (p.x > W - 6) { p.x = W - 6; p.vx = -Math.abs(p.vx) * 0.2; }
      if (p.y >= bedTop(p.x)) { deposit(p); continue; }
      keep.push(p);
    }
    parts = keep;
    draw();
    if (parts.length || spawnLeft.length) raf = requestAnimationFrame(step);
    else {
      raf = 0;
      msg("✅ " + pours + "回目が積もりました。<b>入り口の近く</b>と<b>遠く</b>で、積もったつぶはどうちがう？　" +
        (pours === 1 ? "もう一度流すと、どうなるかな？" : "<b>たて</b>に見ると、1回ごとに下から れき→砂→どろ の順に重なっているね。"));
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // 水そう
    ctx.fillStyle = "#f4f8fb"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(90,169,230,0.28)"; ctx.fillRect(WATER_X, WATER_Y, W - WATER_X - 4, BOTTOM - WATER_Y);
    // にごり（まだしずんでいない どろ が多いほど にごる）
    const mud = parts.filter((p) => !p.onRamp && p.kind.id === "mud").length;
    if (mud) { ctx.fillStyle = "rgba(140,120,90," + Math.min(0.25, mud / 1500) + ")"; ctx.fillRect(WATER_X, WATER_Y, W - WATER_X - 4, BOTTOM - WATER_Y); }
    ctx.drawImage(sed, 0, 0);
    // 水面・かべ
    ctx.strokeStyle = "#3d8fd1"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(WATER_X, WATER_Y); ctx.lineTo(W - 4, WATER_Y); ctx.stroke();
    ctx.strokeStyle = "#556"; ctx.lineWidth = 3; ctx.strokeRect(WATER_X - 2, 60, W - WATER_X - 2, BOTTOM - 58);
    // とい（坂）
    ctx.strokeStyle = "#8a6d3b"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(4, 46); ctx.lineTo(WATER_X + 6, rampY(WATER_X + 6) + 2); ctx.stroke();
    // つぶ
    for (const p of parts) { ctx.fillStyle = p.kind.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.kind.r, 0, Math.PI * 2); ctx.fill(); }
    // 目じるし
    ctx.fillStyle = "#1f2a33"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("とい（坂）", 8, 30);
    ctx.fillText("入り口に近い", WATER_X + 6, WATER_Y + 18);
    ctx.textAlign = "right"; ctx.fillText("遠い", W - 10, WATER_Y + 18);
    if (pours) { ctx.textAlign = "left"; ctx.font = "12px sans-serif"; ctx.fillText("流した回数：" + pours + "回", 8, H - 4); }
  }

  function open() {
    if (!box) {
      box = document.createElement("div");
      box.id = "labBox";
      box.innerHTML = '<div class="lab-card"><div class="fc-head"><b>🧪 流れる水の実験（水そうに土砂を流す）</b><button type="button" class="fc-x" aria-label="とじる" title="とじる">✕</button></div>' +
        '<canvas width="' + W + '" height="' + H + '"></canvas>' +
        '<div class="lab-legend">' + KINDS.map((k) => '<span><i style="background:' + k.color + '"></i>' + k.name + "（" + (k.id === "gravel" ? "大きい・重い" : k.id === "sand" ? "中くらい" : "小さい・軽い") + "）</span>").join("") + "</div>" +
        '<p class="lab-msg"></p>' +
        '<div class="btnrow"><button type="button" class="primary" data-a="pour">🌊 土砂を流す</button><button type="button" data-a="fast">⏩ 早送り</button><button type="button" data-a="reset">↺ はじめから</button></div>' +
        '<p class="hint">教科書の実験を画面でためすシミュレーションです。つぶの動きは見やすくしてあり、本物の速さや量とはちがいます。本物の実験と見くらべよう。</p></div>';
      document.body.appendChild(box);
      cv = box.querySelector("canvas"); ctx = cv.getContext("2d");
      sed = document.createElement("canvas"); sed.width = W; sed.height = H; sctx = sed.getContext("2d");
      msgEl = box.querySelector(".lab-msg");
      box.querySelector(".fc-x").onclick = close;
      box.addEventListener("click", (e) => { if (e.target === box) close(); });
      box.querySelector('[data-a="pour"]').onclick = pour;
      box.querySelector('[data-a="fast"]').onclick = (e) => { speed = speed < 5 ? 7 : 2.5; e.target.classList.toggle("on", speed > 5); };
      box.querySelector('[data-a="reset"]').onclick = () => { cancelAnimationFrame(raf); raf = 0; reset(); };
      reset();
    }
    box.classList.remove("hidden");
    t0 = performance.now();
  }
  function close() { if (box) box.classList.add("hidden"); }

  C.FlowLab = { open, close };
})();
