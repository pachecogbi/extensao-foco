/* global chrome */
(() => {
  const KEY = "colorTheme";
  const media = matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";

  function resolvedTheme() {
    return preference === "system" ? (media.matches ? "dark" : "light") : preference;
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const dark = theme === "dark";
      button.textContent = dark ? "☀" : "☾";
      button.title = dark ? "Usar tema claro" : "Usar tema escuro";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(dark));
    });
  }

  async function loadTheme() {
    try {
      const stored = await chrome.storage.local.get(KEY);
      preference = ["light", "dark"].includes(stored[KEY]) ? stored[KEY] : "system";
    } catch {
      preference = "system";
    }
    applyTheme();
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-theme-toggle]");
    if (!button) return;
    preference = resolvedTheme() === "dark" ? "light" : "dark";
    applyTheme();
    try { await chrome.storage.local.set({ [KEY]: preference }); } catch { /* keep the current page themed */ }
  });

  media.addEventListener("change", () => { if (preference === "system") applyTheme(); });
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) {
      preference = ["light", "dark"].includes(changes[KEY].newValue) ? changes[KEY].newValue : "system";
      applyTheme();
    }
  });
  void loadTheme();
})();
