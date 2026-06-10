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

  function getArrayField(item, ...fields) {
    for (const field of fields) {
      const value = item?.[field] ?? item?.star_culture?.[field] ?? item?.starCulture?.[field];
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  function getValue(row, keys) {
    if (row === null || row === undefined) return "";
    if (typeof row !== "object") return row;

    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) {
      if (row[key] !== undefined && row[key] !== null) return row[key];
    }
    return "";
  }

  function normalizeRow(row, firstKey) {
    if (row === null || row === undefined || typeof row === "object") return row || {};
    return { [firstKey]: row };
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

  function createTableCell(row, column) {
    const td = document.createElement("td");
    const value = getValue(row, column.keys);
    const text = formatText(value);

    if (column.type === "url" && String(value ?? "").trim()) {
      const link = document.createElement("a");
      link.className = "star-culture-inline-link";
      link.href = String(value).trim();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = text;
      td.appendChild(link);
    } else {
      td.textContent = text;
    }

    return td;
  }

  function renderRelatedTable(container, rows, columns) {
    if (!container) return;
    container.textContent = "";

    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "star-culture-related-empty";
      empty.textContent = "該当データはありません。";
      container.appendChild(empty);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "star-culture-table-wrap";

    const table = document.createElement("table");
    table.className = "star-culture-related-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const column of columns) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = column.label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    for (const rawRow of rows) {
      const row = normalizeRow(rawRow, columns[0].keys[0]);
      const tr = document.createElement("tr");
      for (const column of columns) tr.appendChild(createTableCell(row, column));
      tbody.appendChild(tr);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  const RELATED_TABLES = [
    {
      key: "astro",
      fields: ["star_astro_link", "star_astro_links", "astro_links", "astroNames"],
      columns: [
        { label: "天体名称", keys: ["astro_name", "astroName", "name"] },
        { label: "所属星座", keys: ["constellation"] },
        { label: "メモ", keys: ["memo"] },
      ],
    },
    {
      key: "source",
      fields: ["star_source_link", "star_source_links", "source_links"],
      columns: [
        { label: "出典名", keys: ["source_name", "sourceName", "name"] },
        { label: "ページ番号", keys: ["page_num", "pageNum"] },
        { label: "出典詳細", keys: ["source_detail", "sourceDetail"] },
        { label: "出版社", keys: ["publisher"] },
        { label: "著者/採取者", keys: ["author"] },
        { label: "発行/採集年月日", keys: ["publication_date", "publicationDate"] },
        { label: "採集地域", keys: ["publication_area", "publicationArea"] },
        { label: "URL", keys: ["url"], type: "url" },
        { label: "メモ", keys: ["memo"] },
      ],
    },
    {
      key: "tradition",
      fields: ["star_tradition_link", "star_tradition_links", "tradition_links"],
      columns: [
        { label: "伝承名", keys: ["tradition_title", "traditionTitle", "title"] },
        { label: "伝承内容", keys: ["tradition_content", "traditionContent", "content"] },
        { label: "伝承地域", keys: ["tradition_area", "traditionArea"] },
        { label: "出典名", keys: ["source_name", "sourceName"] },
        { label: "メモ", keys: ["memo"] },
      ],
    },
    {
      key: "area",
      fields: ["star_area_link", "star_area_links", "area_links", "area_names"],
      columns: [
        { label: "地域名称", keys: ["area_name", "areaName", "name"] },
        { label: "メモ", keys: ["memo"] },
      ],
    },
    {
      key: "word",
      fields: ["star_word_link", "star_word_links", "word_links"],
      columns: [
        { label: "単語", keys: ["word_ja", "wordJa"] },
        { label: "単語（英字）", keys: ["word_en", "wordEn"] },
        { label: "意味", keys: ["word_meaning", "wordMeaning"] },
        { label: "出典名", keys: ["source_name", "sourceName"] },
        { label: "メモ", keys: ["memo"] },
      ],
    },
  ];

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

  function renderRelated(item) {
    for (const config of RELATED_TABLES) {
      const rows = getArrayField(item, ...config.fields);
      renderRelatedTable(els.related?.[config.key], rows, config.columns);
    }
  }

  function renderDetail(item) {
    renderBasic(item);
    renderRelated(item);
    setHidden(els.detail, false);
  }

  function activateTab(tab) {
    if (!tab) return;
    const panelId = tab.getAttribute("aria-controls");

    for (const current of els.tabs || []) {
      const active = current === tab;
      current.setAttribute("aria-selected", active ? "true" : "false");
      current.tabIndex = active ? 0 : -1;
    }

    for (const panel of els.tabPanels || []) {
      panel.hidden = panel.id !== panelId;
    }
  }

  function moveTabFocus(direction) {
    const tabs = els.tabs || [];
    if (!tabs.length) return;

    const currentIndex = Math.max(0, tabs.indexOf(document.activeElement));
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    activateTab(tabs[nextIndex]);
    tabs[nextIndex].focus();
  }

  function bindTabs() {
    for (const tab of els.tabs || []) {
      tab.addEventListener("click", () => activateTab(tab));
      tab.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          moveTabFocus(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          moveTabFocus(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          activateTab(els.tabs[0]);
          els.tabs[0]?.focus();
        } else if (event.key === "End") {
          event.preventDefault();
          const last = els.tabs[els.tabs.length - 1];
          activateTab(last);
          last?.focus();
        }
      });
    }
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
    els.related = {
      astro: getElement("star-culture-astro"),
      source: getElement("star-culture-source"),
      tradition: getElement("star-culture-tradition"),
      area: getElement("star-culture-area"),
      word: getElement("star-culture-word"),
    };
    els.tabs = Array.from(document.querySelectorAll(".star-culture-tab"));
    els.tabPanels = Array.from(document.querySelectorAll(".star-culture-tab-panel"));

    bindTabs();
    loadDetail();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
