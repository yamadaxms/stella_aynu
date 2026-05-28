(() => {
  const CONFIG = window.AYNU_EDIT_CONFIG || {};
  const API_BASE_URL = String(CONFIG.apiBaseUrl || "").replace(/\/$/, "");
  const ADMIN_API_PATH = CONFIG.adminApiPath || "/api/admin/tables";
  const ADMIN_OPTIONS_PATH = CONFIG.adminOptionsPath || `${ADMIN_API_PATH}/_options`;
  const AUTH = CONFIG.auth || {};
  const TOKEN_KEY = "aynuEditAuth";
  const PKCE_KEY_PREFIX = "aynuEditPkce:";
  const SEARCH_DEBOUNCE_MS = 250;
  const LIST_SORT_COLLATOR = new Intl.Collator("ja", {
    numeric: true,
    sensitivity: "base",
  });

  const STAR_CULTURE_LINKS = [
    {
      key: "astro",
      label: "星文化天体リンク",
      addLabel: "天体を追加",
      fields: [
        { name: "astro_name", label: "天体名", type: "select", lookup: "astro_name", required: true },
        { name: "memo", label: "メモ", type: "text" },
      ],
    },
    {
      key: "source",
      label: "星文化出典リンク",
      addLabel: "出典を追加",
      fields: [
        { name: "source_name", label: "出典名", type: "select", lookup: "source_name", required: true },
        { name: "page_num", label: "ページ番号", type: "integer" },
        { name: "memo", label: "メモ", type: "text" },
      ],
    },
    {
      key: "tradition",
      label: "星文化伝承リンク",
      addLabel: "伝承を追加",
      fields: [
        { name: "tradition_title", label: "伝承タイトル", type: "select", lookup: "tradition_title", required: true },
        { name: "memo", label: "メモ", type: "text" },
      ],
    },
    {
      key: "tradition_source",
      label: "伝承出典リンク",
      addLabel: "伝承出典を追加",
      fields: [
        { name: "tradition_title", label: "伝承タイトル", type: "select", lookup: "tradition_title", required: true },
        { name: "source_name", label: "出典名", type: "select", lookup: "source_name", required: true },
        { name: "page_num", label: "ページ番号", type: "integer" },
        { name: "memo", label: "メモ", type: "text" },
      ],
    },
    {
      key: "area",
      label: "星文化地域リンク",
      addLabel: "地域を追加",
      fields: [
        { name: "area_name", label: "地域名", type: "select", lookup: "area_name", required: true },
        { name: "memo", label: "メモ", type: "text" },
      ],
    },
    {
      key: "word",
      label: "星文化単語リンク",
      addLabel: "単語を追加",
      fields: [
        { name: "word_order", label: "単語順", type: "integer", required: true },
        { name: "word_ja", label: "単語", type: "select", lookup: "word_ja", required: true },
        { name: "memo", label: "メモ", type: "text" },
      ],
    },
  ];

  const TABLES = [
    {
      name: "star_culture",
      label: "星文化情報",
      primaryKey: "star_culture_id",
      listColumns: ["name_ja", "name_en", "meaning", "is_published"],
      relatedLinks: STAR_CULTURE_LINKS,
      columns: [
        { name: "star_culture_id", label: "星文化ID", type: "integer", autoSequence: true },
        { name: "name_ja", label: "名称", type: "text", required: true, maxLength: 32 },
        { name: "name_en", label: "英字表記", type: "text", maxLength: 64 },
        { name: "meaning", label: "意味", type: "text", maxLength: 64 },
        { name: "original_name_ja", label: "アイヌ語名称", type: "text", required: true, maxLength: 32 },
        { name: "original_name_en", label: "アイヌ語英字表記", type: "text", maxLength: 64 },
        { name: "original_meaning", label: "アイヌ語原義", type: "text", maxLength: 64 },
        { name: "memo", label: "メモ", type: "textarea" },
        { name: "is_published", label: "公開", type: "boolean", required: true, default: false },
        { name: "created_at", label: "作成日時", type: "datetime", readonly: true },
        { name: "updated_at", label: "更新日時", type: "datetime", readonly: true },
      ],
    },
    {
      name: "tradition_list",
      label: "伝承リスト",
      primaryKey: "tradition_title",
      listColumns: ["tradition_title", "tradition_area", "is_published"],
      columns: [
        { name: "tradition_title", label: "伝承タイトル", type: "text", required: true, maxLength: 64 },
        { name: "tradition_content", label: "伝承内容", type: "textarea" },
        { name: "tradition_area", label: "伝承地域", type: "text", maxLength: 16 },
        { name: "memo", label: "メモ", type: "textarea" },
        { name: "is_published", label: "公開", type: "boolean", required: true, default: false },
        { name: "created_at", label: "作成日時", type: "datetime", readonly: true },
        { name: "updated_at", label: "更新日時", type: "datetime", readonly: true },
      ],
    },
    {
      name: "source_list",
      label: "出典リスト",
      primaryKey: "source_name",
      listColumns: ["source_name", "source_cd", "author", "publication_date", "is_published"],
      columns: [
        { name: "source_name", label: "出典名", type: "text", required: true, maxLength: 32 },
        { name: "source_cd", label: "出典区分", type: "select", lookup: "source_cd", required: true, maxLength: 1 },
        { name: "source_detail", label: "出典詳細", type: "textarea" },
        { name: "detail_flg", label: "出典詳細公開", type: "boolean", required: true, default: false },
        { name: "publisher", label: "出版社", type: "text", maxLength: 32 },
        { name: "author", label: "著者/採取者", type: "text", maxLength: 32 },
        { name: "publication_date", label: "発行/採集年月日", type: "date" },
        { name: "publication_area", label: "採集地域", type: "text", maxLength: 16 },
        { name: "url", label: "URL", type: "url" },
        { name: "memo", label: "メモ", type: "textarea" },
        { name: "is_published", label: "公開", type: "boolean", required: true, default: false },
        { name: "created_at", label: "作成日時", type: "datetime", readonly: true },
        { name: "updated_at", label: "更新日時", type: "datetime", readonly: true },
      ],
    },
    {
      name: "area_list",
      label: "地域リスト",
      primaryKey: "area_name",
      listColumns: ["area_name", "memo"],
      columns: [
        { name: "area_name", label: "地域名", type: "text", required: true, maxLength: 32 },
        { name: "memo", label: "メモ", type: "textarea" },
      ],
    },
    {
      name: "astro_master",
      label: "天体マスタ",
      primaryKey: "astro_name",
      listColumns: ["astro_name", "astro_cd", "constellation", "memo"],
      columns: [
        { name: "astro_name", label: "天体名", type: "text", required: true, maxLength: 32 },
        { name: "astro_cd", label: "天体区分", type: "select", lookup: "astro_cd", required: true, maxLength: 1 },
        { name: "constellation", label: "星座", type: "text", required: true, maxLength: 16 },
        { name: "memo", label: "メモ", type: "textarea" },
      ],
    },
    {
      name: "word_master",
      label: "単語マスタ",
      primaryKey: "word_ja",
      listColumns: ["word_ja", "word_en", "word_meaning", "memo"],
      columns: [
        { name: "word_ja", label: "単語（日本語）", type: "text", required: true, maxLength: 32 },
        { name: "word_en", label: "英字表記", type: "text", maxLength: 64 },
        { name: "word_meaning", label: "意味", type: "textarea" },
        { name: "memo", label: "メモ", type: "textarea" },
      ],
    },
  ];

  const state = {
    tableName: TABLES[0].name,
    rows: [],
    selectedPrimaryKey: null,
    originalPrimaryKey: null,
    mode: "idle",
    query: "",
    lookups: {},
    relatedLinks: {},
    loading: false,
    loadRequestId: 0,
  };

  const els = {};
  let searchTimer = 0;

  function getTableDefinition(name = state.tableName) {
    return TABLES.find((table) => table.name === name) || TABLES[0];
  }

  function getColumnDefinition(table, name) {
    return table.columns.find((column) => column.name === name);
  }

  function createEmptyRelatedLinks(table = getTableDefinition()) {
    const links = {};
    (table.relatedLinks || []).forEach((config) => {
      links[config.key] = [];
    });
    return links;
  }

  function normalizeRelatedLinks(table, links) {
    const normalized = createEmptyRelatedLinks(table);
    (table.relatedLinks || []).forEach((config) => {
      normalized[config.key] = Array.isArray(links?.[config.key])
        ? links[config.key].map((row) => ({ ...(row || {}) }))
        : [];
    });
    return normalized;
  }

  function setText(id, value) {
    const el = els[id] || document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setStatus(message, kind = "error") {
    if (!els.statusMessage) return;
    if (!message) {
      els.statusMessage.hidden = true;
      els.statusMessage.textContent = "";
      els.statusMessage.removeAttribute("data-kind");
      return;
    }
    els.statusMessage.hidden = false;
    els.statusMessage.dataset.kind = kind;
    els.statusMessage.textContent = message;
  }

  function setAuthMessage(message) {
    if (els.authMessage) els.authMessage.textContent = message;
  }

  function base64UrlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomString(byteLength = 32) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  }

  async function sha256(value) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  }

  function getAuthConfigReady() {
    return Boolean(AUTH.cognitoDomain && AUTH.clientId && AUTH.redirectUri);
  }

  function normalizeCognitoDomain(domain) {
    return String(domain || "").replace(/\/$/, "");
  }

  function loadStoredSession() {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function storeSession(session) {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session));
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function decodeJwt(token) {
    if (!token || !token.includes(".")) return {};
    try {
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        atob(payload)
          .split("")
          .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
          .join(""),
      );
      return JSON.parse(json);
    } catch (_) {
      return {};
    }
  }

  function getValidSession() {
    const session = loadStoredSession();
    if (!session?.accessToken || !session?.expiresAt) return null;
    if (Date.now() > Number(session.expiresAt) - 30_000) {
      clearSession();
      return null;
    }
    return session;
  }

  async function login() {
    if (!getAuthConfigReady()) {
      setAuthMessage("Cognitoのログイン設定が未入力です。edit/config.js を設定してください。");
      return;
    }

    const stateValue = randomString(24);
    const verifier = randomString(64);
    const challenge = base64UrlEncode(await sha256(verifier));
    sessionStorage.setItem(`${PKCE_KEY_PREFIX}${stateValue}`, verifier);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: AUTH.clientId,
      redirect_uri: AUTH.redirectUri,
      scope: (AUTH.scopes || ["openid", "email", "profile"]).join(" "),
      state: stateValue,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    window.location.assign(`${normalizeCognitoDomain(AUTH.cognitoDomain)}/oauth2/authorize?${params}`);
  }

  async function logout() {
    clearSession();

    if (getAuthConfigReady()) {
      const params = new URLSearchParams({
        client_id: AUTH.clientId,
        logout_uri: AUTH.logoutUri || AUTH.redirectUri,
      });
      window.location.assign(`${normalizeCognitoDomain(AUTH.cognitoDomain)}/logout?${params}`);
      return;
    }

    renderAuthState();
  }

  async function handleAuthCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const stateValue = url.searchParams.get("state");
    if (!code) return;

    if (!getAuthConfigReady()) {
      setAuthMessage("Cognitoのログイン設定が未入力です。");
      return;
    }

    const verifierKey = `${PKCE_KEY_PREFIX}${stateValue}`;
    const verifier = sessionStorage.getItem(verifierKey);
    sessionStorage.removeItem(verifierKey);
    if (!verifier) {
      throw new Error("ログイン状態の検証に失敗しました。もう一度ログインしてください。");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: AUTH.clientId,
      code,
      redirect_uri: AUTH.redirectUri,
      code_verifier: verifier,
    });

    const res = await fetch(`${normalizeCognitoDomain(AUTH.cognitoDomain)}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      throw new Error(`ログイントークンを取得できませんでした (${res.status})`);
    }

    const token = await res.json();
    storeSession({
      accessToken: token.access_token,
      idToken: token.id_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    });

    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState({}, document.title, url.toString());
  }

  function renderAuthState() {
    const session = getValidSession();
    const claims = decodeJwt(session?.idToken || session?.accessToken);
    const userName = claims.email || claims["cognito:username"] || claims.username || "ログイン済み";

    if (session) {
      els.authPanel.hidden = true;
      els.appPanel.hidden = false;
      els.loginButton.hidden = true;
      els.logoutButton.hidden = false;
      els.sessionUser.textContent = userName;
      return true;
    }

    els.authPanel.hidden = false;
    els.appPanel.hidden = true;
    els.loginButton.hidden = false;
    els.logoutButton.hidden = true;
    els.sessionUser.textContent = "未ログイン";

    if (!getAuthConfigReady()) {
      els.loginButton.disabled = true;
      setAuthMessage("Cognitoのログイン設定が未入力です。edit/config.js の cognitoDomain と clientId を設定してください。");
    } else {
      els.loginButton.disabled = false;
      setAuthMessage("ログイン後に編集画面を表示します。");
    }
    return false;
  }

  function buildAdminUrl(tableName, params = {}) {
    const url = new URL(`${API_BASE_URL}${ADMIN_API_PATH}/${encodeURIComponent(tableName)}`, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
    return url;
  }

  function buildAdminOptionsUrl() {
    return new URL(`${API_BASE_URL}${ADMIN_OPTIONS_PATH}`, window.location.origin);
  }

  async function apiRequest(pathOrUrl, options = {}) {
    const session = getValidSession();
    if (!session) {
      renderAuthState();
      throw new Error("ログインが必要です");
    }
    const bearerToken = AUTH.tokenUse === "idToken" ? session.idToken : session.accessToken;
    if (!bearerToken) {
      clearSession();
      renderAuthState();
      throw new Error("認証トークンを取得できませんでした");
    }

    let res;
    try {
      res = await fetch(pathOrUrl, {
        ...options,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${bearerToken}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
        cache: "no-store",
      });
    } catch (err) {
      const url = pathOrUrl?.href || String(pathOrUrl);
      throw new Error(`APIに接続できませんでした。API GatewayのCORS設定、OPTIONSリクエスト、adminルートのデプロイ状態を確認してください。接続先: ${url}`);
    }

    let body = {};
    try {
      body = await res.json();
    } catch (_) {
      body = {};
    }

    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        renderAuthState();
      }
      throw new Error(body?.error || `APIリクエストに失敗しました (${res.status})`);
    }

    return body;
  }

  function renderTableNav() {
    els.tableNav.textContent = "";
    TABLES.forEach((table) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = table.label;
      if (table.name === state.tableName) {
        button.setAttribute("aria-current", "page");
      }
      button.addEventListener("click", () => {
        if (state.tableName === table.name) return;
        state.tableName = table.name;
        state.query = "";
        els.searchInput.value = "";
        clearEditor();
        renderTableNav();
        loadRows();
      });
      els.tableNav.appendChild(button);
    });
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatCellValue(column, value) {
    if (column?.type === "boolean") return value ? "公開" : "非公開";
    if (column?.type === "datetime") return formatDateTime(value);
    if (column?.type === "select") {
      const option = findLookupOption(column, value);
      if (option) return `${option.value}: ${option.label}`;
    }
    if (value === null || value === undefined || value === "") return "-";
    return String(value);
  }

  function getLookupKey(column) {
    return column.lookup || column.name;
  }

  function getLookupOptions(column) {
    return state.lookups[getLookupKey(column)] || [];
  }

  function findLookupOption(column, value) {
    const text = String(value ?? "");
    if (!text) return null;
    return getLookupOptions(column).find((option) => String(option.value) === text) || null;
  }

  async function loadLookupOptions() {
    const data = await apiRequest(buildAdminOptionsUrl());
    state.lookups = data?.options || {};
  }

  function appendCell(rowEl, column, value) {
    const cell = document.createElement("td");
    if (column?.type === "boolean") {
      const badge = document.createElement("span");
      badge.className = value ? "badge" : "badge badge-off";
      badge.textContent = formatCellValue(column, value);
      cell.appendChild(badge);
    } else {
      const text = formatCellValue(column, value);
      cell.textContent = text;
      if (text === "-") cell.className = "cell-muted";
    }
    rowEl.appendChild(cell);
  }

  function getListSortColumns(table) {
    if (table.name === "star_culture") return ["star_culture_id"];
    if (table.name === "astro_master") return ["astro_cd", "astro_name"];
    if (table.name === "source_list") return ["source_cd", "source_name"];
    return [table.primaryKey];
  }

  function compareListRows(table, a, b) {
    for (const columnName of getListSortColumns(table)) {
      const result = LIST_SORT_COLLATOR.compare(String(a?.[columnName] ?? ""), String(b?.[columnName] ?? ""));
      if (result !== 0) return result;
    }
    return 0;
  }

  function renderRows() {
    const table = getTableDefinition();
    const columns = table.listColumns.map((name) => getColumnDefinition(table, name)).filter(Boolean);

    els.dataHead.textContent = "";
    const headRow = document.createElement("tr");
    columns.forEach((column) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = column.label;
      headRow.appendChild(th);
    });
    els.dataHead.appendChild(headRow);

    els.dataBody.textContent = "";
    state.rows.forEach((row) => {
      const rowEl = document.createElement("tr");
      const pk = row[table.primaryKey];
      rowEl.tabIndex = 0;
      rowEl.dataset.pk = pk ?? "";
      if (String(pk) === String(state.selectedPrimaryKey)) {
        rowEl.classList.add("is-selected");
      }
      rowEl.addEventListener("click", () => selectRow(row));
      rowEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectRow(row);
        }
      });
      columns.forEach((column) => appendCell(rowEl, column, row[column.name]));
      els.dataBody.appendChild(rowEl);
    });

    els.emptyMessage.hidden = state.rows.length > 0;
    els.rowCount.textContent = `${state.rows.length}件表示`;
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    els.listLoading.hidden = !isLoading;
    els.reloadButton.disabled = isLoading;
    els.newRowButton.disabled = isLoading;
  }

  async function loadRows() {
    const table = getTableDefinition();
    const requestId = state.loadRequestId + 1;
    state.loadRequestId = requestId;
    setStatus("");
    setLoading(true);
    setText("listHeading", table.label);

    try {
      const data = await apiRequest(
        buildAdminUrl(table.name, {
          q: state.query,
          limit: 500,
          offset: 0,
        }),
      );
      if (requestId !== state.loadRequestId) return;
      state.rows = (Array.isArray(data.rows) ? data.rows : []).slice().sort((a, b) => compareListRows(table, a, b));
      renderRows();

      if (state.selectedPrimaryKey !== null) {
        const selected = state.rows.find((row) => String(row[table.primaryKey]) === String(state.selectedPrimaryKey));
        if (selected) {
          await selectRow(selected, { skipRenderRows: true });
        } else {
          clearEditor();
        }
      }
    } catch (err) {
      if (requestId !== state.loadRequestId) return;
      state.rows = [];
      renderRows();
      setStatus(err.message || String(err));
    } finally {
      if (requestId === state.loadRequestId) setLoading(false);
    }
  }

  function clearEditor() {
    state.selectedPrimaryKey = null;
    state.originalPrimaryKey = null;
    state.mode = "idle";
    state.relatedLinks = {};
    els.editorMode.textContent = "未選択";
    els.editorFields.textContent = "";
    els.saveButton.disabled = true;
    els.deleteButton.disabled = true;
    els.cancelButton.disabled = true;
    renderRows();
  }

  function createField(column, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "editor-field";
    const isPrimaryKeyInEdit = column.name === getTableDefinition().primaryKey && state.mode === "edit";

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = `${column.label}${column.required ? " *" : ""}`;
    label.htmlFor = `field-${column.name}`;
    wrapper.appendChild(label);

    if (column.readonly || isPrimaryKeyInEdit) {
      const readonly = document.createElement("p");
      readonly.className = "readonly-value";
      readonly.textContent = formatCellValue(column, value);
      wrapper.appendChild(readonly);
      return wrapper;
    }

    if (column.type === "boolean") {
      const checkWrap = document.createElement("label");
      checkWrap.className = "checkbox-field";
      const input = document.createElement("input");
      input.id = `field-${column.name}`;
      input.name = column.name;
      input.type = "checkbox";
      input.checked = Boolean(value ?? column.default);
      checkWrap.appendChild(input);
      checkWrap.append(document.createTextNode(column.label));
      wrapper.appendChild(checkWrap);
      return wrapper;
    }

    if (column.type === "select") {
      const select = document.createElement("select");
      const currentValue = String(value ?? "");
      const options = getLookupOptions(column);
      select.id = `field-${column.name}`;
      select.name = column.name;
      select.required = Boolean(column.required);

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "選択してください";
      placeholder.selected = currentValue === "";
      select.appendChild(placeholder);

      options.forEach((option) => {
        const optionEl = document.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = `${option.value}: ${option.label}`;
        optionEl.selected = String(option.value) === currentValue;
        select.appendChild(optionEl);
      });

      if (currentValue && !options.some((option) => String(option.value) === currentValue)) {
        const unknownOption = document.createElement("option");
        unknownOption.value = currentValue;
        unknownOption.textContent = `${currentValue}: マスタ未登録`;
        unknownOption.selected = true;
        select.appendChild(unknownOption);
      }

      wrapper.appendChild(select);
      if (options.length === 0) {
        const help = document.createElement("p");
        help.className = "field-help";
        help.textContent = "コードマスタの選択肢を取得できていません。";
        wrapper.appendChild(help);
      }
      return wrapper;
    }

    const input = column.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    input.id = `field-${column.name}`;
    input.name = column.name;
    input.required = Boolean(column.required);
    if (column.maxLength) input.maxLength = column.maxLength;

    if (input.tagName === "INPUT") {
      input.type = column.type === "date" ? "date" : column.type === "url" ? "url" : column.type === "integer" ? "number" : "text";
      if (column.type === "integer") input.step = "1";
    }

    input.value = value ?? "";
    wrapper.appendChild(input);

    return wrapper;
  }

  function collectEditorRowSnapshot() {
    const table = getTableDefinition();
    const row = {};
    table.columns.forEach((column) => {
      if (column.readonly) return;
      if (state.mode === "edit" && column.name === table.primaryKey) {
        row[column.name] = state.originalPrimaryKey;
        return;
      }
      const input = els.editorForm.elements[column.name];
      if (!input) return;
      row[column.name] = column.type === "boolean" ? input.checked : input.value;
    });
    return row;
  }

  function updateRelatedValue(config, rowIndex, fieldName, value) {
    const rows = state.relatedLinks[config.key] || [];
    if (!rows[rowIndex]) rows[rowIndex] = {};
    rows[rowIndex][fieldName] = value;
    state.relatedLinks[config.key] = rows;
  }

  function createRelatedField(config, rowIndex, field, row) {
    const wrapper = document.createElement("label");
    wrapper.className = "related-field";

    const label = document.createElement("span");
    label.textContent = `${field.label}${field.required ? " *" : ""}`;
    wrapper.appendChild(label);

    const currentValue = row?.[field.name] ?? "";
    let input;
    if (field.type === "select") {
      input = document.createElement("select");
      input.required = Boolean(field.required);

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "選択してください";
      placeholder.selected = String(currentValue) === "";
      input.appendChild(placeholder);

      getLookupOptions(field).forEach((option) => {
        const optionEl = document.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = option.value === option.label ? option.label : `${option.value}: ${option.label}`;
        optionEl.selected = String(option.value) === String(currentValue);
        input.appendChild(optionEl);
      });
    } else {
      input = document.createElement("input");
      input.type = field.type === "integer" ? "number" : "text";
      if (field.type === "integer") input.step = "1";
      input.required = Boolean(field.required);
      input.value = currentValue ?? "";
    }

    input.name = `link-${config.key}-${rowIndex}-${field.name}`;
    input.addEventListener("input", () => updateRelatedValue(config, rowIndex, field.name, input.value));
    input.addEventListener("change", () => updateRelatedValue(config, rowIndex, field.name, input.value));
    wrapper.appendChild(input);
    return wrapper;
  }

  function rerenderEditorWithRelatedChange(mutator) {
    const snapshot = collectEditorRowSnapshot();
    mutator();
    renderEditor(snapshot);
  }

  function createRelatedSection(config) {
    const section = document.createElement("section");
    section.className = "related-section";

    const header = document.createElement("div");
    header.className = "related-header";

    const heading = document.createElement("h3");
    heading.textContent = config.label;
    header.appendChild(heading);

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "button button-muted";
    addButton.textContent = config.addLabel || "追加";
    addButton.addEventListener("click", () => {
      rerenderEditorWithRelatedChange(() => {
        state.relatedLinks[config.key] = [...(state.relatedLinks[config.key] || []), {}];
      });
    });
    header.appendChild(addButton);
    section.appendChild(header);

    const rows = state.relatedLinks[config.key] || [];
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "related-empty";
      empty.textContent = "登録なし";
      section.appendChild(empty);
      return section;
    }

    rows.forEach((row, rowIndex) => {
      const rowEl = document.createElement("div");
      rowEl.className = "related-row";
      config.fields.forEach((field) => {
        rowEl.appendChild(createRelatedField(config, rowIndex, field, row));
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "button button-danger related-delete";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", () => {
        rerenderEditorWithRelatedChange(() => {
          state.relatedLinks[config.key] = (state.relatedLinks[config.key] || []).filter((_, index) => index !== rowIndex);
        });
      });
      rowEl.appendChild(deleteButton);
      section.appendChild(rowEl);
    });

    return section;
  }

  function renderRelatedEditor(table) {
    if (!table.relatedLinks) return;

    const wrapper = document.createElement("div");
    wrapper.className = "related-editor";
    table.relatedLinks.forEach((config) => {
      wrapper.appendChild(createRelatedSection(config));
    });
    els.editorFields.appendChild(wrapper);
  }

  function renderEditor(row = {}) {
    const table = getTableDefinition();
    els.editorFields.textContent = "";
    table.columns.forEach((column) => {
      if (state.mode === "create" && column.autoSequence) return;
      els.editorFields.appendChild(createField(column, row[column.name]));
    });
    renderRelatedEditor(table);

    els.editorMode.textContent = state.mode === "create" ? "新規追加" : "編集中";
    els.saveButton.disabled = false;
    els.deleteButton.disabled = state.mode !== "edit";
    els.cancelButton.disabled = false;
  }

  function startCreate() {
    const table = getTableDefinition();
    state.mode = "create";
    state.selectedPrimaryKey = null;
    state.originalPrimaryKey = null;
    state.relatedLinks = createEmptyRelatedLinks(table);
    const row = {};
    table.columns.forEach((column) => {
      if (column.default !== undefined) row[column.name] = column.default;
    });
    renderEditor(row);
    renderRows();
  }

  async function selectRow(row, { skipRenderRows = false } = {}) {
    const table = getTableDefinition();
    const pk = row[table.primaryKey];
    state.mode = "edit";
    state.selectedPrimaryKey = pk;
    state.originalPrimaryKey = pk;
    state.relatedLinks = normalizeRelatedLinks(table, row.links);
    renderEditor(row);
    if (!skipRenderRows) renderRows();

    if (!table.relatedLinks) return;

    try {
      const data = await apiRequest(buildAdminUrl(table.name, { pk }));
      if (state.tableName !== table.name || String(state.originalPrimaryKey) !== String(pk)) return;
      const detailRow = data.row || row;
      state.relatedLinks = normalizeRelatedLinks(table, detailRow.links);
      renderEditor(detailRow);
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  function collectFormData() {
    const table = getTableDefinition();
    const data = {};
    table.columns.forEach((column) => {
      if (column.readonly) return;
      if (state.mode === "create" && column.autoSequence) return;
      if (state.mode === "edit" && column.name === table.primaryKey) return;
      const input = els.editorForm.elements[column.name];
      if (!input) return;
      data[column.name] = column.type === "boolean" ? input.checked : input.value;
    });
    if (table.relatedLinks) {
      data.links = {};
      table.relatedLinks.forEach((config) => {
        data.links[config.key] = (state.relatedLinks[config.key] || []).map((row) => {
          const item = {};
          config.fields.forEach((field) => {
            item[field.name] = row?.[field.name] ?? "";
          });
          return item;
        });
      });
    }
    return data;
  }

  async function saveForm(event) {
    event.preventDefault();
    if (state.mode !== "create" && state.mode !== "edit") return;

    const table = getTableDefinition();
    const data = collectFormData();
    const isCreate = state.mode === "create";

    setStatus("");
    els.saveButton.disabled = true;

    try {
      const result = isCreate
        ? await apiRequest(buildAdminUrl(table.name), {
            method: "POST",
            body: JSON.stringify(data),
          })
        : await apiRequest(buildAdminUrl(table.name, { pk: state.originalPrimaryKey }), {
            method: "PUT",
            body: JSON.stringify(data),
          });

      const savedRow = result.row;
      state.selectedPrimaryKey = savedRow?.[table.primaryKey] ?? data[table.primaryKey] ?? null;
      state.originalPrimaryKey = state.selectedPrimaryKey;
      state.mode = "edit";
      await loadRows();
      setStatus("保存しました。", "info");
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      els.saveButton.disabled = false;
    }
  }

  async function deleteCurrentRow() {
    if (state.mode !== "edit" || state.originalPrimaryKey === null) return;

    const table = getTableDefinition();
    const ok = window.confirm(`${table.label} の「${state.originalPrimaryKey}」を削除します。`);
    if (!ok) return;

    setStatus("");
    els.deleteButton.disabled = true;

    try {
      await apiRequest(buildAdminUrl(table.name, { pk: state.originalPrimaryKey }), {
        method: "DELETE",
      });
      clearEditor();
      await loadRows();
      setStatus("削除しました。", "info");
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      els.deleteButton.disabled = state.mode !== "edit";
    }
  }

  function runSearch() {
    const nextQuery = els.searchInput.value.trim();
    if (state.query === nextQuery) return;
    state.query = nextQuery;
    clearEditor();
    loadRows();
  }

  function scheduleSearch() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
  }

  function bindElements() {
    Object.assign(els, {
      authPanel: document.getElementById("auth-panel"),
      appPanel: document.getElementById("app-panel"),
      authMessage: document.getElementById("auth-message"),
      sessionUser: document.getElementById("session-user"),
      loginButton: document.getElementById("login-button"),
      logoutButton: document.getElementById("logout-button"),
      tableNav: document.getElementById("table-nav"),
      listHeading: document.getElementById("list-heading"),
      newRowButton: document.getElementById("new-row-button"),
      reloadButton: document.getElementById("reload-button"),
      searchForm: document.getElementById("search-form"),
      searchInput: document.getElementById("search-input"),
      clearSearchButton: document.getElementById("clear-search-button"),
      rowCount: document.getElementById("row-count"),
      listLoading: document.getElementById("list-loading"),
      statusMessage: document.getElementById("status-message"),
      dataHead: document.getElementById("data-head"),
      dataBody: document.getElementById("data-body"),
      emptyMessage: document.getElementById("empty-message"),
      editorMode: document.getElementById("editor-mode"),
      editorForm: document.getElementById("editor-form"),
      editorFields: document.getElementById("editor-fields"),
      saveButton: document.getElementById("save-button"),
      deleteButton: document.getElementById("delete-button"),
      cancelButton: document.getElementById("cancel-button"),
    });
  }

  function bindEvents() {
    els.loginButton.addEventListener("click", login);
    els.logoutButton.addEventListener("click", logout);
    els.newRowButton.addEventListener("click", startCreate);
    els.reloadButton.addEventListener("click", loadRows);
    els.editorForm.addEventListener("submit", saveForm);
    els.deleteButton.addEventListener("click", deleteCurrentRow);
    els.cancelButton.addEventListener("click", clearEditor);

    els.searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      window.clearTimeout(searchTimer);
      runSearch();
    });

    els.searchInput.addEventListener("input", scheduleSearch);

    els.clearSearchButton.addEventListener("click", () => {
      window.clearTimeout(searchTimer);
      if (!els.searchInput.value && !state.query) {
        els.searchInput.focus();
        return;
      }
      els.searchInput.value = "";
      state.query = "";
      clearEditor();
      loadRows();
      els.searchInput.focus();
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindElements();
    bindEvents();
    renderTableNav();

    try {
      await handleAuthCallback();
    } catch (err) {
      setAuthMessage(err.message || String(err));
    }

    if (renderAuthState()) {
      let lookupError = null;
      try {
        await loadLookupOptions();
      } catch (err) {
        lookupError = err;
      }
      await loadRows();
      if (lookupError) {
        setStatus(`コードマスタの読み込みに失敗しました。${lookupError.message || String(lookupError)}`);
      }
    }
  });
})();
