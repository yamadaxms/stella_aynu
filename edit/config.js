(() => {
  const currentPageUrl = window.location.href.split(/[?#]/)[0];

  window.AYNU_EDIT_CONFIG = {
    apiBaseUrl: window.AYNU_API_BASE_URL || "https://kn7btc4kw2.execute-api.ap-northeast-1.amazonaws.com",
    rdsControlApiBaseUrl: window.AYNU_RDS_CONTROL_API_BASE_URL || window.AYNU_API_BASE_URL || "https://kn7btc4kw2.execute-api.ap-northeast-1.amazonaws.com",
    adminApiPath: "/api/admin/tables",
    adminOptionsPath: "/api/admin/tables/_options",
    adminExportPath: "/api/admin/export-json",
    rdsStatusPath: "/api/admin/rds-status",
    rdsStartPath: "/api/admin/rds-start",
    heartbeatPath: "/api/admin/heartbeat",
    heartbeatIntervalMs: 3 * 60 * 1000,
    auth: {
      region: "ap-northeast-1",
      cognitoDomain: "https://ap-northeast-1trcwtrr0a.auth.ap-northeast-1.amazoncognito.com",
      clientId: "7sp6htb7pr10pbltfsv4giu6ag",
      tokenUse: "idToken",
      redirectUri: currentPageUrl,
      logoutUri: currentPageUrl,
      scopes: ["openid", "email", "profile"],
    },
  };
})();
