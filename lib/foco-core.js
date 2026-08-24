(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FocoCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SESSION_MIN = 5;
  const SESSION_MAX = 180;
  const HISTORY_MAX = 120;
  const STATS_DAYS_MAX = 120;

  function clampInt(value, min, max, fallback) {
    const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }

  function normalizeHost(value) {
    if (!value || typeof value !== "string") return null;
    let text = value.trim().replace(/^\*\.?/, "").replace(/[,;\s].*$/, "").trim();
    if (!text) return null;
    if (text.toLowerCase() === "localhost" || text.includes("/") || text.includes("://")) {
      try {
        text = (text.includes("://") ? new URL(text) : new URL("http://" + text)).hostname;
      } catch {
        return null;
      }
    } else {
      text = text.replace(/^[a-z+.-]+:\/\//i, "").split("/")[0].split(":")[0];
    }
    text = text.toLowerCase();
    if (!text || text.length > 253 || !/^[a-z0-9.-]+$/i.test(text)) return null;
    return text;
  }

  function hostMatches(host, configuredHost) {
    if (!host || !configuredHost) return false;
    const current = String(host).toLowerCase();
    const configured = String(configuredHost).toLowerCase();
    return current === configured || current.endsWith("." + configured);
  }

  function localDayKey(date) {
    const current = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    return current.getFullYear() + "-" + String(current.getMonth() + 1).padStart(2, "0") + "-" + String(current.getDate()).padStart(2, "0");
  }

  function normalizeSession(raw, now) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const startedAt = Number(raw.startedAt);
    const endsAt = Number(raw.endsAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) return null;
    const status = raw.status === "active" ? "active" : "finished";
    const intention = typeof raw.intention === "string" ? raw.intention.trim().slice(0, 140) : "";
    const durationMin = clampInt(raw.durationMin, SESSION_MIN, SESSION_MAX, Math.max(SESSION_MIN, Math.round((endsAt - startedAt) / 60000)));
    return {
      id: typeof raw.id === "string" ? raw.id : String(startedAt),
      intention,
      startedAt,
      endsAt,
      durationMin,
      status,
      deepMode: raw.deepMode !== false,
      sessionTabLimit: clampInt(raw.sessionTabLimit, 2, 30, 6),
      expired: status === "active" && endsAt <= (Number.isFinite(now) ? now : Date.now())
    };
  }

  function createSession(input, now) {
    const startedAt = Number.isFinite(now) ? now : Date.now();
    const durationMin = clampInt(input && input.durationMin, SESSION_MIN, SESSION_MAX, 25);
    const intention = input && typeof input.intention === "string" ? input.intention.trim().slice(0, 140) : "";
    return {
      id: startedAt.toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      intention,
      startedAt,
      endsAt: startedAt + durationMin * 60000,
      durationMin,
      status: "active",
      deepMode: !input || input.deepMode !== false,
      sessionTabLimit: clampInt(input && input.sessionTabLimit, 2, 30, 6)
    };
  }

  function normalizeDailyStats(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const output = {};
    for (const key of Object.keys(raw).sort().slice(-STATS_DAYS_MAX)) {
      const row = raw[key];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !row || typeof row !== "object" || Array.isArray(row)) continue;
      output[key] = {
        focusMinutes: Math.max(0, Number(row.focusMinutes) || 0),
        sessionsCompleted: Math.max(0, Math.floor(Number(row.sessionsCompleted) || 0)),
        sessionsAbandoned: Math.max(0, Math.floor(Number(row.sessionsAbandoned) || 0)),
        blockedAttempts: Math.max(0, Math.floor(Number(row.blockedAttempts) || 0)),
        mindfulPauses: Math.max(0, Math.floor(Number(row.mindfulPauses) || 0))
      };
    }
    return output;
  }

  function addDailyMetric(raw, day, patch) {
    const stats = normalizeDailyStats(raw);
    const current = stats[day] || { focusMinutes: 0, sessionsCompleted: 0, sessionsAbandoned: 0, blockedAttempts: 0, mindfulPauses: 0 };
    for (const key of Object.keys(current)) {
      current[key] = Math.max(0, current[key] + (Number(patch && patch[key]) || 0));
    }
    stats[day] = current;
    const trimmed = {};
    for (const key of Object.keys(stats).sort().slice(-STATS_DAYS_MAX)) trimmed[key] = stats[key];
    return trimmed;
  }

  function finishSession(sessionRaw, outcome, now) {
    const current = normalizeSession(sessionRaw, now);
    if (!current) return null;
    const finishedAt = Math.max(current.startedAt, Number.isFinite(now) ? now : Date.now());
    const completed = outcome === "completed" || finishedAt >= current.endsAt;
    const effectiveEnd = completed ? current.endsAt : Math.min(finishedAt, current.endsAt);
    return {
      id: current.id,
      intention: current.intention,
      startedAt: current.startedAt,
      finishedAt: effectiveEnd,
      plannedMinutes: current.durationMin,
      focusedMinutes: Math.max(0, Math.round((effectiveEnd - current.startedAt) / 60000)),
      outcome: completed ? "completed" : "abandoned",
      deepMode: current.deepMode
    };
  }

  function appendHistory(raw, entry) {
    const list = Array.isArray(raw) ? raw.filter((item) => item && typeof item === "object") : [];
    return [...list, entry].slice(-HISTORY_MAX);
  }

  function activeAllowances(raw, now) {
    const current = Number.isFinite(now) ? now : Date.now();
    const output = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return output;
    for (const key of Object.keys(raw)) {
      const host = normalizeHost(key);
      const until = Number(raw[key]);
      if (host && Number.isFinite(until) && until > current) output[host] = until;
    }
    return output;
  }

  function calculateStreak(statsRaw, goalMinutes, now) {
    const stats = normalizeDailyStats(statsRaw);
    const goal = clampInt(goalMinutes, 5, 600, 50);
    const date = new Date(Number.isFinite(now) ? now : Date.now());
    let streak = 0;
    for (let offset = 0; offset < 366; offset += 1) {
      const cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
      const value = stats[localDayKey(cursor)];
      if ((value && value.focusMinutes >= goal) || (offset === 0 && (!value || value.focusMinutes < goal))) {
        if (value && value.focusMinutes >= goal) streak += 1;
        else if (offset > 0) break;
        continue;
      }
      break;
    }
    return streak;
  }

  return {
    SESSION_MIN,
    SESSION_MAX,
    clampInt,
    normalizeHost,
    hostMatches,
    localDayKey,
    normalizeSession,
    createSession,
    normalizeDailyStats,
    addDailyMetric,
    finishSession,
    appendHistory,
    activeAllowances,
    calculateStreak
  };
});
