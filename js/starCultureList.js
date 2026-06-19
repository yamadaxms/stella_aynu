(() => {
  const ERROR_MESSAGE = "データの読み込みに失敗しました";

  const state = {
    constellations: [],
    hasPublishFlag: false,
    query: "",
    regions: [],
    sortColumn: "name",
    sortDirection: "asc",
  };

  const els = {};
  const LIST_SORT_COLLATOR = new Intl.Collator("ja", {
    numeric: true,
    sensitivity: "base",
  });

  function getElement(id) {
    return document.getElementById(id);
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/[\u3041-\u3096]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
      .toLowerCase();
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
  const STANDARD_AYNU_CODES = Object.keys(AYNU_LABEL_MAP);
  const OTHER_REGION_FILTER = "other";
  const EXCLUDED_OTHER_AREA_NAMES = new Set(["全域"]);

  const AYNU_VARIANT_MAP = {
    1: "aynu1",
    2: "aynu2",
    3: "aynu3",
    4: "aynu4",
    5: "aynu5",
    i: "aynu1",
    ii: "aynu2",
    iii: "aynu3",
    iv: "aynu4",
    v: "aynu5",
    Ⅰ: "aynu1",
    Ⅱ: "aynu2",
    Ⅲ: "aynu3",
    Ⅳ: "aynu4",
    Ⅴ: "aynu5",
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
    return item?.key ?? item?.star_culture?.key ?? item?.starCulture?.key ?? item?.star_culture_key ?? "";
  }

  function getConstellationKey(item) {
    return (
      item?.constellation_key ??
      item?.star_culture?.constellation_key ??
      item?.starCulture?.constellation_key ??
      item?.constellationKey ??
      item?.star_culture?.constellationKey ??
      item?.starCulture?.constellationKey ??
      ""
    );
  }

  function getStarCultureId(item) {
    return item?.star_culture_id ?? item?.star_culture?.star_culture_id ?? item?.starCulture?.star_culture_id ?? item?.starCulture?.starCultureId ?? item?.starCultureId ?? "";
  }

  function getName(item) {
    return item?.name ?? item?.star_culture?.name ?? item?.starCulture?.name ?? "";
  }

  function getDescription(item) {
    return item?.description ?? item?.star_culture?.description ?? item?.starCulture?.description ?? item?.meaning ?? "";
  }

  function getOriginalNameJa(item) {
    return item?.star_culture?.original_name_ja ?? item?.starCulture?.original_name_ja ?? item?.starCulture?.originalNameJa ?? item?.original_name_ja ?? item?.originalNameJa ?? "";
  }

  function getOriginalNameEn(item) {
    return item?.star_culture?.original_name_en ?? item?.starCulture?.original_name_en ?? item?.starCulture?.originalNameEn ?? item?.original_name_en ?? item?.originalNameEn ?? "";
  }

  function getOriginalMeaning(item) {
    return item?.star_culture?.original_meaning ?? item?.starCulture?.original_meaning ?? item?.starCulture?.originalMeaning ?? item?.original_meaning ?? item?.originalMeaning ?? "";
  }

  function normalizeStandardAynuCode(value) {
    const text = String(value ?? "").normalize("NFKC").trim();
    if (!text) return "";

    const lower = text.toLowerCase();
    if (STANDARD_AYNU_CODES.includes(lower)) return lower;

    const simplified = lower
      .replace(/[（）()\[\]\s]/g, "")
      .replace(/^地域/, "")
      .replace(/^区分/, "");

    return AYNU_VARIANT_MAP[simplified] || "";
  }

  function getStandardAynuCodes(item) {
    const seen = new Set();
    const codes = [];

    for (const value of getAreaNames(item)) {
      const code = normalizeStandardAynuCode(value);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
    }

    return codes;
  }

  function getOtherAynuValues(item) {
    const seen = new Set();
    const values = [];

    for (const value of getAreaNames(item)) {
      for (const text of splitAreaName(value)) {
        if (!text || normalizeStandardAynuCode(text) || EXCLUDED_OTHER_AREA_NAMES.has(text.normalize("NFKC")) || seen.has(text)) continue;
        seen.add(text);
        values.push(text);
      }
    }

    return values;
  }

  function hasRegion(item, region) {
    if (region === OTHER_REGION_FILTER) return getOtherAynuValues(item).length > 0;
    return getStandardAynuCodes(item).includes(region);
  }

  function formatRegionMark(item, region) {
    return hasRegion(item, region) ? "○" : "";
  }

  function formatOtherRegions(item) {
    const values = getOtherAynuValues(item);
    return values.length ? values.join(",") : "";
  }

  function splitAreaName(value) {
    return String(value ?? "")
      .split(/[,\u3001\uff0c]/)
      .map((text) => text.trim())
      .filter(Boolean);
  }

  function collectAreaNamesFrom(value, out) {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) collectAreaNamesFrom(item, out);
      return;
    }

    if (typeof value === "string") {
      out.push(...splitAreaName(value));
      return;
    }

    if (typeof value === "object") {
      const text = value.area_name ?? value.areaName ?? value.name ?? value.area?.name ?? value.area?.area_name;
      out.push(...splitAreaName(text));
    }
  }

  function getAreaNames(item) {
    const names = [];
    collectAreaNamesFrom(item?.star_area_link, names);
    collectAreaNamesFrom(item?.star_area_links, names);
    collectAreaNamesFrom(item?.area_names, names);
    collectAreaNamesFrom(item?.areaNames, names);

    return Array.from(new Set(names.filter(Boolean)));
  }

  function getNameEn(item) {
    return item?.star_culture?.name_en ?? item?.starCulture?.name_en ?? item?.name_en ?? item?.nameEn ?? item?.star_culture_name_en ?? "";
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
      const text = value.astro_name ?? value.astroName ?? value.name ?? value.star?.astro_name ?? value.star?.astroName ?? value.astro?.name ?? value.astro?.astro_name;
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

  function createRegionMarkCell(item, region) {
    return createCell(formatRegionMark(item, region), "star-culture-region-mark-cell");
  }

  function createChartMarkCell(item) {
    const hasChart = String(getConstellationKey(item)).trim() !== "";
    return createCell(hasChart ? "○" : "", "star-culture-chart-mark-cell");
  }

  function createDetailCell(item) {
    const td = document.createElement("td");
    td.className = "star-culture-detail-cell";
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
    const regions = state.regions;

    return state.constellations.filter((item) => {
      if (!isPublished(item)) return false;

      const astroNames = getAstroNames(item).join(",");
      const queryTargets = [
        getName(item),
        getNameEn(item),
        getDescription(item),
        getStarCultureId(item),
        getOriginalNameJa(item),
        getOriginalNameEn(item),
        getOriginalMeaning(item),
        astroNames,
      ];
      const matchesQuery = !query || queryTargets.some((value) => normalizeText(value).includes(query));

      const matchesRegion = regions.length === 0 || regions.some((region) => hasRegion(item, region));

      return matchesQuery && matchesRegion;
    });
  }

  function getSortValue(item, column) {
    switch (column) {
      case "detail":
        return getCultureKey(item);
      case "name":
        return getName(item);
      case "nameEn":
        return getNameEn(item);
      case "description":
        return getDescription(item);
      case "astro":
        return getAstroNames(item).join(",");
      case "aynu1":
      case "aynu2":
      case "aynu3":
      case "aynu4":
      case "aynu5":
        return hasRegion(item, column);
      case "other":
        return formatOtherRegions(item);
      case "chart":
        return String(getConstellationKey(item)).trim() !== "";
      default:
        return "";
    }
  }

  function compareSortValues(a, b) {
    const aEmpty = a === null || a === undefined || a === "";
    const bEmpty = b === null || b === undefined || b === "";
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    if (aEmpty) return 0;

    if (typeof a === "boolean" && typeof b === "boolean") {
      return Number(a) - Number(b);
    }

    return LIST_SORT_COLLATOR.compare(String(a), String(b));
  }

  function compareRows(a, b) {
    const aValue = getSortValue(a, state.sortColumn);
    const bValue = getSortValue(b, state.sortColumn);
    const aEmpty = aValue === null || aValue === undefined || aValue === "";
    const bEmpty = bValue === null || bValue === undefined || bValue === "";
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;

    const direction = state.sortDirection === "desc" ? -1 : 1;
    const result = compareSortValues(aValue, bValue);
    if (result !== 0) return result * direction;
    return LIST_SORT_COLLATOR.compare(String(getName(a)), String(getName(b)));
  }

  function updateSortHeaders() {
    for (const th of els.tableHead?.querySelectorAll("th[data-sort-column]") || []) {
      const isCurrent = th.dataset.sortColumn === state.sortColumn;
      th.setAttribute("aria-sort", isCurrent ? (state.sortDirection === "desc" ? "descending" : "ascending") : "none");
    }
  }

  function renderRows(rows) {
    if (!els.results) return;
    els.results.textContent = "";

    const fragment = document.createDocumentFragment();
    for (const item of rows) {
      const tr = document.createElement("tr");
      tr.appendChild(createDetailCell(item));
      tr.appendChild(createCell(formatText(getName(item)), "star-culture-name-cell"));
      tr.appendChild(createCell(formatText(getNameEn(item)), "star-culture-code-cell star-culture-name-en-cell"));
      tr.appendChild(createCell(formatText(getDescription(item)), "star-culture-description-cell"));
      tr.appendChild(createCell(formatAstroNames(item), "star-culture-astro-cell"));
      tr.appendChild(createRegionMarkCell(item, "aynu1"));
      tr.appendChild(createRegionMarkCell(item, "aynu2"));
      tr.appendChild(createRegionMarkCell(item, "aynu3"));
      tr.appendChild(createRegionMarkCell(item, "aynu4"));
      tr.appendChild(createRegionMarkCell(item, "aynu5"));
      tr.appendChild(createCell(formatOtherRegions(item), "star-culture-other-region-cell"));
      tr.appendChild(createChartMarkCell(item));
      fragment.appendChild(tr);
    }

    els.results.appendChild(fragment);
  }

  function render() {
    const rows = filterConstellations().sort(compareRows);
    renderRows(rows);
    updateSortHeaders();
    updateCount(rows.length);
    setHidden(els.tableWrap, rows.length === 0);
    setHidden(els.empty, rows.length !== 0);
  }

  function bindEvents() {
    els.tableHead?.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      const th = button?.closest("th[data-sort-column]");
      if (!th) return;

      const column = th.dataset.sortColumn;
      if (state.sortColumn === column) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortColumn = column;
        state.sortDirection = "asc";
      }
      render();
    });

    els.query?.addEventListener("input", (event) => {
      state.query = event.target.value;
      render();
    });

    for (const input of els.regionInputs || []) {
      input.addEventListener("change", () => {
        state.regions = getSelectedRegions();
        render();
      });
    }

    els.reset?.addEventListener("click", () => {
      state.query = "";
      state.regions = [];
      if (els.query) els.query.value = "";
      for (const input of els.regionInputs || []) input.checked = false;
      render();
      els.query?.focus();
    });
  }

  function getSelectedRegions() {
    return Array.from(els.regionInputs || [])
      .filter((input) => input.checked)
      .map((input) => input.value)
      .filter((value) => STANDARD_AYNU_CODES.includes(value) || value === OTHER_REGION_FILTER);
  }

  function applyInitialFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("key") || params.get("q") || "";
    const regions = (params.get("region") || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => STANDARD_AYNU_CODES.includes(value) || value === OTHER_REGION_FILTER);

    state.query = query;
    state.regions = regions;

    if (els.query) els.query.value = state.query;
    for (const input of els.regionInputs || []) {
      input.checked = state.regions.includes(input.value);
    }
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
    els.regionInputs = document.querySelectorAll('input[name="star-culture-region"]');
    els.reset = getElement("star-culture-reset");
    els.results = getElement("star-culture-results");
    els.tableHead = document.querySelector(".star-culture-table thead");
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
