// ============================================================
// 外部依存
// ============================================================
// 本スクリプトは以下の外部ライブラリに依存します：
// - d3-celestial (https://github.com/ofrohn/d3-celestial)
// - d3.js (https://d3js.org/)
//
// 必要に応じて index.html でCDN等から読み込んでください。

// ============================================================
// 定数定義
// ============================================================
const AREA_DEFAULT = "area0";
const MSG_NO_AINU = "この地域に対応するアイヌ民族の星文化はありません。";
const CITY_SELECT_PLACEHOLDER = "現在地を選択してください";
const AINU_LABEL_COLOR_STAR = "#66ee66"; // 天体色
const AINU_LABEL_COLOR_CONST = "#ee66ee"; // 星座色
const AINU_LABEL_COLOR_HIGHLIGHT = "#ffeb3b"; // 選択中の強調色（黄）
const AINU_LABEL_FONT = "bold 14px sans-serif";
const AINU_LABEL_TEXT_ALIGN = "center";
const DEFAULT_CITY_LOCATION = "札幌市"; // 緯度経度が欠損している場合のフォールバック先
const PROJECTION_PLANISPHERE = "planisphere";
const PLANISPHERE_BASE_PROJECTION = "stereographic";

// areaキー→区分名の変換テーブル
const AREA_LABEL_MAP = {
  area0: "全域",
  area1: "区分Ⅰ",
  area2: "区分Ⅱ",
  area3: "区分Ⅲ",
  area4: "区分Ⅳ",
  area5: "区分Ⅴ",
};

// エリアプレビューのデフォルト重ね合わせ（市町村未選択時用）を保持
let DEFAULT_STACK_HTML = null;

// ============================================================
// アプリ状態管理オブジェクト
// ============================================================
const AppState = {
  AINU_DATA: null,
  CURRENT_AREA_KEYS: [],
  CURRENT_CITY: null,
  CURRENT_GEO_POS: null,
  AINU_GEOJSON: null,
  SELECTED_AINU_FEATURE_ID: null,
  VISIBLE_AINU_FEATURE_IDS: new Set(),
  DEFAULT_VIEW_ROTATE: [0, 0, 0],
  VIEW_RESET_TOKEN: 0,
};

// ============================================================
// スタイル設定（アイヌ民族星文化ライン用）
// ============================================================
// Celestial.js で描画するアイヌ民族星文化の線・塗りのスタイルを定義します。
const AINU_LINE_STYLE = {
  stroke: "#ee66ee", // 星座の線色
  fill: "rgba(240, 102, 240, 0.18)", // 線で囲んだ領域の塗り色（半透明）
  width: 2, // 線幅
};

const AINU_HIGHLIGHT_LINE_STYLE = {
  stroke: "#ffeb3b",
  fill: "rgba(255, 235, 59, 0.18)",
  width: 3,
};

// ============================================================
// Celestial.js 設定
// ============================================================
// d3-celestial の描画設定。投影法・座標系・星座表示・UIなどの初期値をまとめて管理。
const CELESTIAL_CONFIG = {
  width: 0, // 0 ならコンテナ幅に合わせる
  projection: "aitoff", // 全天用投影法
  transform: "equatorial", // 座標系（赤道座標）
  center: null, // 中心座標（null で自動）
  orientationfixed: true, // 地平座標への回転を固定
  geopos: null, // 地上位置（null で自動）
  follow: "center", // 初期表示は天の赤道が中央で水平になるよう中心固定
  zoomlevel: null, // 初期ズーム（null で自動）
  zoomextend: 10, // ズーム範囲の上限
  adaptable: true, // コンテナサイズに自動追従
  interactive: true, // ドラッグ・ズームなどの操作を有効化
  form: false, // 画面内にフォーム UI を表示しない
  controls: true, // 右上のコントロール UI を表示
  lang: "ja", // UI 表示言語
  culture: "iau", // 既定の星座
  container: "celestial-map", // 描画先コンテナ ID

  datapath: "https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/", // 付属データの取得元

  stars: {
    show: true, // 星を表示
    limit: 6, // 視等級の上限（6 等級まで）
    colors: true, // 色を有効化
    style: { fill: "#ffffff", opacity: 1 }, // 星の塗りと透明度
    designation: false, // Bayer 記号などの表示
    propername: false, // 固有名の表示
    size: 7, // 星の最大小サイズ
    exponent: -0.28, // 明るさ→サイズへの変換係数
    data: "stars.6.json", // 使用する星データファイル
  },

  dsos: { show: false }, // 星雲・銀河など Deep Sky Objects の表示

  constellations: {
    show: true, // 星座情報を表示
    names: true, // 星座名を表示
    desig: false, // 星座略号を非表示
    lines: true, // 星座線を表示
    linestyle: { stroke: "#555555", width: 1, opacity: 0.7 }, // 星座線のスタイル
    bounds: false, // 星座境界線の表示
  },

  mw: {
    show: true, // 天の川の表示
    style: { fill: "#ffffff", opacity: 0.04 }, // 天の川の塗りスタイル
  },
};

// ============================================================
// ステータスメッセージ（エラー/注意）の表示
// ============================================================
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatusMessage(message, { isError = true, persistent = true, actionLabel = null, onAction = null } = {}) {
  const el = document.getElementById("status-message");
  if (!el) return;

  if (!message) {
    el.hidden = true;
    el.textContent = "";
    delete el.dataset.actionBound;
    return;
  }

  const safe = escapeHtml(message);
  let actionHtml = "";
  if (actionLabel) {
    actionHtml = ` <button type="button" class="status-action" id="status-action-btn">${escapeHtml(actionLabel)}</button>`;
  }

  el.hidden = false;
  el.dataset.kind = isError ? "error" : "info";
  el.dataset.persistent = persistent ? "1" : "0";
  el.innerHTML = `${safe}${actionHtml}`;

  if (actionLabel && typeof onAction === "function") {
    const btn = el.querySelector("#status-action-btn");
    if (btn && el.dataset.actionBound !== "1") {
      el.dataset.actionBound = "1";
      btn.addEventListener("click", () => onAction());
    }
  }
}

function clearStatusMessage() {
  setStatusMessage("");
}

function formatInitError(err) {
  const msg = err?.message ? String(err.message) : String(err || "");
  // ローカル直開き(file://)は fetch が失敗しやすいので補足
  if (window.location.protocol === "file:") {
    return `データの読み込みに失敗しました。ローカルファイル直開きだと動作しない場合があります（簡易サーバで開いてください）。\n詳細: ${msg}`;
  }
  return `データの読み込みに失敗しました。\n詳細: ${msg}`;
}

// ============================================================
// アプリ初期化処理
// ============================================================
// ページロード時に必要なデータを取得し、UI・天球図を初期化します。
// データ取得失敗時はエラーメッセージを表示します。
document.addEventListener("DOMContentLoaded", initApp);

window.addEventListener("DOMContentLoaded", () => {
  setupAinuListInteraction();

  // 投影法プルダウンのイベント登録
  const projSelect = document.getElementById("projection-select");
  if (projSelect) {
    projSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val) {
        applyProjection(val);
      }
    });
  }

  // 恒星の等級（視等級）表示上限スライダー
  const magSlider = document.getElementById("star-mag-limit");
  const magOut = document.getElementById("star-mag-limit-value");
  if (magSlider) {
    const initial = Number(CELESTIAL_CONFIG?.stars?.limit);
    if (Number.isFinite(initial)) {
      magSlider.value = String(initial);
      if (magOut) magOut.textContent = formatMagLimit(initial);
    }

    let debounceTimer = null;
    const applyFromSlider = () => {
      const next = Number(magSlider.value);
      if (!Number.isFinite(next)) return;
      if (magOut) magOut.textContent = formatMagLimit(next);
      applyStarMagnitudeLimit(next);
    };

    magSlider.addEventListener("input", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFromSlider, 60);
    });

    magSlider.addEventListener("change", applyFromSlider);
  }

  // 星図ビュー（ズーム/スクロール）を初期状態へ戻す
  const resetBtn = document.getElementById("reset-view");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => resetCelestialView());
  }

  // 88星座ON/OFFチェックボックスのイベント登録
  const constChk = document.getElementById("toggle-constellations");
  if (constChk) {
    constChk.addEventListener("change", (e) => {
      const show = e.target.checked;
      Celestial.apply({
        constellations: { show: show, names: show, lines: show },
      });
    });
  }
});

async function initApp() {
  clearStatusMessage();
  setLoadingMessage("データ読み込み中……");

  const tryInit = async () => {
    // 必要なデータをAPIからまとめて取得し、以降の UI 更新に使う。
    AppState.AINU_DATA = await loadAllAinuData();

    // 市町村リストをプルダウンに並べる。
    setupCitySelect(AppState.AINU_DATA.cityMap);
    // 天球図を初期化し、独自レイヤーを登録。
    setupCelestial();
    // 初回描画前に現在時刻へ合わせる
    setCelestialTimeToJST();

    initDefaultViewFromBrowserLocation();

    // 初期状態は市町村未選択のまま、全体マップ(area0)を表示
    updateAreaMapPreview([AREA_DEFAULT]);
    updateRegionInfo();

    clearStatusMessage();
  };

  try {
    await tryInit();
  } catch (err) {
    console.error(err);
    setStatusMessage(formatInitError(err), {
      isError: true,
      persistent: true,
      actionLabel: "再試行",
      onAction: async () => {
        clearStatusMessage();
        await initApp();
      },
    });
  } finally {
    setLoadingMessage("");
  }
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatMagLimit(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "";
  return `${v.toFixed(1)}等級`;
}

function applyStarMagnitudeLimit(limit) {
  const next = clampNumber(limit, -1, 6);
  if (CELESTIAL_CONFIG?.stars) {
    CELESTIAL_CONFIG.stars.limit = next;
  }

  if (typeof Celestial?.apply === "function") {
    Celestial.apply({ stars: { limit: next } });
  }

  if (typeof Celestial?.redraw === "function") {
    Celestial.redraw();
  }
}

function resetCelestialView() {
  // d3-celestial のズームは「スケール」だけでなく内部の transform（平行移動）も持つため、
  // zoomBy() の比率計算だけだと戻り切らずズレることがある。
  // ここでは display() でビュー自体を再初期化してから既定の回転へ戻す。
  const projection = CELESTIAL_CONFIG.projection;
  const follow = CELESTIAL_CONFIG.follow || "center";
  const nextConfig = { ...CELESTIAL_CONFIG, projection, follow };
  const token = (AppState.VIEW_RESET_TOKEN += 1);

  // date() の getter が存在する場合のみ状態を退避（実装差分に備えて安全側）
  const currentDate = typeof Celestial?.date === "function" ? Celestial.date() : null;

  Celestial.display(nextConfig);

  // display() の内部初期化が落ち着いた後に、ビューを確定させる
  setTimeout(() => {
    if (token !== AppState.VIEW_RESET_TOKEN) return;
    // 独自レイヤーを再バインド
    if (AppState.AINU_GEOJSON) {
      bindAinuFeatures();
    }

    // 時刻を可能なら復元
    if (currentDate instanceof Date && typeof Celestial?.date === "function") {
      Celestial.date(currentDate);
    }

    // center追従時のみ、観測地のローカル子午線（真南）を中央に合わせる
    if (follow === "center") {
      const lon = AppState.CURRENT_GEO_POS?.[1];
      if (Number.isFinite(lon)) {
        setDefaultViewToLocalMeridian(lon);
      } else if (typeof Celestial?.rotate === "function") {
        Celestial.rotate({ center: AppState.DEFAULT_VIEW_ROTATE });
      }
    }

    Celestial.redraw();
  }, 0);
}

// ============================================================
// 市町村選択 UI の構築
// ============================================================
// APIから取得した市町村マップをもとにプルダウンリストを生成。
// 選択変更時は onCityChange で描画・情報を更新します。
function setupCitySelect(cityMap) {
  const select = document.getElementById("city-select");
  const cities = Object.keys(cityMap || {});

  if (!select) {
    setStatusMessage("内部エラー: 市町村選択UIが見つかりません。", { isError: true, persistent: true });
    return;
  }

  // 既存の option をクリアしてからプレースホルダーを追加。
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = CITY_SELECT_PLACEHOLDER;
  select.appendChild(placeholder);

  for (const city of cities) {
    const opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city;
    select.appendChild(opt);
  }

  select.addEventListener("change", (e) => {
    const selected = e.target.value;
    if (selected) {
      onCityChange(selected);
    } else {
      resetSelection();
    }
  });

  // アクセシビリティ: ラベルが視覚的に隠れている場合でも読み上げ用に補強
  const describedBy = select.getAttribute("aria-describedby") || "";
  if (!describedBy.includes("city-select-help")) {
    select.setAttribute("aria-describedby", [describedBy, "city-select-help"].filter(Boolean).join(" "));
  }
  if (!select.getAttribute("aria-label")) {
    select.setAttribute("aria-label", "現在地（市町村）");
  }
}

// ============================================================
// 市町村選択時の処理
// ============================================================
// 選択された市町村から予報区・文化地域を特定し、
// 地図プレビュー・星文化描画・情報表示を選択内容に合わせて更新します。
function onCityChange(cityName) {
  const cityMap = AppState.AINU_DATA.cityMap || {};
  const cityInfo = cityMap[cityName];
  if (!cityInfo) return;

  // 市町村名から予報区・文化地域キーを取得し、グローバル状態を更新。
  AppState.CURRENT_CITY = cityName;
  AppState.CURRENT_AREA_KEYS = normalizeAreaKeys(cityInfo);

  // 追加: forecast, region, bureau を AppState にセット
  AppState.CURRENT_FORECAST = cityInfo.forecast;
  AppState.CURRENT_REGION = cityInfo.region;
  AppState.CURRENT_BUREAU = cityInfo.bureau;

  // 選択市町村に緯度経度がない場合は札幌市をフォールバック。
  const { lat, lon } = resolveCityCoordinates(cityName, cityMap);
  applyGeoposition(lat, lon);
  // 市町村選択後は、その地点のローカル子午線を中央に合わせる
  if (Number.isFinite(lon)) {
    setDefaultViewToLocalMeridian(lon);
  }

  // 地図プレビュー画像を選択地域に切り替え。
  updateAreaMapPreview(AppState.CURRENT_AREA_KEYS);

  // 地域情報・星文化リスト・GeoJSONレイヤーを選択内容で更新。
  updateRegionInfo();
  updateAinuGeoJSON();
  updateAinuList();

  // 変更内容を反映するため天球図を再描画。
  Celestial.redraw();
}

// ============================================================
// 天球図の時刻を現在時刻に設定
// ============================================================
// JavaScript の Date は内部的に UTC エポックを保持しているため、
// getTimezoneOffset() などで「UTCへ変換」し直すと二重補正になりズレます。
function setCelestialTimeToJST() {
  Celestial.date(new Date());
}

function getCelestialDateSafe() {
  if (typeof Celestial?.date !== "function") return new Date();
  const d = Celestial.date();
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
}

function normalizeDeg0To360(deg) {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

// 参考: Meeus, Astronomical Algorithms（簡易GMST）
function computeLocalSiderealTimeDeg(date, lonDegEast) {
  const timeMs = date instanceof Date ? date.getTime() : Date.now();
  const jd = timeMs / 86400000 + 2440587.5; // Unix epoch -> JD
  const d = jd - 2451545.0; // days since J2000.0
  const t = d / 36525.0;
  const gmst = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000.0;
  const lst = gmst + lonDegEast;
  return normalizeDeg0To360(lst);
}

function setDefaultViewToLocalMeridian(lonDegEast, latDeg = AppState.CURRENT_GEO_POS?.[0]) {
  const date = getCelestialDateSafe();
  const lstDeg = computeLocalSiderealTimeDeg(date, lonDegEast);
  // center は [-180, 180] 系で扱う（既存の raDecToLonLat と同じ）
  const lon = lstDeg > 180 ? lstDeg - 360 : lstDeg;
  if (CELESTIAL_CONFIG.follow === "zenith") {
    const clampedLat = clampNumber(Number(latDeg), -90, 90);
    AppState.DEFAULT_VIEW_ROTATE = [lon, clampedLat, 0];
    if (typeof Celestial?.rotate === "function") {
      Celestial.rotate({ center: AppState.DEFAULT_VIEW_ROTATE });
    }
    return;
  }
  AppState.DEFAULT_VIEW_ROTATE = [lon, 0, 0];
  if (typeof Celestial?.rotate === "function") {
    Celestial.rotate({ center: AppState.DEFAULT_VIEW_ROTATE });
  }
}

function initDefaultViewFromBrowserLocation() {
  const fallback = resolveCityCoordinates(DEFAULT_CITY_LOCATION, AppState.AINU_DATA?.cityMap);

  // 既に市町村が選択済みなら、初期位置の上書きはしない
  const canApply = () => !AppState.CURRENT_CITY;

  // 位置情報許可待ちでも画面が空/不定にならないよう、まずはフォールバックで初期化しておく
  if (canApply()) {
    applyGeoposition(fallback.lat, fallback.lon);
    if (Number.isFinite(fallback.lon)) setDefaultViewToLocalMeridian(fallback.lon);
    Celestial.redraw();
  }

  if (!("geolocation" in navigator) || typeof navigator.geolocation !== "object") {
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (!canApply()) return;
      const lat = pos?.coords?.latitude;
      const lon = pos?.coords?.longitude;
      applyGeoposition(lat, lon);
      if (Number.isFinite(lon)) setDefaultViewToLocalMeridian(lon);
      Celestial.redraw();
    },
    () => {
      // 失敗時はフォールバックで初期化済みなので何もしない
    },
    {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 5 * 60 * 1000,
    },
  );
}

// ============================================================
// 投影法の適用
// ============================================================
// d3-celestialの描画を作り直して投影法を変更する。
function applyProjection(projection) {
  // 投影法変更は Celestial.display() により再初期化が走るため、
  // 直前の表示状態（回転中心/ズーム）を退避して復元する。
  //
  // NOTE: follow=zenith の場合、settings.center が null のままでも画面中心は動くため、
  // settings.center ではなく rotate()/zoomBy() から現在ビューを取得する。
  const prevRotate = typeof Celestial?.rotate === "function" ? Celestial.rotate() : null; // [lon, lat, orient]
  const prevZoom = typeof Celestial?.zoomBy === "function" ? Celestial.zoomBy() : null;
  const isPlanisphere = projection === PROJECTION_PLANISPHERE;
  const actualProjection = isPlanisphere ? PLANISPHERE_BASE_PROJECTION : projection;
  const follow = isPlanisphere ? "zenith" : "center";

  // 現行設定をベースに投影法だけ差し替えて再描画
  // 「星座早見盤」のみ zenith 追従、それ以外は center 追従にする
  CELESTIAL_CONFIG.projection = actualProjection;
  CELESTIAL_CONFIG.follow = follow;
  const nextConfig = { ...CELESTIAL_CONFIG, projection: actualProjection, follow };
  Celestial.display(nextConfig);

  // 既存の独自レイヤーを再バインド
  if (AppState.AINU_GEOJSON) {
    bindAinuFeatures();
  }

  // 早見盤モードでは観測地に応じて中心を即時再計算
  if (isPlanisphere) {
    const lat = AppState.CURRENT_GEO_POS?.[0];
    const lon = AppState.CURRENT_GEO_POS?.[1];
    if (Number.isFinite(lon)) {
      setDefaultViewToLocalMeridian(lon, lat);
    }
  }

  // 投影法変更それ自体で時刻を更新すると表示が動くため、ここでは date を触らない

  // 直前のビュー（回転中心/ズーム）を復元
  if (!isPlanisphere && prevRotate && typeof Celestial?.rotate === "function") {
    Celestial.rotate({ center: prevRotate });
  }

  if (typeof prevZoom === "number" && Number.isFinite(prevZoom) && typeof Celestial?.zoomBy === "function") {
    const afterZoom = Celestial.zoomBy();
    if (typeof afterZoom === "number" && Number.isFinite(afterZoom) && afterZoom) {
      Celestial.zoomBy(prevZoom / afterZoom);
    }
  }

  Celestial.redraw();
}

// ============================================================
// 市町村未選択時のリセット処理
// ============================================================
// 選択状態・描画・UIを初期状態に戻します。
function resetSelection() {
  // 選択状態をリセットし、未選択に戻す。
  AppState.CURRENT_CITY = null;
  AppState.CURRENT_AREA_KEYS = [];
  AppState.AINU_GEOJSON = null;
  AppState.SELECTED_AINU_FEATURE_ID = null;

  // clear drawn features and reset UI to initial state
  Celestial.container?.selectAll(".ainu-constellation").remove();
  updateAreaMapPreview([AREA_DEFAULT]);
  updateRegionInfo();
  updateAinuList();

  // 未選択状態に戻ったら、ブラウザの現在地（またはフォールバック）で子午線中心に戻す
  initDefaultViewFromBrowserLocation();
}

// ============================================================
// ローディング表示の切り替え
// ============================================================
// データ取得中や処理中にインジケータを表示・非表示します。
function setLoadingMessage(text) {
  const el = document.getElementById("loading-indicator");
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.style.display = "block";
  } else {
    el.textContent = "";
    el.style.display = "none";
  }
}

// ============================================================
// 地域情報表示の更新
// ============================================================
// 選択状態に応じて右側の地域名・区分・文化地域を表示します。
// 未選択時はダミー文言を表示。
function updateRegionInfo() {
  const div = document.getElementById("region-info");
  if (!AppState.CURRENT_CITY) {
    div.innerHTML = ["<div><strong>振興局　　：</strong>未選択</div>", "<div><strong>地方区分　：</strong>未選択</div>", "<div><strong>気象予報区：</strong>未選択</div>", "<div><strong>星文化地域：</strong>未選択</div>"].join("");
    return;
  }
  // areaキーを区分名に変換して表示
  const areaLabels = (AppState.CURRENT_AREA_KEYS || []).map((key) => AREA_LABEL_MAP[key] || key).join(" / ");
  div.innerHTML = [`<div><strong>振興局　　：</strong>${AppState.CURRENT_BUREAU}</div>`, `<div><strong>地方区分　：</strong>${AppState.CURRENT_REGION}</div>`, `<div><strong>気象予報区：</strong>${AppState.CURRENT_FORECAST}</div>`, `<div><strong>星文化地域：</strong>${areaLabels}</div>`].join("");
}

function getAinuFeatureId(feature) {
  const id = feature?.id ?? feature?.properties?.id;
  return id == null ? "" : String(id);
}

let AINU_LIST_VIEWPORT_SYNC_RAF = 0;

function scheduleAinuListViewportSync() {
  if (AINU_LIST_VIEWPORT_SYNC_RAF) return;
  AINU_LIST_VIEWPORT_SYNC_RAF = requestAnimationFrame(() => {
    AINU_LIST_VIEWPORT_SYNC_RAF = 0;
    syncAinuListToViewport();
  });
}

function syncAinuListToViewport() {
  const list = document.getElementById("ainu-list");
  if (!list) return;

  const visibleSet = AppState.VISIBLE_AINU_FEATURE_IDS;
  const canFilter = true; // 常に「画面内の星文化だけ表示」

  for (const li of list.querySelectorAll("li")) {
    const btn = li.querySelector("button[data-ainu-id]");
    if (!btn) continue;
    const id = String(btn.dataset.ainuId || "");
    const isInView = !!id && visibleSet?.has(id);
    li.hidden = canFilter ? !isInView : false;
  }
}

function updateVisibleAinuFeatureIds(transformedFeatures, ctx) {
  if (!Array.isArray(transformedFeatures)) return;
  const canvas = ctx?.canvas;
  const w = canvas?.width;
  const h = canvas?.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;

  const margin = 14;
  const next = AppState.VISIBLE_AINU_FEATURE_IDS;
  if (!(next instanceof Set)) return;
  next.clear();

  for (const f of transformedFeatures) {
    const id = getAinuFeatureId(f);
    const loc = f?.properties?.loc;
    if (!id || !loc) continue;
    const xy = Celestial.mapProjection(loc);
    if (!xy) continue;
    const x = xy[0];
    const y = xy[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < -margin || x > w + margin) continue;
    if (y < -margin || y > h + margin) continue;
    next.add(id);
  }

  scheduleAinuListViewportSync();
}

function setupAinuListInteraction() {
  const list = document.getElementById("ainu-list");
  if (!list) return;
  if (list.dataset.ainuClickBound === "1") return;
  list.dataset.ainuClickBound = "1";

  list.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-ainu-id]");
    if (!btn || !list.contains(btn)) return;
    const id = String(btn.dataset.ainuId || "");
    if (!id) return;

    AppState.SELECTED_AINU_FEATURE_ID = AppState.SELECTED_AINU_FEATURE_ID === id ? null : id;

    updateAinuList();
    if (typeof Celestial?.redraw === "function") Celestial.redraw();
  });
}

// ============================================================
// アイヌ民族星文化リスト表示の更新
// ============================================================
// 選択地域に対応する星文化情報をリスト表示。
// GeoJSONデータがなければメッセージのみ表示します。
function updateAinuList() {
  const list = document.getElementById("ainu-list");
  list.innerHTML = "";

  if (!AppState.AINU_GEOJSON?.features?.length) {
    // 該当地域がなければメッセージだけ表示。
    list.innerHTML = `<li>${MSG_NO_AINU}</li>`;
    AppState.SELECTED_AINU_FEATURE_ID = null;
    AppState.VISIBLE_AINU_FEATURE_IDS?.clear?.();
    return;
  }

  // 選択中IDがリストに存在しない場合は解除
  const idSet = new Set(AppState.AINU_GEOJSON.features.map(getAinuFeatureId));
  if (AppState.SELECTED_AINU_FEATURE_ID && !idSet.has(AppState.SELECTED_AINU_FEATURE_ID)) {
    AppState.SELECTED_AINU_FEATURE_ID = null;
  }

  // 各星文化をリストアイテムとして描画。
  for (const f of AppState.AINU_GEOJSON.features) {
    const id = getAinuFeatureId(f);
    const name = f.properties?.n || "";
    const desc = f.properties?.desc || "";
    const isSelected = id && id === String(AppState.SELECTED_AINU_FEATURE_ID || "");

    const li = document.createElement("li");
    if (isSelected) li.classList.add("is-selected");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ainu-name-btn";
    btn.dataset.ainuId = id;
    btn.textContent = name;
    btn.setAttribute("aria-pressed", isSelected ? "true" : "false");

    const descDiv = document.createElement("div");
    descDiv.className = "desc";
    descDiv.textContent = desc;

    li.appendChild(btn);
    li.appendChild(descDiv);
    list.appendChild(li);
  }

  syncAinuListToViewport();
}

// ============================================================
// Celestial.js 初期化と独自レイヤー追加
// ============================================================
// 独自GeoJSONレイヤーを追加し、星座線・ラベル描画のコールバックを登録します。
function setupCelestial() {
  Celestial.add({
    type: "line",

    // GeoJSON が揃ったタイミングで path 要素を作成。
    callback: () => {
      if (!AppState.AINU_GEOJSON) return;
      bindAinuFeatures();
    },

    redraw: () => {
      const ctx = Celestial.context;
      const selectedId = String(AppState.SELECTED_AINU_FEATURE_ID || "");

      // path 要素に紐づくデータを Canvas に描画。
      const sel = Celestial.container.selectAll(".ainu-constellation");
      const drawFeature = (d, style) => {
        Celestial.setStyle(style);
        Celestial.map(d);
        ctx.fill();
        ctx.stroke();
      };

      // 非選択を先に描画し、選択中があれば最後に重ねる（見えやすさ優先）
      sel
        .filter((d) => !selectedId || getAinuFeatureId(d) !== selectedId)
        .each(function (d) {
          drawFeature(d, AINU_LINE_STYLE);
        });
      if (selectedId) {
        sel
          .filter((d) => getAinuFeatureId(d) === selectedId)
          .each(function (d) {
            drawFeature(d, AINU_HIGHLIGHT_LINE_STYLE);
          });
      }

      // ラベル用に GeoJSON を再投影し、中心座標に文字を描画。
      if (!AppState.AINU_GEOJSON) return;
      const transformed = Celestial.getData(AppState.AINU_GEOJSON, CELESTIAL_CONFIG.transform);

      const drawLabel = (f, isSelected) => {
        const name = f.properties?.n;
        const loc = f.properties?.loc;
        if (!name || !loc) return;

        // 使用した星の数で色分け
        const numPoints = f.properties?.starCount ?? f.geometry.coordinates.length;
        ctx.fillStyle = isSelected ? AINU_LABEL_COLOR_HIGHLIGHT : numPoints === 1 ? AINU_LABEL_COLOR_STAR : AINU_LABEL_COLOR_CONST;
        ctx.font = AINU_LABEL_FONT;
        ctx.textAlign = AINU_LABEL_TEXT_ALIGN;

        const xy = Celestial.mapProjection(loc);
        if (!xy) return;

        ctx.fillText(name, xy[0], xy[1]);
      };

      // ラベルも同様に「選択中を最後に」描画
      transformed.features.filter((f) => !selectedId || getAinuFeatureId(f) !== selectedId).forEach((f) => drawLabel(f, false));
      if (selectedId) {
        transformed.features.filter((f) => getAinuFeatureId(f) === selectedId).forEach((f) => drawLabel(f, true));
      }

      // 現在ビュー（ズーム/スクロール）で画面内に入っている星文化を一覧へ反映
      updateVisibleAinuFeatureIds(transformed.features, ctx);
    },
  });

  // 設定を元に Celestial の描画を開始。
  Celestial.display(CELESTIAL_CONFIG);

  // NOTE: 初期中心スナップショットは initApp() 側で（時刻反映後に）取得する。
}

// ============================================================
// GeoJSONデータのD3バインド
// ============================================================
// Celestial.jsの投影座標系に合わせてGeoJSONを変換し、path要素へデータバインドします。
function bindAinuFeatures() {
  if (!AppState.AINU_GEOJSON) return;

  // GeoJSON を現在の投影設定に合わせて変換。
  const transformed = Celestial.getData(AppState.AINU_GEOJSON, CELESTIAL_CONFIG.transform);

  // Feature ごとに path を紐づけ。id をキーに差分更新する。
  const sel = Celestial.container.selectAll(".ainu-constellation").data(transformed.features, (d) => getAinuFeatureId(d));

  sel.exit().remove();
  sel
    .enter()
    .append("path")
    .attr("class", "ainu-constellation")
    .attr("data-ainu-id", (d) => getAinuFeatureId(d));
}

// ============================================================
// 選択地域に対応するGeoJSONデータの生成・更新
// ============================================================
// 現在の文化地域キーで星文化GeoJSONを再生成し、描画レイヤーを更新します。
function updateAinuGeoJSON() {
  const areaKeys = AppState.CURRENT_AREA_KEYS || [];
  if (!areaKeys.length) return;

  // 現在の文化地域キーで GeoJSON を再生成。
  AppState.AINU_GEOJSON = buildAinuGeoJSON(AppState.AINU_DATA.constellations, AppState.AINU_DATA.stars, areaKeys);

  // path 要素とデータの紐付けを更新。
  bindAinuFeatures();
}

// ============================================================
// 赤経・赤緯 → 経度・緯度変換
// ============================================================
// 赤経が180度を跨ぐ場合は負側に反転し、地図座標系に合わせます。
function raDecToLonLat(raDeg, decDeg) {
  return [raDeg > 180 ? raDeg - 360 : raDeg, decDeg];
}

// ============================================================
// アイヌ民族星文化データ → GeoJSON生成
// ============================================================
// 地域ごとの星文化定義から線分・ラベル位置を算出し、MultiLineString形式でGeoJSON化します。
function buildAinuGeoJSON(constellations, stars, areaKeys) {
  const areaKeyList = Array.isArray(areaKeys) ? areaKeys.filter(Boolean) : areaKeys ? [areaKeys] : [];
  if (!areaKeyList.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const targetAinuCodes = mapAreaKeysToAinuCodes(areaKeyList);
  if (!targetAinuCodes.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const starMap = stars || {};
  const features = [];
  const seenFeatureIds = new Set();

  for (const c of constellations || []) {
    const name = c?.name;
    const desc = c?.description || "";
    if (!name) continue;

    const belongs = Array.isArray(c.ainu) && c.ainu.some((code) => targetAinuCodes.includes(code));
    if (!belongs) continue;

    const lineSegments = [];
    const usedPoints = [];

    for (const item of c.lines || []) {
      const indices = Array.isArray(item) ? item : [item];
      for (let i = 0; i < indices.length - 1; i++) {
        const s1 = starMap[indices[i]];
        const s2 = starMap[indices[i + 1]];
        if (!s1 || !s2) continue;
        const p1 = raDecToLonLat(s1.ra, s1.dec);
        const p2 = raDecToLonLat(s2.ra, s2.dec);
        lineSegments.push([p1, p2]);
        usedPoints.push(p1, p2);
      }
      if (indices.length === 1) {
        const s = starMap[indices[0]];
        if (!s) continue;
        const p = raDecToLonLat(s.ra, s.dec);
        lineSegments.push([p, p]);
        usedPoints.push(p);
      }
    }

    if (!lineSegments.length) continue;

    let labelLon, labelLat;
    if (typeof c.ra === "number" && typeof c.dec === "number") {
      [labelLon, labelLat] = raDecToLonLat(c.ra, c.dec);
    } else {
      labelLon = usedPoints.reduce((a, p) => a + p[0], 0) / usedPoints.length;
      labelLat = usedPoints.reduce((a, p) => a + p[1], 0) / usedPoints.length;
    }

    const uniqueStarCount = new Set(usedPoints.map((p) => `${p[0]},${p[1]}`)).size;

    const featureIdBase = c.key || name;
    const featureId = featureIdBase || `const-${features.length}`;
    if (seenFeatureIds.has(featureId)) continue;
    seenFeatureIds.add(featureId);

    features.push({
      type: "Feature",
      id: featureId,
      properties: {
        id: featureId,
        n: name,
        loc: [labelLon, labelLat],
        desc,
        starCount: uniqueStarCount,
      },
      geometry: { type: "MultiLineString", coordinates: lineSegments },
    });
  }

  return { type: "FeatureCollection", features };
}

// ============================================================
// 地図エリアプレビュー画像の切り替え
// ============================================================
// 選択地域に応じて地図画像を表示・非表示します。
function updateAreaMapPreview(areaKeys) {
  const wrapper = document.getElementById("area-map-preview");
  const single = document.getElementById("area-map-single");
  const stack = document.getElementById("area-map-stack");
  if (!wrapper || !single || !stack) return;

  if (DEFAULT_STACK_HTML === null) {
    DEFAULT_STACK_HTML = stack.innerHTML;
  }

  const noCitySelected = !AppState.CURRENT_CITY;

  if (noCitySelected) {
    // 未選択時は初期状態の比較暗合成を表示
    stack.innerHTML = DEFAULT_STACK_HTML;
    // 未選択時は area0 を最上位に、area1-5 を重ねた比較暗合成を表示
    wrapper.style.display = "block";
    stack.style.display = "block";
    single.style.display = "none";
    return;
  }

  const keys = Array.isArray(areaKeys) ? areaKeys.filter(Boolean) : areaKeys ? [areaKeys] : [];

  if (!keys.length) {
    wrapper.style.display = "none";
    single.style.display = "none";
    stack.style.display = "none";
    single.src = "";
    return;
  }

  const uniqueKeys = Array.from(new Set(keys));

  // エリアが複数なら比較暗合成で重ねて表示
  const layerOrder = [...uniqueKeys];
  // area0 は常に最上位に来るように順序を整える
  if (!layerOrder.includes("area0")) {
    layerOrder.push("area0");
  } else {
    const filtered = layerOrder.filter((k) => k !== "area0");
    layerOrder.length = 0;
    layerOrder.push(...filtered, "area0");
  }

  stack.innerHTML = "";
  for (const key of layerOrder) {
    const img = document.createElement("img");
    img.src = `img/${key}.png`;
    img.alt = `エリアマップ ${key}`;
    img.className = "area-stack-layer";
    stack.appendChild(img);
  }

  single.style.display = "none";
  single.src = "";
  stack.style.display = "block";
  wrapper.style.display = "block";

  updateAreaMapA11y(areaKeys);
}

// ============================================================
// エリアマッププレビュー更新（アクセシビリティも含む）
// ============================================================
function updateAreaMapA11y(areaKeys) {
  const preview = document.getElementById("area-map-preview");
  const img = document.getElementById("area-map-single");

  const labels = (Array.isArray(areaKeys) ? areaKeys : [])
    .map((k) => AREA_LABEL_MAP[k] || k)
    .filter(Boolean);

  const text = labels.length ? `エリアマップ: ${labels.join(" / ")}` : "エリアマップ（未選択）";
  if (preview) preview.setAttribute("aria-label", text);
  if (img) img.setAttribute("alt", text);
}

// ============================================================
// 緯度経度解決・天球図への反映
// ============================================================
// 市町村マップの area/areas 定義を配列化して返却する。
function normalizeAreaKeys(cityInfo) {
  if (!cityInfo) return [AREA_DEFAULT];
  if (Array.isArray(cityInfo.areas)) {
    const arr = cityInfo.areas.filter(Boolean);
    return arr.length ? arr : [AREA_DEFAULT];
  }
  if (cityInfo.area) return [cityInfo.area];
  return [AREA_DEFAULT];
}

// 市町村マップから選択市町村の緯度経度を取得し、欠損している場合は札幌市をフォールバックする。
function resolveCityCoordinates(cityName, cityMap) {
  const map = cityMap || {};
  const fallback = map[DEFAULT_CITY_LOCATION] || {};
  const target = map[cityName] || {};

  // 緯度経度が欠損している場合は札幌の値で補完
  const lat = Number.isFinite(target.lat) ? target.lat : Number.isFinite(fallback.lat) ? fallback.lat : null;
  const lon = Number.isFinite(target.lon) ? target.lon : Number.isFinite(fallback.lon) ? fallback.lon : null;

  return { lat, lon };
}

// 取得した緯度経度を Celestial.js に適用し、設定を保持する。
function applyGeoposition(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  CELESTIAL_CONFIG.geopos = [lat, lon];
  AppState.CURRENT_GEO_POS = [lat, lon];
  Celestial.apply({ geopos: [lat, lon] });
  if (CELESTIAL_CONFIG.follow === "zenith") {
    setDefaultViewToLocalMeridian(lon, lat);
  }
}

function mapAreaKeysToAinuCodes(areaKeys) {
  // UI用のareaキーをデータ定義用のainuコードへ変換（重複を除外）
  const map = {
    area1: "ainu1",
    area2: "ainu2",
    area3: "ainu3",
    area4: "ainu4",
    area5: "ainu5",
  };
  const codes = new Set();
  for (const key of areaKeys || []) {
    const code = map[key];
    if (code) codes.add(code);
  }
  return Array.from(codes);
}
