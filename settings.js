const el = (id) => document.getElementById(id);

function lockText(g) {
  if (g.canEdit) {
    return "Podes alterar o valor. Só se aplica a futuros agendamentos, depois de guardar.";
  }
  if (g.reason === "blocking") {
    return "Enquanto a extensão estiver ativa (bloqueio ligado) não podes editar. Desliga a extensão no ecrã principal, espera de não haver nenhum temporizador a contar, e volte aqui.";
  }
  if (g.reason === "disableTimer") {
    return "Há desativação da extensão a contar. Anula-o ou deixa o tempo acabar, mantém a extensão inactiva, e aí podes editar o tempo de reflexão.";
  }
  if (g.reason === "removalTimers") {
    return "Há remoção(ões) de site a contar. Anula ou aguarda o fim, mantém tudo inactivo e sem temporizadores, e aí podes editar o tempo de reflexão.";
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
    const t = lockText(g);
    lock.textContent = t;
  }
  if (g.canEdit) {
    setLocalStatus("Ajusta os minutos (1–180) e guarda.", true);
  } else {
    setLocalStatus("", true);
  }
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
      setLocalStatus("Tempo de reflexão guardado: " + n + " min. Usado nos próximos cliques a agendar.", true);
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
      c.pendingCooldownMinutes
    ) {
      void refresh();
    }
  }
});

void refresh();
