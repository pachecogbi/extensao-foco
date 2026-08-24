const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../lib/foco-core.js");

test("normalizeHost accepts domains and full URLs and rejects malformed values", () => {
  assert.equal(Core.normalizeHost("https://WWW.Example.com/watch?v=1"), "www.example.com");
  assert.equal(Core.normalizeHost("*.youtube.com"), "youtube.com");
  assert.equal(Core.normalizeHost("bad_host"), null);
});

test("hostMatches includes subdomains without matching lookalike domains", () => {
  assert.equal(Core.hostMatches("www.example.com", "example.com"), true);
  assert.equal(Core.hostMatches("example.com.evil.test", "example.com"), false);
});

test("createSession clamps input and normalizeSession detects expiration", () => {
  const session = Core.createSession({ intention: "  Escrever proposta  ", durationMin: 999, sessionTabLimit: 1 }, 1_000);
  assert.equal(session.intention, "Escrever proposta");
  assert.equal(session.durationMin, 180);
  assert.equal(session.sessionTabLimit, 2);
  assert.equal(Core.normalizeSession(session, session.endsAt + 1).expired, true);
});

test("finishSession preserves partial progress and marks early finish abandoned", () => {
  const session = Core.createSession({ durationMin: 25 }, 0);
  const result = Core.finishSession(session, "abandoned", 11 * 60_000);
  assert.equal(result.outcome, "abandoned");
  assert.equal(result.focusedMinutes, 11);
});

test("daily metrics are additive, normalized and retained by date", () => {
  const once = Core.addDailyMetric({}, "2026-08-14", { focusMinutes: 25, sessionsCompleted: 1 });
  const twice = Core.addDailyMetric(once, "2026-08-14", { focusMinutes: 15, blockedAttempts: 2 });
  assert.deepEqual(twice["2026-08-14"], {
    focusMinutes: 40,
    sessionsCompleted: 1,
    sessionsAbandoned: 0,
    blockedAttempts: 2,
    mindfulPauses: 0
  });
});

test("activeAllowances removes expired and invalid entries", () => {
  assert.deepEqual(Core.activeAllowances({ "Example.com": 2_000, invalid: "x", "old.test": 900 }, 1_000), { "example.com": 2_000 });
});

test("streak counts previous goal days while allowing today to be in progress", () => {
  const now = new Date(2026, 7, 14, 10).getTime();
  const stats = {
    "2026-08-11": { focusMinutes: 50 },
    "2026-08-12": { focusMinutes: 60 },
    "2026-08-13": { focusMinutes: 50 },
    "2026-08-14": { focusMinutes: 20 }
  };
  assert.equal(Core.calculateStreak(stats, 50, now), 3);
  stats["2026-08-14"].focusMinutes = 50;
  assert.equal(Core.calculateStreak(stats, 50, now), 4);
});
