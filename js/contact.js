(() => {
  // Base64は暗号化ではなく、HTMLを単純に検索する収集処理への軽い抑止。
  // ブラウザでJavaScriptを実行する収集処理まで防ぐものではない。
  document.querySelectorAll("[data-contact-email]").forEach((element) => {
    const encodedEmail = element.getAttribute("data-contact-email");
    if (!encodedEmail) return;

    // リンク化せずに表示し、既存の選択・コピー抑止をそのまま適用する。
    element.textContent = atob(encodedEmail);
    element.removeAttribute("data-contact-email");
  });
})();
