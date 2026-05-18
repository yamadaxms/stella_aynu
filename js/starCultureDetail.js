(() => {
  const ERROR_MESSAGE = "データの読み込みに失敗しました";

  const els = {};

  function getElement(id) {
    return document.getElementById(id);
  }

  function formatText(value) {
    const text = String(value ?? "").trim();
    return text || "-";
  }

  function getPublishValue(item) {
    return item?.is_published ?? item?.star_culture?.is_published ?? item?.starCulture?.is_published;
  }

  function hasPublishValue(item) {
    return getPublishValue(item) !== undefined && getPublishValue(item) !== null;
  }

  function isPublished(item, hasPublishFlag) {
    if (!hasPublishFlag && !hasPublishValue(item)) return true;

    const value = getPublishValue(item);
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      return ["true", "t", "1"].includes(value.trim().toLowerCase());
    }
    return false;
  }

  function getCultureKey(item) {
    return item?.star_culture_id ?? item?.key ?? item?.star_culture?.star_culture_id ?? item?.star_culture?.key ?? item?.starCulture?.star_culture_id ?? item?.starCulture?.key ?? item?.star_culture_key ?? "";
  }

  function getField(item, field) {
    return item?.[field] ?? item?.star_culture?.[field] ?? item?.starCulture?.[field] ?? "";
  }

  function setHidden(el, hidden) {
    if (el) el.hidden = hidden;
  }

  function setLoading(isLoading) {
    setHidden(els.loading, !isLoading);
  }

  function showStatus(message) {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.hidden = !message;
  }

  function appendBasicRow(label, value) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    const td = document.createElement("td");

    th.scope = "row";
    th.textContent = label;
    td.textContent = formatText(value);

    tr.appendChild(th);
    tr.appendChild(td);
    els.basic.appendChild(tr);
  }

  function renderBasic(item) {
    els.basic.textContent = "";
    appendBasicRow("星文化ID", getField(item, "star_culture_id") || getCultureKey(item));
    appendBasicRow("名称", getField(item, "name_ja") || getField(item, "name"));
    appendBasicRow("名称（英字）", getField(item, "name_en"));
    appendBasicRow("意味", getField(item, "meaning") || getField(item, "description"));
    appendBasicRow("オリジナル名称", getField(item, "original_name_ja"));
    appendBasicRow("オリジナル名称（英字）", getField(item, "original_name_en"));
    appendBasicRow("オリジナル意味", getField(item, "original_meaning"));
    appendBasicRow("メモ", getField(item, "memo"));
  }

  function renderDetail(item) {
    renderBasic(item);
    setHidden(els.detail, false);
  }

  function getRequestedKey() {
    const params = new URLSearchParams(window.location.search);
    return String(params.get("key") || "").trim();
  }

  async function loadDetail() {
    const key = getRequestedKey();
    setLoading(true);
    showStatus("");
    setHidden(els.detail, true);

    if (!key) {
      showStatus("星文化キーが指定されていません。");
      setLoading(false);
      return;
    }

    try {
      if (typeof loadAllAynuData !== "function") {
        throw new Error("loadAllAynuData is not available");
      }

      const data = await loadAllAynuData();
      const constellations = Array.isArray(data?.constellations) ? data.constellations : [];
      const hasPublishFlag = constellations.some(hasPublishValue);
      const item = constellations.find((entry) => String(getCultureKey(entry)) === key && isPublished(entry, hasPublishFlag));

      if (!item) {
        showStatus("該当する星文化情報が見つかりませんでした。");
        return;
      }

      renderDetail(item);
    } catch (err) {
      console.error(err);
      showStatus(ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  }

  function init() {
    els.loading = getElement("star-culture-loading");
    els.status = getElement("star-culture-status");
    els.detail = getElement("star-culture-detail");
    els.basic = getElement("star-culture-basic");

    loadDetail();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
