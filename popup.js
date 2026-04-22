const S = { blockingEnabled: "blockingEnabled", lastRebuildStats: "lastRebuildStats" };

const el = (id) => document.getElementById(id);

function formatLine(stats) {
  if (!stats || typeof stats !== "object") {
    return "Ajuste a lista nas opções para ver estatísticas.";
  }
  return `Regras: ${stats.appliedUser} manuais, ${stats.appliedAdult} +18 (máx. total ${stats.cap || 5000}).`;
}

async function refresh() {
  const d = await chrome.storage.local.get([S.blockingEnabled, S.lastRebuildStats]);
  el("blockingEnabled").checked = d[S.blockingEnabled] !== false;
  el("mini").textContent = formatLine(d[S.lastRebuildStats]);
}

el("blockingEnabled").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ [S.blockingEnabled]: e.target.checked });
  await refresh();
});

el("openOptions").addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
});

void refresh();
chrome.storage.onChanged.addListener((c, a) => {
  if (a === "local" && (c[S.blockingEnabled] || c[S.lastRebuildStats])) {
    void refresh();
  }
});
