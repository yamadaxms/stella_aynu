(() => {
  // ============================================================
  // コンテンツ保護（ブラウザUI操作に対する軽い抑止）
  // ============================================================
  // ※静的配信では「完全な抜き取り防止」は不可能です。
  //   ここでは UI 操作（右クリック/ドラッグ/選択/一部ショートカット）を抑止し、
  //   掲載コンテンツの無断保存・複製が禁止されていることを利用者へ即時通知します。
  //   入力フォームやボタンなど、通常操作に必要な要素は除外してUXを壊さないようにしています。

  // ページ全体に保護を適用（必要ならセレクタを絞る）
  const PROTECT_SELECTORS = ["body"];

  const isInProtectedArea = (target) => {
    // イベントの target には HTMLElement 以外に document / window / SVG 要素なども来る。
    // closest() を持たない対象で例外を出さないようにしつつ、ページ全体(body)は保護対象として扱う。
    if (!target) return false;
    if (target === document || target === window) return true;
    if (target === document.documentElement || target === document.body)
      return true;
    if (!target.closest) return false;
    return PROTECT_SELECTORS.some((sel) => !!target.closest(sel));
  };

  // UI 操作に必要な要素は巻き込まない（最低限）
  const isExemptElement = (target) => {
    // 市町村選択、投影法選択、ボタン操作、編集可能領域などは通常のUI操作に必要。
    // ここを保護対象から外すことで、コピー抑止処理がフォーム操作やアクセシビリティを妨げないようにする。
    if (!target || !target.closest) return false;
    return !!target.closest(
      "input, textarea, select, option, button, label, [contenteditable='true']",
    );
  };

  // alert() はUXが悪いので廃止し、簡易トーストで通知（連打防止あり）
  const toast = (() => {
    // alert() はフォーカスを奪って連続操作時の体験が悪いため、画面下部の一時通知にする。
    // CSSファイルへ依存させず、このスクリプトだけで通知UIを完結させるためインラインスタイルを使う。
    let el;
    let lastAt = 0;
    let timer;
    const ensure = () => {
      if (el) return el;
      el = document.createElement("div");
      el.id = "protect-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      // インラインで最小限（CSSファイル改変不要）
      Object.assign(el.style, {
        position: "fixed",
        left: "50%",
        bottom: "16px",
        transform: "translateX(-50%)",
        maxWidth: "min(92vw, 720px)",
        background: "rgba(0,0,0,0.78)",
        color: "#fff",
        padding: "10px 12px",
        borderRadius: "10px",
        fontSize: "14px",
        lineHeight: "1.4",
        zIndex: "99999",
        boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
        opacity: "0",
        pointerEvents: "none",
        transition: "opacity 120ms ease",
      });
      document.body.appendChild(el);
      return el;
    };

    return (message) => {
      const now = Date.now();
      // 連打防止（キー押しっぱなし/連続イベント対策）
      if (now - lastAt < 1200) return;
      lastAt = now;

      const node = ensure();
      node.textContent = message;
      node.style.opacity = "1";
      clearTimeout(timer);
      timer = setTimeout(() => {
        node.style.opacity = "0";
      }, 1600);
    };
  })();

  const preventWithNotice = (e, message) => {
    // preventDefault でブラウザ標準動作を止め、stopPropagation で後続の右クリックメニュー等も抑える。
    // message があるイベントだけトーストを出し、ドラッグや選択開始のような高頻度イベントでは通知を省く。
    e.preventDefault();
    // 一部イベントでは stopPropagation も併用（右クリックメニュー等）
    if (typeof e.stopPropagation === "function") e.stopPropagation();
    if (message) toast(message);
  };

  // 右クリック（コンテキストメニュー）を抑止
  document.addEventListener(
    "contextmenu",
    function (e) {
      if (isExemptElement(e.target)) return;
      if (!isInProtectedArea(e.target)) return;
      preventWithNotice(
        e,
        "当サイト掲載コンテンツの複製・保存（スクリーンショット等を含む）は禁止されています。",
      );
    },
    true,
  );

  // ドラッグ開始を抑止
  document.addEventListener(
    "dragstart",
    function (e) {
      if (isExemptElement(e.target)) return;
      if (!isInProtectedArea(e.target)) return;
      preventWithNotice(e);
    },
    true,
  );

  // 選択開始を抑止（フォーム等は除外）
  document.addEventListener(
    "selectstart",
    function (e) {
      if (isExemptElement(e.target)) return;
      if (!isInProtectedArea(e.target)) return;
      preventWithNotice(e);
    },
    true,
  );

  // 主要ショートカット抑止（完全ではない）
  document.addEventListener(
    "keydown",
    function (e) {
      // 入力欄を巻き込まない（UX/アクセシビリティ配慮）
      const tag =
        e.target && e.target.tagName ? e.target.tagName.toUpperCase() : "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target && e.target.isContentEditable)
      )
        return;

      const key = (e.key || "").toLowerCase();
      const isCtrlOrMeta = e.ctrlKey || e.metaKey; // Windows/Linux: Ctrl, macOS: Cmd
      const isOnProtected =
        isInProtectedArea(e.target) ||
        isInProtectedArea(document.activeElement);

      // ブラウザやOSによって完全には止められないが、一般的な開発者ツール/ソース表示/保存/印刷/コピーを抑止する。
      const isDevtools =
        e.key === "F12" ||
        (isCtrlOrMeta && e.shiftKey && (key === "i" || key === "j" || key === "c"));

      const isViewSource = isCtrlOrMeta && key === "u";
      const isSave = isCtrlOrMeta && key === "s";
      const isCopy = isCtrlOrMeta && key === "c";
      const isPrint = isCtrlOrMeta && key === "p";

      // PrintScreen（OS機能のため抑止できないケースが多い）
      if (e.key === "PrintScreen") {
        preventWithNotice(e, "画面コピーは禁止されています。");
        return;
      }

      // Devtools/ソース表示はページ全体で抑止（効果は限定的）
      if (isDevtools || isViewSource) {
        preventWithNotice(e, "この操作は禁止されています。");
        return;
      }

      // コピー/保存/印刷は抑止（保護領域が body の場合はページ全体が対象）
      if (isOnProtected && (isCopy || isSave || isPrint)) {
        preventWithNotice(e, "この操作は禁止されています。");
      }
    },
    true,
  );
})();
