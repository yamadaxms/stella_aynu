// ============================================================
// アイヌ民族星文化データ取得モジュール
// ============================================================
// フロントエンドで必要になる以下のデータを、APIからまとめて取得するための小さな境界層です。
// - stars: HIP番号をキーにした恒星の赤経・赤緯。星座線を天球図へ投影するために使う。
// - constellations: アイヌ民族星文化の名称・説明・星座線・対応文化地域。GeoJSON生成の元データ。
// - cityMap: 現在の市町村と、気象予報区・文化地域・緯度経度の対応。UI更新と観測地設定に使う。
//
// fetchのHTTPエラー判定とJSON変換をここに閉じ込めることで、main.js側は
// 「データをロードできたか / 失敗したか」だけに集中できるようにしています。
// APIのベースURLは window.AYNU_API_BASE_URL で差し替え可能にし、ローカル検証や別環境のAPIへ向けやすくしています。

const API_BASE_URL = (window.AYNU_API_BASE_URL || "https://b43aedz221.execute-api.ap-northeast-1.amazonaws.com").replace(/\/$/, "");
const AYNU_DATA_API_PATH = `${API_BASE_URL}/api/aynu-data`;

async function loadApiJSON(url) {
  // API Gateway / Lambda からJSONだけを受け取る前提なので Accept を明示する。
  // no-store にして、DB側の更新後にブラウザキャッシュが古い星文化データを返さないようにする。
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    // Lambda側が {"error": "..."} を返した場合は、HTTPステータスだけでなく理由も画面に出せるように含める。
    // JSONでないエラーページが返るケースもあるため、本文の解析失敗は握りつぶして汎用エラーに落とす。
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ? `: ${body.error}` : "";
    } catch (_) {
      detail = "";
    }
    throw new Error(`データAPIの読み込みに失敗しました: ${url} (${res.status})${detail}`);
  }
  return await res.json();
}

/**
 * 星文化定義データ・市町村→エリア対応表・恒星座標をAPIから取得します。
 *
 * 以前の静的JSON分割では複数ファイルの整合性を呼び出し元で意識する必要がありました。
 * 現在はLambdaがDBから同一レスポンスにまとめるため、ここでは欠損時の既定値だけ補い、
 * 画面側が常に同じ形のオブジェクトを扱えるようにします。
 *
 * @returns {Promise<{stars: Object, constellations: Array, cityMap: Object}>}
 *   stars: Hipparcos番号→座標（赤経・赤緯）
 *   constellations: 地域別星文化定義
 *   cityMap: 市町村→文化地域と緯度経度の対応表
 * @throws {Error} - いずれかの取得失敗時
 */
async function loadAllAynuData() {
  const data = await loadApiJSON(AYNU_DATA_API_PATH);
  return {
    stars: data?.stars || {},
    constellations: Array.isArray(data?.constellations) ? data.constellations : [],
    cityMap: data?.cityMap || {},
  };
}
