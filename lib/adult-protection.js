(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FocoAdultProtection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DISABLE_WAIT_MS = 30 * 60 * 1000;

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeState(raw) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const enabled = source.enabled === true;
    const disableRequestedAt = enabled ? timestamp(source.disableRequestedAt) : null;
    const disableAvailableAt = enabled ? timestamp(source.disableAvailableAt) : null;
    const validRequest = disableRequestedAt !== null && disableAvailableAt !== null && disableAvailableAt >= disableRequestedAt;
    return {
      enabled,
      disableRequestedAt: validRequest ? disableRequestedAt : null,
      disableAvailableAt: validRequest ? disableAvailableAt : null
    };
  }

  function activate() {
    return { enabled: true, disableRequestedAt: null, disableAvailableAt: null };
  }

  function requestDisable(raw, now) {
    const state = normalizeState(raw);
    if (!state.enabled) return { ok: false, reason: "not-enabled", state };
    if (state.disableAvailableAt !== null) return { ok: true, reason: "already-requested", state };
    const requestedAt = Number.isFinite(now) ? now : Date.now();
    return {
      ok: true,
      reason: "requested",
      state: {
        enabled: true,
        disableRequestedAt: requestedAt,
        disableAvailableAt: requestedAt + DISABLE_WAIT_MS
      }
    };
  }

  function canDisable(raw, now) {
    const state = normalizeState(raw);
    const current = Number.isFinite(now) ? now : Date.now();
    return state.enabled && state.disableAvailableAt !== null && current >= state.disableAvailableAt;
  }

  function confirmDisable(raw, now) {
    const state = normalizeState(raw);
    if (!state.enabled) return { ok: false, reason: "not-enabled", state };
    if (!canDisable(state, now)) return { ok: false, reason: "wait-not-finished", state };
    return { ok: true, reason: "disabled", state: normalizeState(null) };
  }

  function cancelDisable(raw) {
    const state = normalizeState(raw);
    return {
      enabled: state.enabled,
      disableRequestedAt: null,
      disableAvailableAt: null
    };
  }

  function isAdultHost(host, domains) {
    if (!host || !Array.isArray(domains)) return false;
    const current = String(host).toLowerCase().replace(/^\.+|\.+$/g, "");
    return domains.some((domain) => {
      const configured = String(domain).toLowerCase();
      return current === configured || current.endsWith("." + configured);
    });
  }

  function shouldBlockAdult(enabled, host, domains) {
    return enabled === true && isAdultHost(host, domains);
  }

  function canGrantTemporaryAllowance(enabled, host, domains) {
    return !shouldBlockAdult(enabled, host, domains);
  }

  function createSafeSearchRules(firstId) {
    let id = Number.isInteger(firstId) && firstId > 0 ? firstId : 1;
    const engines = [
      {
        domains: ["google.com", "google.com.br"],
        regexFilter: "^https?://([^/]+\\.)?google\\.(com|com\\.br)/search([?#]|$)",
        key: "safe",
        value: "active"
      },
      {
        domains: ["bing.com"],
        regexFilter: "^https?://([^/]+\\.)?bing\\.com/search([?#]|$)",
        key: "adlt",
        value: "strict"
      },
      {
        domains: ["duckduckgo.com"],
        regexFilter: "^https?://([^/]+\\.)?duckduckgo\\.com/([?#]|$)",
        key: "kp",
        value: "1"
      }
    ];
    return engines.map((engine) => ({
      id: id++,
      priority: 3,
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [{ key: engine.key, value: engine.value }]
            }
          }
        }
      },
      condition: {
        regexFilter: engine.regexFilter,
        requestDomains: engine.domains,
        resourceTypes: ["main_frame"]
      }
    }));
  }

  return {
    DISABLE_WAIT_MS,
    normalizeState,
    activate,
    requestDisable,
    canDisable,
    confirmDisable,
    cancelDisable,
    isAdultHost,
    shouldBlockAdult,
    canGrantTemporaryAllowance,
    createSafeSearchRules
  };
});
