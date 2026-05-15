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

  const AYNU_LABEL_MAP = {
    aynu1: "区分Ⅰ",
    aynu2: "区分Ⅱ",
    aynu3: "区分Ⅲ",
    aynu4: "区分Ⅳ",
    aynu5: "区分Ⅴ",
  };

  function getPublishValue(item) {
    return item?.is_published ?? item?.star_culture?.is_published ?? item?.starCulture?.is_published;
  }

  function hasPublishValue(item) {
    return getPublishValue(item) !== undefined && getPublishValue(item) !== null;
  }

  function isPublished(item, hasPublishFlag) {
    if (!hasPublishFlag && !hasPublishValue(item)) return true;

    const value = getPublishValue(item);
    if (value === true) return true;
    if (value === 1) return true;
    if (typeof value === "string") {
      return ["true", "t", "1"].includes(value.trim().toLowerCase());
    }
    return false;
  }

  function getCultureKey(item) {
    return (
      item?.key ??
      item?.star_culture?.key ??
      item?.starCulture?.key ??
      item?.star_culture_key ??
      ""
    );
  }

  function getName(item) {
    return item?.name ?? item?.star_culture?.name ?? item?.starCulture?.name ?? "";
  }

  function getDescription(item) {
    return (
      item?.description ??
      item?.star_culture?.description ??
      item?.starCulture?.description ??
      item?.meaning ??
      ""
    );
  }

  function getAynuCodes(item) {
    const value = item?.aynu ?? item?.star_culture?.aynu ?? item?.starCulture?.aynu;
    return Array.isArray(value) ? value : [];
  }

  function getLines(item) {
    const value = item?.lines ?? item?.star_culture?.lines ?? item?.starCulture?.lines;
    return Array.isArray(value) ? value : [];
  }

  function getRa(item) {
    return item?.ra ?? item?.star_culture?.ra ?? item?.starCulture?.ra;
  }

  function getDec(item) {
    return item?.dec ?? item?.star_culture?.dec ?? item?.starCulture?.dec;
  }

  function formatNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return new Intl.NumberFormat("ja-JP", {
      maximumFractionDigits: 6,
    }).format(num);
  }

  function formatAynu(value) {
    if (!Array.isArray(value)) return "-";
    const labels = value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .map((code) => AYNU_LABEL_MAP[code] || code);
    return labels.length ? labels.join(" / ") : "-";
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
    td.textContent = value;

    tr.appendChild(th);
    tr.appendChild(td);
    els.basic.appendChild(tr);
  }

  function flattenLineItem(item, out = []) {
    if (Array.isArray(item)) {
      for (const child of item) flattenLineItem(child, out);
      return out;
    }

    const text = String(item ?? "").trim();
    if (text) out.push(text);
    return out;
  }

  function getLineItems(lines) {
    return Array.isArray(lines) ? lines : [];
  }

  function collectUsedStarKeys(lines) {
    const seen = new Set();
    const keys = [];

    for (const item of getLineItems(lines)) {
      for (const key of flattenLineItem(item)) {
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
    }

    return keys;
  }

  function renderBasic(item) {
    els.basic.textContent = "";
    appendBasicRow("星文化キー", formatText(getCultureKey(item)));
    appendBasicRow("名称", formatText(getName(item)));
    appendBasicRow("意味", formatText(getDescription(item)));
    appendBasicRow("RA", formatNumber(getRa(item)));
    appendBasicRow("Dec", formatNumber(getDec(item)));
    appendBasicRow("伝承地域", formatAynu(getAynuCodes(item)));
  }

  function renderLines(lines) {
    const lineItems = getLineItems(lines);
    els.lines.textContent = "";

    const fragment = document.createDocumentFragment();
    lineItems.forEach((item, index) => {
      const tr = document.createElement("tr");
      const numberCell = document.createElement("td");
      const starsCell = document.createElement("td");
      const starKeys = flattenLineItem(item);

      numberCell.textContent = String(index + 1);
      starsCell.className = "star-culture-code-cell";
      starsCell.textContent = starKeys.length ? starKeys.join(" -> ") : "-";

      tr.appendChild(numberCell);
      tr.appendChild(starsCell);
      fragment.appendChild(tr);
    });

    els.lines.appendChild(fragment);
    setHidden(els.linesWrap, lineItems.length === 0);
    setHidden(els.linesEmpty, lineItems.length !== 0);
  }

  function renderStars(lines, stars) {
    const starKeys = collectUsedStarKeys(lines);
    const starMap = stars && typeof stars === "object" ? stars : {};
    els.stars.textContent = "";

    const fragment = document.createDocumentFragment();
    for (const key of starKeys) {
      const tr = document.createElement("tr");
      const keyCell = document.createElement("td");
      const raCell = document.createElement("td");
      const decCell = document.createElement("td");
      const star = starMap[key] || {};

      keyCell.className = "star-culture-code-cell";
      keyCell.textContent = key;
      raCell.textContent = formatNumber(star.ra);
      decCell.textContent = formatNumber(star.dec);

      tr.appendChild(keyCell);
      tr.appendChild(raCell);
      tr.appendChild(decCell);
      fragment.appendChild(tr);
    }

    els.stars.appendChild(fragment);
    setHidden(els.starsWrap, starKeys.length === 0);
    setHidden(els.starsEmpty, starKeys.length !== 0);
  }

  function renderDetail(item, stars) {
    const lines = getLines(item);
    renderBasic(item);
    renderLines(lines);
    renderStars(lines, stars);

    const key = String(getCultureKey(item)).trim();
    if (els.listLink && key) {
      els.listLink.href = `star-cultures.html?key=${encodeURIComponent(key)}`;
    }

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

      renderDetail(item, data?.stars || {});
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
    els.lines = getElement("star-culture-lines");
    els.linesWrap = getElement("star-culture-lines-wrap");
    els.linesEmpty = getElement("star-culture-lines-empty");
    els.stars = getElement("star-culture-stars");
    els.starsWrap = getElement("star-culture-stars-wrap");
    els.starsEmpty = getElement("star-culture-stars-empty");
    els.listLink = getElement("star-culture-detail-list-link");

    loadDetail();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
