/*
 * help.js — ボタンのヒント（ツールチップ）・使い方ガイド・根拠と出典
 */
(function () {
  const C = (window.CHISOU = window.CHISOU || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- ボタンのヒント ----------
  const TIPS = {
    "#controlsToggle": "操作パネルを開く／しまう",
    "#mapSelect": "模型の表面にはる地図をえらびます。「高さで色分け」にすると、低い所（青）と高い所（赤）がよくわかります",
    "#reliefSelect": "デコボコの見せ方をえらびます。色分け・等高線・段々模型にすると、高さを強調しすぎなくても高い所と低い所がわかります",
    "#secShowBores": "わかっているボーリングの柱を断面図に表示する／かくす",
    "#secRedo": "断面の線を消して、最初から引き直します",
    "#qLift": "ボーリングの柱を地上に引き出す／もどす（すぐに切りかえ）",
    "#chkRiver": "川を青い太い線で目立たせます。断面図にも川が横切る場所が出ます",
    '[data-mode="pick"]': "断面に使うボーリングの柱を、つなぎたい順に2本以上えらんでから、断面図をつくります",
    '[data-mode="cut"]': "2か所をタップした線で、模型をケーキのように切って、切り口の地層を3Dで見ます（断面図は出しません）",
    "#btnShare": "いまの画面をそのまま子どもに配るリンクをつくります。子どもの予想を集めるGoogleフォームの送り先もここで決めます",
    "#secSend": "名前・予想・分かったこと・予想の線つきの断面図を、先生のGoogleフォームに送ります",
    "#qRiver": "川を青い太い線で目立たせる／もどす。断面図にも川の場所が出ます",
    "#chkYato": "横浜市の谷戸（丘の間の細長い谷）を緑色の線で表示します。名前をクリックすると、江戸時代の村の名前などが出ます",
    "#qYato": "谷戸（やと）の線と名前を表示／かくす。断面図にも谷戸を横切る場所が出ます",
    "#radiusSelect": "模型にする範囲を変えます（中心からの半径）。広くすると、まわりの丘や川のつながりが見えます",
    "#secLegend": "断面図の色が、どの地層かを表しています",
    "#chkAutoMarks": "駅・学校・公園・公共施設などの目印を地図の上に出します",
    "#btnXml": "国土地盤情報データベースなどでダウンロードした柱状図のXMLファイル（ボーリング交換用データ）を読み込みます。何本でもまとめて選べます",
    "#colorBySelect": "ボーリングの柱の色を「つぶの大きさ（れき・砂・どろ・火山灰）」に切りかえると、場所がちがっても同じ特ちょうの層を見つけやすくなります",
    "#btnDig": "模型の好きな場所をタップすると、その場所の地下の「推定」の柱状図が出ます。自分の家や公園の下を調べてみよう",
    "#btnLab": "教科書の「水そうに土砂を流しこむ実験」を画面でためせます。れき・砂・どろが、どこに・どんな順に積もるか見てみよう",
    "#btnSheet": "今の断面図（柱だけ）を大きくのせた、予想をかくワークシートを印刷します。先に断面図をつくってから押します",
    "#btnSTL": "3Dプリンターで模型を印刷するためのデータ（STL）を保存します。一辺15cm、高さの強調は今の設定と同じです",
    "#chkBasin": "雨がふったとき、水がどこへ流れて、どの川に集まるか（流域）と、その境目（分水界）を色分けします。学校にふった雨の通り道も矢印で出ます",
    "#hazardSelect": "大雨で水につかる想定の場所や、がけ崩れなどの危険がある区域を重ねます（国土地理院 重ねるハザードマップ）",
    "#secStage": "この断面の大地が、どんな順番でできたと考えられるかを、時間の流れにそって見ます（ボーリング資料からの推定）",
    "#secMemoBtn": "予想とその理由、答え合わせで分かったことを書くメモを開きます。保存すると断面図といっしょに画像になります",
    "#veRange": "高さだけを何倍にして見せるか。×1が本当の高さ。この辺りは2kmの広さに対して高さの差が50mほどなので、強調しないとほぼ平らに見えます",
    "#opacityRange": "地面をすきとおらせて、地下にうまっているボーリングの柱を見ます",
    "#peelChecks": "チェックを外した層だけをはがします。谷の両側に同じ地層が続いているか、たしかめてみよう",
    "#chkBores": "ボーリング（地面に細い穴をほって、地下の土を調べた場所）の柱を見せる／かくす",
    "#chkLift": "地下にうまっているボーリングの柱を、地上に引き出してならべます。柱どうしをくらべやすくなります",
    "#chkLabels": "ボーリングや学校・駅などの名前を見せる／かくす",
    "#chkNotes": "みんなが置いた気づきメモを見せる／かくす",
    "#chkRing": "中心（学校）から半径の円（赤い点線）を見せる／かくす",
    "#chkHide": "地下の地層の色をかくして灰色にします。まず予想をかくときに使います",
    '[data-view="top"]': "真上から見下ろします（ふつうの地図と同じ見え方）",
    '[data-view="tilt"]': "ななめ上から見ます",
    '[data-view="side"]': "横から見ます。地面の高い所・低い所や、側面の地層がよく見えます",
    "#btnShot": "いま見えている画面を画像として保存します",
    "#btnNotesList": "置いたメモの一覧を見ます。メモの書き出し・読み込みもここから",
    "#chkTeacher": "先生用の機能（ボーリング資料の入力、データの書き出し、仮データの切りかえ）を出します",
    "#chkSample": "考え方を示すための仮（架空）のボーリングを見せる／かくす。本物の資料が入ったら外してください",
    "#btnExport": "入力したボーリング資料とメモを、文字やファイルとして書き出します",
    "#btnImport": "書き出したデータを読み込みます（ほかの端末のメモを集めるときなど）",
    "#siteSelect": "ほかの場所の模型に切りかえます",
    '[data-mode="view"]': "ふつうのモード。ドラッグで回す、ホイール（2本指）で近づく。旗をタップするとボーリング資料が見られます",
    '[data-mode="section"]': "模型をナイフで切るように、2か所をタップした線で切って、切り口（断面）を見ます",
    '[data-mode="note"]': "気づいたことを、模型の上に付せんのように置きます",
    '[data-mode="edit"]': "（先生用）地図をタップして、本物のボーリング資料を入力します",
    "#compass": "赤い三角が北の方向。タップすると北が上になるようにもどします",
    "#sampleBadge": "いま出ているボーリングは仮のデータです（タップで説明）",
    "#secUndo": "最後にかいた線を1本消します",
    "#secClear": "かいた線を全部消します",
    "#secShowModel": "模型が推定した地層を重ねて表示します。予想をかいたあとの答え合わせに",
    "#secOnlyChosenBox": "チェックすると、選んだ柱状図のほかに、断面の線の近くにある柱状図も参考として出します",
    "#secConnect": "本物の柱状図だけを使って、となりの柱と同じ色（同じ層）を帯でつなぎます。片方にしかない層は、あいだで細くなって消えるようにかきます",
    "#secFlip": "断面を反対側から見ます（左右が入れかわります）",
    "#secVeBox": "たての長さを横の何倍にのばして見るか。×1は、たて・横が同じ縮尺の「本当の形」です",
    "#secZoomBox": "たての強調はそのままで、断面の一部を横に大きくします。「🔍5mが見える」は5mの目盛りがはっきり読める大きさまで拡大。右のつまみで見る場所を動かします",
    "#secSave": "断面図（かいた予想もふくむ）を画像で保存します",
    "#penBox": "ペンの色をえらんで、断面図の上に地層のつながりの予想をかきます（層の色のペンもあります）",
    "#btnHelp": "使い方の説明を開きます",
    "#btnSources": "この模型が何をもとに作られているか（根拠・出典）を見ます",
    "#bElev": "孔口標高：ボーリングをほった地面の標高。資料に書いてあればその数字を。空欄なら地図の標高を使います",
    "#bLogs": "上の層から順に、その層の「下の面」の深さ（地面から何m）を書きます",
  };

  const tip = document.createElement("div");
  tip.id = "tooltip";
  tip.className = "hidden";
  document.body.appendChild(tip);
  let timer = null, current = null;

  function applyTips() {
    for (const sel in TIPS) document.querySelectorAll(sel).forEach((el) => {
      // チェックボックスは、ラベル全体にヒントをつける
      const target = el.type === "checkbox" && el.closest("label") ? el.closest("label") : el;
      target.dataset.tip = TIPS[sel];
      target.removeAttribute("title");
    });
  }
  function show(el) {
    tip.textContent = el.dataset.tip;
    tip.classList.remove("hidden");
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 6) y = r.bottom + 8;
    x = Math.max(6, Math.min(window.innerWidth - tw - 6, x));
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hide() { clearTimeout(timer); tip.classList.add("hidden"); current = null; }
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (el === current) return;
    hide();
    if (!el) return;
    current = el;
    timer = setTimeout(() => show(el), 350);
  });
  document.addEventListener("pointerdown", hide);
  document.addEventListener("scroll", hide, true);

  // ---------- 使い方ガイド ----------
  const HELP = [
    {
      tab: "はじめに",
      html: `
<p>この模型は、<b>学校のまわりの土地を、地下の地層まで見えるように立体にしたもの</b>です。
本物の地図と地面の高さのデータ、ボーリング資料（地面に細い穴をほって、地下の土を調べた記録）をもとに作っています。</p>
<h4>動かし方</h4>
<table class="howto">
<tr><th></th><th>マウス</th><th>タッチ（指）</th></tr>
<tr><td>回す</td><td>左ボタンでドラッグ</td><td>1本指でなぞる</td></tr>
<tr><td>近づく・はなれる</td><td>ホイールを回す</td><td>2本指で広げる・ちぢめる</td></tr>
<tr><td>ずらす</td><td>右ボタンでドラッグ</td><td>2本指でなぞる</td></tr>
</table>
<p>こまったら、左のパネルの「見る向き」の<b>「ななめ」</b>をおすと、はじめの見え方にもどります。
<b>ボタンの上にマウスをのせると、そのボタンの説明が出ます。</b></p>`,
    },
    {
      tab: "おすすめの使い方",
      html: `
<p>6年「土地のつくりと変化」で大切にしたい <b>時間的な見方</b>（地層は長い時間をかけて、下から順に積み重なった）と
<b>空間的な見方</b>（地層は面として広く広がり、はなれた場所でもつながっている）を、この模型で体験するための使い方の例です。</p>
<table class="howto">
<tr><th>ねらい（見方）</th><th>こう使う</th><th>子どもの気づきの例</th></tr>
<tr><td>📐 空間：地層は<b>面</b>として広がっている</td>
<td>✂️断面図を作成 →「たての強調」を<b>×1 本当の形</b> →「🔍5mが見える」で拡大。つぎに 🔪模型を切る で、切り口を回りこんで見る</td>
<td>「地層はうすい板みたいに、横にずっと続いている」</td></tr>
<tr><td>📐 空間：はなれた場所でも<b>同じ層がつながる</b></td>
<td>📍柱状図を選択して断面図を作成 で2〜3本えらぶ →「真ん中をかくす」→ ペンで予想 →「柱と柱をつなぐ」→「模型の地層を見る」で確かめる</td>
<td>「両はしの柱に同じ砂の層があるから、間もつながっているはず」</td></tr>
<tr><td>📐 空間：<b>丘と谷</b>で地層がちがう</td>
<td>地層をはがす（<b>1つずつ</b>）でローム層だけ、沖積層だけを外す。〰谷戸 もいっしょに表示</td>
<td>「火山灰は丘の上、川が運んだ土は谷の底にある」「〇〇谷戸という地名は谷だった所」</td></tr>
<tr><td>📐 空間：その層が<b>どこに広がっているか</b>（土地のなり立ち）</td>
<td>地層をはがす の各層の「<b>👁 だけ</b>」をおす（その層と土台だけが残る）。沖積層・ローム層・砂…と順に切りかえてくらべる。🌊川を強調・〰谷戸 もいっしょに</td>
<td>「沖積層は川のまわり（谷の底）にだけある」「ローム層は丘の上をおおっている」「だから川が運んだ土は低い所に、火山灰は高い所に残った」</td></tr>
<tr><td>⏳ 時間：<b>下ほど古く、上ほど新しい</b></td>
<td>断面図の 🎬大地のでき方 → 下の<b>時間のつまみ</b>を左から右へ動かす</td>
<td>「下の層から順番に積もって、最後に川がけずって谷ができた」</td></tr>
<tr><td>⏳ 時間：とても<b>長い時間</b>がかかっている</td>
<td>🎬大地のでき方 の「<b>本当の時間の長さ</b>」の帯を見せる</td>
<td>「泥岩ができた時間にくらべて、人が土を盛ったのはほんの一瞬」</td></tr>
<tr><td>⏳ 時間：時代を<b>さかのぼる</b></td>
<td>地層をはがす（<b>新しい順にまとめて</b>）で、上の層から順にはがしていく</td>
<td>「ローム層がつもる前は、こんな地面だったんだ」</td></tr>
<tr><td>⏳📐 時間と空間をむすぶ</td>
<td>谷を横切る断面で、大地のでき方 ③（火山灰が積もる・川がけずる のくり返し）→④（谷に土砂がたまった）を見くらべる。谷戸の名前をクリック</td>
<td>「積もる・けずるを<b>何度もくり返して</b>、今の形になった」「谷ができた<b>あと</b>に、その谷の<b>中だけ</b>に土砂がたまった」</td></tr>
</table>
<h4>授業の流れの例</h4>
<ol>
<li><b>つかむ</b>：学校のまわりを3Dで見る。「学校の下はどうなっているかな？」</li>
<li><b>予想する</b>：先生が「？」にした柱と答え合わせのロックを入れた <b>子ども用リンク</b> を配る → ペンで予想</li>
<li><b>確かめる</b>：答え合わせ・柱と柱をつなぐ・模型を切る で確かめ、「📮先生に送る」で提出</li>
<li><b>ふかめる</b>：大地のでき方のつまみで時間の流れを追い、「本当の時間の長さ」を見る</li>
<li><b>生かす</b>：「なぜ地面の下を調べたの？」・防災の情報を重ねて、くらしとのつながりを考える</li>
</ol>
<p class="hint">※ 地下の地層や年代は、ボーリング資料などからの<b>推定・目安</b>です。本当に分かっているのは柱（ボーリング）の所だけ、ということも子どもと確かめましょう。</p>`,
    },
    {
      tab: "地層を見る",
      html: `
<ol>
<li><b>🔍の旗（ボーリング）をタップ</b>：その場所の地下にどんな層があったかの図（柱状図）が出ます。</li>
<li><b>「柱を地上に引き出す」</b>：ボーリングの柱を地上にならべて、場所ごとにくらべられます。</li>
<li><b>「地面をすきとおらせる」</b>：地面がすけて、地下の柱が見えます。</li>
<li><b>「ボーリングの柱の色分け」</b>を<b>「つぶの大きさで」</b>にすると、れき（2mm以上）・砂・どろ（0.06mm以下）・火山灰の色になります。
名前がちがっても、つぶの大きさが同じ層を見つけてみよう。</li>
<li>凡例の<b>💧</b>は水のはたらき、<b>🌋</b>は火山のはたらき、<b>👷</b>は人がつくった層です。</li>
<li>柱状図の画面の<b>「📝 記録カードをつくる」</b>で、教科書のような記録カードの画像ができます。</li>
<li>柱状図の画面の<b>「⭐ お気に入り」</b>（柱状図の画面の、名前のすぐ下）で色（赤・黄・緑・むらさき）を選ぶと、その柱の旗が★つきの色の旗になり、断面図でも色のわくで目立ちます。「なし」でもとにもどります。</li>
<li><b>「地層をはがす」</b>：上の層から1枚ずつはがします。<br>
谷（川）をはさんだ両側の丘に、<b>同じ地層が同じくらいの高さで続いているか</b>見てみよう。</li>
<li><b>「高さを強調」</b>：デコボコを見やすくするため、高さだけを大きくしています。×1が本当の高さです。</li>
<li><b>「凹凸の見せ方」</b>：高さを強調しすぎなくても、デコボコがわかる見せ方です。
<ul><li>高さで色分け：低い所は青、高い所は赤っぽい色（右下に色と高さの表）</li>
<li>等高線：同じ高さの所を線でつなぐ。線がこみ合っている所ほど急な坂</li>
<li>段々模型：段ボールで作る等高線模型のように、決まった高さごとの段にする</li>
<li>影を強くする：ななめからの光で、坂に影ができる</li></ul></li>
<li>マウスをのせると、その場所の<b>地面の標高</b>が出ます。</li>
<li><b>🌊 川を強調</b>（下のボタン）：川を青い太い線で目立たせます。断面図にも川の場所が出ます。</li>
<li><b>⬆️ 柱を地上に</b>（下のボタン）：ボーリングの柱を地上に引き出して、ならべてくらべられます。</li>
<li><b>範囲（半径）</b>：0.5km〜2kmに変えられます。</li>
<li>地図の種類の<b>「土地のなり立ち」</b>（地形分類・治水地形分類図など）や<b>「昔の写真」</b>で、土地がどうできたか・どう変わったかも見られます。</li>
</ol>`,
    },
    {
      tab: "断面と予想",
      html: `
<ol>
<li><b>「📍 柱状図を選択して断面図を作成」</b>：ボーリングの旗を、つなぎたい順にタップ（2本以上。もう一度タップで取り消し）→<b>「✅ この柱で断面図をつくる」</b>で、えらんだ柱を通る断面図ができます。</li>
<li><b>「🔪 模型を切る」</b>：2か所をタップすると、その線で模型をケーキのように切って、切り口の地層を3Dで見られます（断面図は出ません）。「🔄 反対側を残す」「📊 断面図も開く」も使えます。</li>
<li>下の<b>「✂️ 断面図を作成」</b>をおして、地図の上で<b>2か所（A→B）</b>をタップします。<br>
旗をタップすると、そのボーリングを通る線になります。<br>
<b>続けてタップすると線をのばせます</b>（A→B→C…）。ボーリングの旗を3本以上つなぐと、柱が3本以上ならんだ断面図になります。</li>
<li>断面図の上の<b>「わかっているボーリングを表示」</b>で、柱を見せる／かくすを切りかえられます。
柱の名前のチェックを外すと、その柱は<b>「？」</b>になります。<b>「真ん中をかくす」</b>をおすと、両はしの柱だけが見えます。</li>
<li>模型がその線で切れて、切り口が見えます。画面の下には<b>断面図</b>が出ます。</li>
<li><b>予想をかく</b>：ペンの色をえらんで、ボーリングの柱と柱の間で、地層がどうつながっているか線をかきます。<br>
（はじめは左のパネルの<b>「地下の地層をかくす」</b>にチェックしておくと、答えが見えません）</li>
<li><b>答え合わせ</b>：「模型の地層を見る」にチェックすると、推定した地層が重なって出ます。</li>
<li><b>「📝 考えメモ」</b>に、予想とその理由（どの柱のどの層を手がかりにしたか）、答え合わせで分かったことを書きます。</li>
<li><b>「たての強調」と「横に拡大」</b>：「×1 本当の形」にすると、地層がうすい板のように横に広がっている本当のようすがわかります。そのままでは高さの差が小さくて読みにくいので、「🔍 5mが見える」を押すと、形を変えずに（たて・横を同じだけ）大きくして、5mごとの目盛りで高さの差を読めます。つまみで見る場所を動かせます。</li>
<li><b>「🎬 大地のでき方」</b>：この断面の大地が、①海の底でどろが固まる → ②水のはたらきで積み重なる → ③火山灰が積もる・川がけずる をくり返して谷ができる→ ④谷に土砂がたまる → ⑤人が土を盛る、の順にできたようすを、時間のつまみや◀▶で見られます。水の流れや火山のふん火も動きで表します。</li>
<li>「📷 保存」で、かいた断面図と考えメモを画像にして、ノートやロイロノートに貼れます。</li>
</ol>`,
    },
    {
      tab: "気づきメモ",
      html: `
<ol>
<li>下の<b>「📝 気づきメモ」</b>をおして、メモを置きたい場所をタップします。</li>
<li>気づいたこと・考えたことを書いて「置く」をおすと、模型の上に付せんがはられます。</li>
<li>左のパネルの<b>「📝 メモ一覧」</b>で、メモの一覧が見られます。<br>
「メモを書き出す」→ 先生の端末で「データを読み込む」と、クラスのメモを1つの模型に集められます。</li>
</ol>
<p class="hint">メモや予想の線は、<b>その端末のブラウザの中</b>に保存されます（ほかの人には送られません）。</p>`,
    },
    {
      tab: "新しい場所",
      html: `
<p>ほかの学校のまわりの模型も、この画面だけで作れます（Claudeは使わなくてよい）。</p>
<h4>① 場所をつくる</h4>
<ol>
<li>左のパネルいちばん下の<b>「先生モード」</b>にチェック →<b>「＋ 新しい場所の模型をつくる」</b></li>
<li>学校名を入れて<b>「🔍 場所をさがす」</b>（見つからないときは、<a href="https://maps.gsi.go.jp/" target="_blank" rel="noopener">地理院地図</a>で学校を右クリックして出てくる緯度・経度を貼り付け）</li>
<li>範囲（半径）をえらんで<b>「この場所でつくる」</b> → 地形・地図・川・目印が自動で入ります</li>
</ol>
<h4>② ボーリング資料をまとめて入れる</h4>
<ol>
<li>下の青いボタンを、ブラウザの<b>お気に入りバー（ブックマークバー）にドラッグ</b>して登録します（1回だけ）<br>
<span id="bmLinkHolder"></span></li>
<li><a href="https://publicweb.ngic.or.jp/public/publicweb.php" target="_blank" rel="noopener">国土地盤情報データベース</a>を開いて<b>「閲覧」</b>を押し、地図を学校のあたりに動かす</li>
<li>お気に入りバーの<b>「📥 柱状図あつめ」</b>を押す → 中心と半径を聞かれるのでOK → 柱状図が1本ずつ集まります（200本で10分ほど。画面は開いたままに）</li>
<li>できた<b>「柱状図まとめ_○本.json」</b>を、この模型の先生モード →<b>「📄 柱状図XMLを読み込む」</b>で読み込む</li>
<li>層の当てはめの一覧を確認して、ちがう所は「当てはめを直す」</li>
</ol>
<p class="hint">作った場所・読み込んだ資料は、この端末のブラウザに保存されます。ほかの端末で使うときは「データを書き出す」→「データを読み込む」。</p>`,
    },
    {
      tab: "先生向け",
      html: `
<ul>
<li>左のパネルいちばん下の<b>「先生モード」</b>にチェックすると、先生用の機能が出ます。</li>
<li><b>➕ ボーリング追加</b>：地図をタップして、本物のボーリング資料（横浜市「地盤View」など）を入力します。
上の層から順に「下の面の深さ」「層」「土の名前」「N値（地面のかたさ）」を入れます。</li>
<li><b>仮データを表示</b>：いまは考え方を示すための<b>架空のボーリング（オレンジの旗）</b>が出ています。本物の資料が入ったら外してください。</li>
<li><b>📄 柱状図XMLを読み込む</b>：<a href="https://publicweb.ngic.or.jp/public/publicweb.php" target="_blank" rel="noopener">国土地盤情報データベース</a>などでダウンロードした柱状図のXML（ボーリング交換用データ）を読み込むと、場所・標高・地層が自動で入ります。層の当てはめは自動なので、一覧で確認してください。</li>
<li><b>データを書き出す</b>：入力した資料をファイルにして、ほかの端末で読み込めます。設定ファイル（sites/〇〇.js）に貼り付けると、全員の画面に最初から出るようになります。</li>
<li><b>授業の場面と使う機能の例</b>
<table class="howto">
<tr><th>場面</th><th>使う機能</th></tr>
<tr><td>学校の下の土地を調べる</td><td>柱状図・記録カード・つぶの大きさで色分け</td></tr>
<tr><td>地層の広がりを予想する</td><td>断面図を作成・真ん中をかくす・ペン・考えメモ①</td></tr>
<tr><td>予想を確かめて考察する</td><td>答え合わせ・地層をはがす・考えメモ②</td></tr>
<tr><td>地層のでき方をまとめる</td><td>🎬大地のでき方・💧🌋のしるし</td></tr>
<tr><td>学んだことを生活に生かす</td><td>「なぜ調べたの？」・防災の情報を重ねる</td></tr>
</table></li>
<li>くわしい手順・別の場所版の作り方は <a href="README.md" target="_blank" rel="noopener">README（説明書）</a> を見てください。</li>
</ul>`,
    },
  ];

  function openHelp(tabIndex) {
    const d = $("helpDialog");
    const tabs = d.querySelector(".tabs"), body = d.querySelector(".tab-body");
    tabs.innerHTML = "";
    HELP.forEach((h, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = h.tab;
      b.onclick = () => select(i);
      tabs.appendChild(b);
    });
    function select(i) {
      tabs.querySelectorAll("button").forEach((b, k) => b.classList.toggle("active", k === i));
      body.innerHTML = HELP[i].html;
      const holder = body.querySelector("#bmLinkHolder");
      if (holder && C.NGIC_BOOKMARKLET) {
        const a = document.createElement("a");
        a.href = C.NGIC_BOOKMARKLET;
        a.className = "bm-link";
        a.textContent = "📥 柱状図あつめ";
        a.onclick = (e) => { e.preventDefault(); alert("このボタンは、ここで押すのではなく、お気に入りバーにドラッグして登録してください。\n国土地盤情報データベースの地図を開いてから、お気に入りバーのボタンを押します。"); };
        holder.appendChild(a);
        const cp = document.createElement("button");
        cp.type = "button";
        cp.textContent = "中身をコピー（ドラッグできないとき）";
        cp.onclick = async () => {
          try { await navigator.clipboard.writeText(C.NGIC_BOOKMARKLET); cp.textContent = "コピーしました。お気に入りを新しく作り、URLの欄に貼り付けてください"; }
          catch (e) { prompt("これをコピーして、お気に入りのURLに貼り付けてください", C.NGIC_BOOKMARKLET); }
        };
        holder.appendChild(cp);
      }
    }
    select(tabIndex || 0);
    if (!d.open) d.showModal();
  }

  // ---------- 根拠・出典 ----------
  function openSources() {
    const app = window.__chisou;
    const S = app && app.S;
    const site = S && S.site;
    let html = "";
    if (site) {
      const c = site.center;
      html += `<p>この模型は、次の資料をもとに作っています。青い文字をおすと、元の資料のページが開きます。</p>`;
      html += `<h4>① 地面の形（高さ）</h4>
<ul><li><a href="https://maps.gsi.go.jp/development/ichiran.html#dem" target="_blank" rel="noopener">国土地理院「標高タイル」</a>
（5mメッシュ：航空レーザ測量など。無い所は10mメッシュ）<br><span class="hint">地面を5mごとに区切って、それぞれの標高を測ったデータです。</span></li>
<li><a href="https://maps.gsi.go.jp/#15/${c.lat.toFixed(6)}/${c.lon.toFixed(6)}/&base=std&ls=std%7Crelief&disp=11" target="_blank" rel="noopener">この場所を「地理院地図」で開く（色別標高図）</a>
<br><span class="hint">本物の地理院地図とくらべてみよう。</span></li></ul>`;
      html += `<h4>② 表面の地図・写真</h4><ul>
<li><a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院「地理院タイル」</a>（標準地図・淡色地図・写真・色別標高図・陰影起伏図）</li>
<li>「高さで色分け（この場所用）」は、①の標高データからこの模型の中で色をつけたものです。</li>
<li>土地のなり立ち：<a href="https://www.gsi.go.jp/bousaichiri/landformclassification.html" target="_blank" rel="noopener">地形分類（自然地形）</a>・
<a href="https://www.gsi.go.jp/bousaichiri/fc_index.html" target="_blank" rel="noopener">治水地形分類図</a>・
<a href="https://www.gsi.go.jp/bousaichiri/lc_index.html" target="_blank" rel="noopener">土地条件図</a>（国土地理院）</li>
<li>昔の航空写真：国土地理院（1945〜1950年ごろ・1961〜1969年ごろ・1974〜1978年ごろ）</li>
<li>まわりの目印（駅・学校・公園・公共施設）：${site.mapMarks ? '国土地理院の地図情報（地図の注記）から取り出したもの' : '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'}</li>
<li>川の線：<a href="https://github.com/gsi-cyberjapan/experimental_rvrcl" target="_blank" rel="noopener">国土地理院「河川中心線」</a>（読めないときは、①の地形から水が流れる道を計算して表示）</li>
<li>谷戸（やと）の線と名前：<a href="https://yato.midoriit.com/" target="_blank" rel="noopener">谷戸のヨコハマ</a>（小池 隆／合同会社ミドリアイティ、<a href="http://linkdata.org/work/rdf1s8246i" target="_blank" rel="noopener">LinkData</a>、パブリックドメイン）</li>
<li>地質図：<a href="https://gbank.gsj.jp/seamless/" target="_blank" rel="noopener">産総研 地質調査総合センター「20万分の1日本シームレス地質図V2」</a>（CC BY 4.0）</li>
<li>流域・分水界：国土地理院の標高データから、このアプリで計算したおおよその流れ</li></ul>`;
      html += `<h4>③ 地下の地層（ボーリング資料）</h4>`;
      const real = S.bores.filter((b) => !b.sample), fake = S.bores.filter((b) => b.sample);
      if (real.length) {
        html += "<ul>" + real.map((b) => `<li><b>${esc(b.name)}</b>：${esc(b.source || "出典未記入")}` +
          (b.url ? ` <a href="${esc(b.url)}" target="_blank" rel="noopener">資料を開く ↗</a>` : "") + "</li>").join("") + "</ul>";
      } else {
        html += `<p class="warnbox">本物のボーリング資料はまだ入っていません。</p>`;
      }
      if (fake.length) {
        html += `<p class="warnbox">⚠ オレンジの旗の${fake.length}本は<b>仮（架空）のデータ</b>です。
①の地面の高さを使い、「水平に積み重なった地層を川がけずり、谷に土砂がたまった」という考え方で計算したもので、本物の地層ではありません。</p>`;
      }
      for (const s of site.sources || []) {
        html += `<p>・${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}${s.note ? `<br><span class="hint">${esc(s.note)}</span>` : ""}</p>`;
      }
      html += `<h4>④ 地層の広がりの推定のしかた</h4>
<p>ボーリングの場所で分かった「層と層の境目の高さ」を、ボーリングの間の場所にも広げています。
（ゆるやかにかたむいた平らな面を基本に、近くのボーリングほど強く合わせる計算）<br>
地面より上になってしまう所は「川にけずられた」として切り取り、谷の底には川が運んだ土砂の層（沖積層）がたまるようにしています。<br>
<b>ボーリングとボーリングの間は、計算で推定した「予想」です。</b>ボーリングが少ない所ほど、本当とちがうかもしれません。</p>`;
      html += `<h4>⑤ その他</h4><ul>
<li>中心の位置：${esc(site.centerNote || "設定ファイルの緯度・経度")}（北緯${c.lat}・東経${c.lon}）</li>
<li>3D表示：<a href="https://threejs.org/" target="_blank" rel="noopener">three.js</a>（MITライセンス）</li>
<li>作り方・説明書：<a href="README.md" target="_blank" rel="noopener">README</a></li></ul>`;
    }
    $("sourcesBody").innerHTML = html;
    $("sourcesDialog").showModal();
  }

  function init() {
    applyTips();
    $("btnHelp").onclick = () => openHelp(0);
    $("btnSources").onclick = openSources;
    let seen = false;
    try { seen = localStorage.getItem("chisou3d:helpSeen") === "1"; } catch (e) { /* 使えない環境 */ }
    if (!seen) {
      openHelp(0);
      try { localStorage.setItem("chisou3d:helpSeen", "1"); } catch (e) { /* 使えない環境 */ }
    }
  }

  C.Help = { init, applyTips, openHelp, openSources };
})();
