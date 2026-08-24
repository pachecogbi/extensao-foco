const test = require("node:test");
const assert = require("node:assert/strict");
const AdultProtection = require("../lib/adult-protection.js");
const adultDomains = require("../data/adult-domains.js");

const START = 1_800_000_000_000;

test("adult protection is disabled by default and activation clears pending state", () => {
  assert.deepEqual(AdultProtection.normalizeState(), {
    enabled: false,
    disableRequestedAt: null,
    disableAvailableAt: null
  });
  assert.deepEqual(AdultProtection.activate(), {
    enabled: true,
    disableRequestedAt: null,
    disableAvailableAt: null
  });
});

test("disable request preserves protection and schedules exactly 30 minutes", () => {
  const result = AdultProtection.requestDisable(AdultProtection.activate(), START);
  assert.equal(result.ok, true);
  assert.equal(result.state.enabled, true);
  assert.equal(result.state.disableRequestedAt, START);
  assert.equal(result.state.disableAvailableAt, START + 30 * 60_000);
});

test("protection cannot be disabled before the wait finishes", () => {
  const requested = AdultProtection.requestDisable(AdultProtection.activate(), START).state;
  assert.equal(AdultProtection.canDisable(requested, START + 30 * 60_000 - 1), false);
  assert.equal(AdultProtection.confirmDisable(requested, START + 30 * 60_000 - 1).reason, "wait-not-finished");
  assert.equal(AdultProtection.confirmDisable(requested, START + 30 * 60_000 - 1).state.enabled, true);
});

test("protection can be disabled only by confirmation after 30 minutes", () => {
  const requested = AdultProtection.requestDisable(AdultProtection.activate(), START).state;
  assert.equal(AdultProtection.canDisable(requested, START + 30 * 60_000), true);
  assert.deepEqual(AdultProtection.confirmDisable(requested, START + 30 * 60_000).state, {
    enabled: false,
    disableRequestedAt: null,
    disableAvailableAt: null
  });
});

test("disable request can be cancelled while keeping protection enabled", () => {
  const requested = AdultProtection.requestDisable(AdultProtection.activate(), START).state;
  assert.deepEqual(AdultProtection.cancelDisable(requested), AdultProtection.activate());
});

test("persisted disable request is recovered after restart", () => {
  const persisted = {
    enabled: true,
    disableRequestedAt: START,
    disableAvailableAt: START + AdultProtection.DISABLE_WAIT_MS
  };
  const recovered = AdultProtection.normalizeState(JSON.parse(JSON.stringify(persisted)));
  assert.deepEqual(recovered, persisted);
  assert.equal(AdultProtection.canDisable(recovered, persisted.disableAvailableAt), true);
});

test("adult domain matching covers subdomains without matching lookalikes", () => {
  const domain = adultDomains.find((item) => item === "example.invalid") || adultDomains[0];
  assert.equal(AdultProtection.isAdultHost("www." + domain, adultDomains), true);
  assert.equal(AdultProtection.isAdultHost(domain + ".example.org", adultDomains), false);
});

test("adult blocking is independent from focus sessions", () => {
  const domain = adultDomains[0];
  assert.equal(AdultProtection.shouldBlockAdult(true, domain, adultDomains), true);
  assert.equal(AdultProtection.shouldBlockAdult(false, domain, adultDomains), false);
});

test("temporary allowances cannot release protected adult domains", () => {
  const domain = adultDomains[0];
  assert.equal(AdultProtection.canGrantTemporaryAllowance(true, "cdn." + domain, adultDomains), false);
  assert.equal(AdultProtection.canGrantTemporaryAllowance(false, "cdn." + domain, adultDomains), true);
  assert.equal(AdultProtection.canGrantTemporaryAllowance(true, "example.org", adultDomains), true);
});

test("SafeSearch rules cover Google, Bing and DuckDuckGo with unique IDs", () => {
  const rules = AdultProtection.createSafeSearchRules(100_000);
  assert.equal(rules.length, 3);
  assert.deepEqual(rules.map((rule) => rule.id), [100_000, 100_001, 100_002]);
  assert.equal(new Set(rules.map((rule) => rule.id)).size, rules.length);
  assert.deepEqual(
    rules.map((rule) => rule.action.redirect.transform.queryTransform.addOrReplaceParams[0]),
    [
      { key: "safe", value: "active" },
      { key: "adlt", value: "strict" },
      { key: "kp", value: "1" }
    ]
  );
  for (const rule of rules) {
    assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
    assert.equal(rule.action.type, "redirect");
  }
  assert.equal(new RegExp(rules[0].condition.regexFilter).test("https://www.google.com/search?q=foco"), true);
  assert.equal(new RegExp(rules[1].condition.regexFilter).test("https://www.bing.com/search?q=foco"), true);
  assert.equal(new RegExp(rules[2].condition.regexFilter).test("https://duckduckgo.com/?q=foco"), true);
  assert.equal(new RegExp(rules[0].condition.regexFilter).test("https://www.google.com/maps"), false);
});

test("SafeSearch query transforms preserve searches and are idempotent", () => {
  const samples = [
    ["https://www.google.com/search?q=foco&safe=off", "safe", "active"],
    ["https://www.bing.com/search?q=foco&form=QBLH", "adlt", "strict"],
    ["https://duckduckgo.com/?q=foco&ia=web", "kp", "1"]
  ];
  for (const [input, key, value] of samples) {
    const apply = (text) => {
      const url = new URL(text);
      url.searchParams.set(key, value);
      return url.toString();
    };
    const once = apply(input);
    assert.equal(new URL(once).searchParams.get("q"), "foco");
    assert.equal(new URL(once).searchParams.get(key), value);
    assert.equal(apply(once), once);
  }
});
