// このモジュールは複数のデータセット（星文化定義、市町村→エリア対応表、星の座標情報など）を効率的かつ安全に取得するためのヘルパー関数群を提供します。
// 各関数は役割を明確に分離し、データ取得・検証・変換の責務を担います。
// fetchによるデータ取得時のエラー検証やJSON変換は本モジュールで行い、呼び出し元はtry-catchで例外処理を一括管理できます。

const API_BASE_URL = (window.AYNU_API_BASE_URL || "https://b43aedz221.execute-api.ap-northeast-1.amazonaws.com").replace(/\/$/, "");
const AYNU_DATA_API_PATH = `${API_BASE_URL}/api/aynu-data`;

async function loadApiJSON(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
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
 * 星文化定義データ・市町村→エリア対応表・恒星座標を並列で取得します。
 * 取得した全データをオブジェクトでまとめて返します。
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
