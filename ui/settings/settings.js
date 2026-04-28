/* global focoCanEditCooldownSetting, focoGetPendingCooldownMinutes, focoSetPendingCooldownMinutes */
/* global chrome */

const el = (id) => document.getElementById(id);

const S = {
  tabLimitEnabled: "tabLimitEnabled",
  tabLimitMax: "tabLimitMax"
};

const K = {
  pendingTabLimitDisableAt: "pendingTabLimitDisableAt"
};

let pendingTabLimitAt = null;
let featureTick = null;

function formatRemainingMs(ms) {
  if (ms < 0) ms = 0;
  const totalS = Math.ceil(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

/**
 * @param {unknown} n
 * @returns {number}
 */
function clampTabMax(n) {
  const x = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(x)) return 8;
  return Math.max(2, Math.min(100, Math.floor(x)));
}

function hasTabLimitPending() {
  return typeof pendingTabLimitAt === "number" && pendingTabLimitAt > Date.now();
}

function updateFeaturePendUis() {
  const boxTab = el("boxPendingTabLimit");
  const cTab = el("tabLimitCountdown");
  if (boxTab) {
    if (hasTabLimitPending()) {
      boxTab.hidden = false;
      if (cTab) cTab.textContent = formatRemainingMs(pendingTabLimitAt - Date.now());
    } else {
      boxTab.hidden = true;
    }
  }
}

function startFeatureTick() {
  if (featureTick) {
    clearInterval(featureTick);
    featureTick = null;
  }
  if (!hasTabLimitPending()) return;
  const step = () => {
    if (!hasTabLimitPending()) {
      if (featureTick) {
        clearInterval(featureTick);
        featureTick = null;
      }
      return;
    }
    updateFeaturePendUis();
  };
  step();
  featureTick = setInterval(step, 1000);
}

function fireReschedule() {
  try {
    chrome.runtime.sendMessage({ type: "reschedulePending" }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // ignore
  }
}

async function loadFeaturePends() {
  const d = await chrome.storage.local.get([
    S.tabLimitEnabled,
    S.tabLimitMax,
    K.pendingTabLimitDisableAt
  ]);
  if (el("tabLimitEnabled")) {
    el("tabLimitEnabled").checked = d[S.tabLimitEnabled] === true;
  }
  if (el("tabLimitMax")) {
    el("tabLimitMax").value = String(clampTabMax(d[S.tabLimitMax] != null ? d[S.tabLimitMax] : 8));
  }
  pendingTabLimitAt = typeof d[K.pendingTabLimitDisableAt] === "number" ? d[K.pendingTabLimitDisableAt] : null;
  updateFeaturePendUis();
  startFeatureTick();
}

function lockText(g) {
  if (g.canEdit) {
    return "Podes alterar o valor. Só se aplica a futuros agendamentos, depois de guardar.";
  }
  if (g.reason === "blocking") {
    return "Enquanto a extensão estiver ativa (bloqueio ligado) não podes editar. Desliga a extensão no ecrã principal, espera de não haver nenhum temporizador a contar, e volte aqui.";
  }
  if (g.reason === "disableTimer") {
    return "Há desativação da extensão a contar. Anula ou deixa o tempo acabar, e a extensão inactiva, para editares o tempo de reflexão.";
  }
  if (g.reason === "removalTimers") {
    return "Há remoção(ões) de site a contar. Anula ou aguarda o fim, sem temporizadores, e aí podes editar.";
  }
  if (g.reason === "tabLimitTimer") {
    return "Há desligação do limite de abas a contar. Anula abaixo ou aguarda o fim, sem outro temporizador, para editar o minutos.";
  }
  return "Não é possível editar o tempo neste momento.";
}

function setLocalStatus(msg, ok) {
  const s = el("setStatus");
  s.textContent = msg || "";
  s.style.color = ok === false ? "var(--err, #f0a0a0)" : "var(--ok, #7dcea0)";
}

async function refresh() {
  const g = await focoCanEditCooldownSetting();
  const cur = await focoGetPendingCooldownMinutes();
  const mins = el("mins");
  const save = el("saveMins");
  if (mins) {
    mins.value = String(cur);
    mins.disabled = !g.canEdit;
  }
  if (save) {
    save.disabled = !g.canEdit;
  }
  const lock = el("lockMsg");
  if (lock) {
    lock.textContent = lockText(g);
  }
  if (g.canEdit) {
    setLocalStatus("Ajusta os minutos (1–180) e guarda.", true);
  } else {
    setLocalStatus("", true);
  }
  await loadFeaturePends();
}

el("formTiming")?.addEventListener("submit", (e) => {
  e.preventDefault();
  void (async () => {
    const g = await focoCanEditCooldownSetting();
    if (!g.canEdit) {
      setLocalStatus("Ainda não podes editar. Vê a mensagem acima.", false);
      await refresh();
      return;
    }
    const raw = (el("mins")?.value || "").trim();
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 180) {
      setLocalStatus("Indica entre 1 e 180 minutos (número inteiro).", false);
      return;
    }
    try {
      await focoSetPendingCooldownMinutes(n);
      setLocalStatus("Guardado: " + n + " min.", true);
    } catch (e) {
      setLocalStatus("Erro: " + (e && e.message), false);
    }
  })();
});

el("tabLimitEnabled")?.addEventListener("change", (e) => {
  const input = e.target;
  if (!input || input.type !== "checkbox") return;
  void (async () => {
    if (!input.checked) {
      if (hasTabLimitPending()) {
        setLocalStatus("Já há desligação a contar. Anula primeiro.", false);
        input.checked = true;
        return;
      }
      try {
        const m = await focoGetPendingCooldownMinutes();
        const end = Date.now() + m * 60 * 1000;
        await chrome.storage.local.set({ [K.pendingTabLimitDisableAt]: end });
        input.checked = true;
        await loadFeaturePends();
        fireReschedule();
      } catch (err) {
        setLocalStatus("Erro: " + (err && err.message), false);
        input.checked = true;
      }
      return;
    }
    try {
      await chrome.storage.local.set({
        [K.pendingTabLimitDisableAt]: null,
        [S.tabLimitEnabled]: true
      });
      input.checked = true;
      await loadFeaturePends();
      fireReschedule();
    } catch (er) {
      setLocalStatus("Erro: " + (er && er.message), false);
    }
  })();
});

el("saveTabMax")?.addEventListener("click", () => {
  void (async () => {
    const raw = (el("tabLimitMax")?.value || "").trim();
    const v = clampTabMax(raw);
    if (el("tabLimitMax")) el("tabLimitMax").value = String(v);
    try {
      await chrome.storage.local.set({ [S.tabLimitMax]: v });
      await loadFeaturePends();
    } catch (e) {
      setLocalStatus("Erro: " + (e && e.message), false);
    }
  })();
});

el("cancelPendingTabLimit")?.addEventListener("click", () => {
  void (async () => {
    try {
      await chrome.storage.local.set({ [K.pendingTabLimitDisableAt]: null });
      await loadFeaturePends();
      fireReschedule();
    } catch (e) {
      setLocalStatus("Erro: " + (e && e.message), false);
    }
  })();
});

chrome.storage.onChanged.addListener((c, a) => {
  if (a === "local") {
    if (
      c.blockingEnabled ||
      c.pendingDisableAt ||
      c.pendingRemovals ||
      c.pendingCooldownMinutes ||
      c.pendingTabLimitDisableAt ||
      c.tabLimitEnabled ||
      c.tabLimitMax
    ) {
      void refresh();
    }
  }
});

void (async () => {
  await refresh();
})();
