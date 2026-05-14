(() => {
  // ============================================================
  // 共通ヘッダー読み込み
  // ============================================================
  // index.html / notes.html / references.html で同じヘッダーを使い回すため、
  // プレースホルダー要素を partials/site-header.html の内容で置き換える。
  // 静的HTMLのまま共通部品化しているため、fetch が使えない file:// 直開きでは失敗する場合がある。
  const HEADER_PLACEHOLDER_ID = "site-header-include";
  const HEADER_PARTIAL_PATH = "partials/site-header.html";
  let headerResizeObserver = null;
  let lastHeaderHeight = -1;

  function inferCurrentPage() {
    // パス末尾のファイル名を現在ページとして扱う。
    // ルートURLや末尾スラッシュでは index.html 相当としてナビを強調する。
    const last = (window.location.pathname || "").split("/").pop() || "";
    return last || "index.html";
  }

  function setActiveNav() {
    // 共通ヘッダーを挿入したあと、表示中ページのリンクだけ aria-current を付ける。
    // スタイルの強調だけでなく、スクリーンリーダーにも「現在ページ」と伝えるため。
    const nav = document.querySelector(".utility-nav");
    if (!nav) return;

    nav.querySelectorAll('a[aria-current="page"]').forEach((a) => {
      a.removeAttribute("aria-current");
    });

    const current = inferCurrentPage();
    const link =
      nav.querySelector(`a[href="${current}"]`) ||
      (current === "" || current === "/"
        ? nav.querySelector('a[href="index.html"]')
        : null);
    link?.setAttribute("aria-current", "page");
  }

  function updateHeaderHeightVariable({ notifyResize = false } = {}) {
    // ヘッダーはHTML片として後から挿入されるため、実測値をCSS変数へ渡して
    // 星図ページの3カラム領域を「表示領域 - ヘッダー高」に正確に収める。
    const header = document.querySelector(".site-header");
    const height = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
    if (height === lastHeaderHeight) return;
    lastHeaderHeight = height;
    document.documentElement.style.setProperty("--site-header-height", `${height}px`);
    if (notifyResize) {
      window.dispatchEvent(new Event("resize"));
    }
  }

  function observeHeaderHeight() {
    const header = document.querySelector(".site-header");
    if (!header) {
      updateHeaderHeightVariable();
      return;
    }

    headerResizeObserver?.disconnect();
    if (typeof ResizeObserver === "function") {
      headerResizeObserver = new ResizeObserver(() => updateHeaderHeightVariable({ notifyResize: true }));
      headerResizeObserver.observe(header);
    }

    updateHeaderHeightVariable({ notifyResize: true });
  }

  async function loadSiteHeader() {
    // 各ページ側には <div id="site-header-include"></div> だけ置き、
    // ここでHTML片全体に差し替える。outerHTML を使うことで不要なラッパーをDOMに残さない。
    const placeholder = document.getElementById(HEADER_PLACEHOLDER_ID);
    if (!placeholder) return;

    const res = await fetch(HEADER_PARTIAL_PATH, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`Failed to fetch header: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    placeholder.outerHTML = html;

    setActiveNav();
    observeHeaderHeight();
  }

  document.addEventListener("DOMContentLoaded", () => {
    // DOM構築前に差し替えるとプレースホルダーを取得できないため、DOMContentLoaded後に実行する。
    // 失敗時はページ全体を止めず、ヘッダー位置にだけ簡単な原因を表示する。
    loadSiteHeader().catch((err) => {
      console.error(err);
      const placeholder = document.getElementById(HEADER_PLACEHOLDER_ID);
      if (placeholder) {
        placeholder.textContent =
          "ヘッダの読み込みに失敗しました（ローカルファイル直開きだと動かない場合があります）。";
      }
      updateHeaderHeightVariable({ notifyResize: true });
    });
  });

  window.addEventListener("resize", updateHeaderHeightVariable);
})();
