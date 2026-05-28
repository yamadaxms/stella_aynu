(() => {
  const currentPageUrl = window.location.href.split(/[?#]/)[0];

  window.AYNU_EDIT_CONFIG = {
    apiBaseUrl:
      window.AYNU_API_BASE_URL ||
      "https://b43aedz221.execute-api.ap-northeast-1.amazonaws.com",
    adminApiPath: "/api/admin/tables",
    auth: {
      region: "ap-northeast-1",
      cognitoDomain: "",
      clientId: "",
      tokenUse: "accessToken",
      redirectUri: currentPageUrl,
      logoutUri: currentPageUrl,
      scopes: ["openid", "email", "profile"],
    },
  };
})();
