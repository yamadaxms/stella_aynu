(() => {
  const ERROR_MESSAGE = "データの読み込みに失敗しました";

  const state = {
    constellations: [],
    hasPublishFlag: false,
    query: "",
    region: "",
  };

  const els = {};

  function getElement(id) {
    return document.getElementById(id);
  }

  function normalizeText(value) {
    return String(value ?? "").trim().toLowerCase();
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

  function isPublished(item) {
    if (!state.hasPublishFlag && !hasPublishValue(item)) return true;

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
    if (!Array.isArray(value)) return [];
    return value.map((code) => String(code || "").trim()).filter(Boolean);
  }

  function formatAynu(item) {
    const labels = getAynuCodes(item).map((code) => AYNU_LABEL_MAP[code] || code);
    return labels.length ? labels.join(" / ") : "-";
  }

  function getNameEn(item) {
    return (
      item?.star_culture?.name_en ??
      item?.starCulture?.name_en ??
      item?.name_en ??
      item?.nameEn ??
      item?.star_culture_name_en ??
      ""
    );
  }

  function collectAstroNamesFrom(value, out) {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) collectAstroNamesFrom(item, out);
      return;
    }

    if (typeof value === "string") {
      const text = value.trim();
      if (text) out.push(text);
      return;
    }

    if (typeof value === "object") {
      const text =
        value.astro_name ??
        value.astroName ??
        value.name ??
        value.star?.astro_name ??
        value.star?.astroName ??
        value.astro?.name ??
        value.astro?.astro_name;
      if (text) out.push(String(text).trim());
    }
  }

  function getAstroNames(item) {
    const names = [];
    collectAstroNamesFrom(item?.star_astro_link, names);
    collectAstroNamesFrom(item?.star_astro_links, names);
    collectAstroNamesFrom(item?.astro_names, names);
    collectAstroNamesFrom(item?.astroNames, names);
    collectAstroNamesFrom(item?.related_astro_names, names);

    return Array.from(new Set(names.filter(Boolean)));
  }

  function formatAstroNames(item) {
    const names = getAstroNames(item);
    return names.length ? names.join(",") : "-";
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

  function updateCount(count) {
    if (!els.resultCount) return;
    els.resultCount.textContent = `${count}件`;
  }

  function createCell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function createDetailCell(item) {
    const td = document.createElement("td");
    const key = String(getCultureKey(item)).trim();

    if (!key) {
      td.textContent = "-";
      return td;
    }

    const link = document.createElement("a");
    link.className = "star-culture-action-link";
    link.href = `star-culture-detail.html?key=${encodeURIComponent(key)}`;
    link.textContent = "詳細";
    td.appendChild(link);
    return td;
  }

  function filterConstellations() {
    const query = normalizeText(state.query);
    const region = state.region;

    return state.constellations.filter((item) => {
      if (!isPublished(item)) return false;

      const nameEn = getNameEn(item);
      const astroNames = getAstroNames(item).join(",");
      const matchesQuery =
        !query ||
        normalizeText(getName(item)).includes(query) ||
        normalizeText(getDescription(item)).includes(query) ||
        normalizeText(getCultureKey(item)).includes(query) ||
        normalizeText(nameEn).includes(query) ||
        normalizeText(astroNames).includes(query);

      const aynu = getAynuCodes(item);
      const matchesRegion = !region || aynu.includes(region);

      return matchesQuery && matchesRegion;
    });
  }

  function renderRows(rows) {
    if (!els.results) return;
    els.results.textContent = "";

    const fragment = document.createDocumentFragment();
    for (const item of rows) {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(formatText(getName(item)), "star-culture-name-cell"));
      tr.appendChild(createCell(formatText(getDescription(item)), "star-culture-description-cell"));
      tr.appendChild(createCell(formatText(getNameEn(item)), "star-culture-code-cell"));
      tr.appendChild(createCell(formatAstroNames(item)));
      tr.appendChild(createCell(formatAynu(item)));
      tr.appendChild(createDetailCell(item));
      fragment.appendChild(tr);
    }

    els.results.appendChild(fragment);
  }

  function render() {
    const rows = filterConstellations();
    renderRows(rows);
    updateCount(rows.length);
    setHidden(els.tableWrap, rows.length === 0);
    setHidden(els.empty, rows.length !== 0);
  }

  function bindEvents() {
    els.query?.addEventListener("input", (event) => {
      state.query = event.target.value;
      render();
    });

    els.region?.addEventListener("change", (event) => {
      state.region = event.target.value;
      render();
    });

    els.reset?.addEventListener("click", () => {
      state.query = "";
      state.region = "";
      if (els.query) els.query.value = "";
      if (els.region) els.region.value = "";
      render();
      els.query?.focus();
    });
  }

  function applyInitialFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("key") || params.get("q") || "";
    const region = params.get("region") || "";

    state.query = query;
    state.region = /^aynu[1-5]$/.test(region) ? region : "";

    if (els.query) els.query.value = state.query;
    if (els.region) els.region.value = state.region;
  }

  async function loadData() {
    setLoading(true);
    showStatus("");
    setHidden(els.empty, true);
    setHidden(els.tableWrap, true);

    try {
      if (typeof loadAllAynuData !== "function") {
        throw new Error("loadAllAynuData is not available");
      }

      const data = await loadAllAynuData();
      state.constellations = Array.isArray(data?.constellations) ? data.constellations : [];
      state.hasPublishFlag = state.constellations.some(hasPublishValue);
      render();
    } catch (err) {
      console.error(err);
      state.constellations = [];
      state.hasPublishFlag = false;
      updateCount(0);
      showStatus(ERROR_MESSAGE);
      setHidden(els.empty, true);
      setHidden(els.tableWrap, true);
    } finally {
      setLoading(false);
    }
  }

  function init() {
    els.query = getElement("star-culture-query");
    els.region = getElement("star-culture-region");
    els.reset = getElement("star-culture-reset");
    els.results = getElement("star-culture-results");
    els.tableWrap = getElement("star-culture-table-wrap");
    els.empty = getElement("star-culture-empty");
    els.loading = getElement("star-culture-loading");
    els.status = getElement("star-culture-status");
    els.resultCount = getElement("star-culture-result-count");

    bindEvents();
    applyInitialFiltersFromUrl();
    loadData();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
