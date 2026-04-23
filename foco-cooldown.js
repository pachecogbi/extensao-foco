/* global chrome */
const FOCO_COOLDOWN_KEY = "pendingCooldownMinutes";
const FOCO_COOLDOWN_FLOOR = 1;
const FOCO_COOLDOWN_CAP = 180; /* 3 h — ajusta no settings.js a mensagem de ajuda */
const FOCO_DEFAULT_MINUTES = 5;

/**
 * Garante o valor lido; extensões antigas sem a chave usam o padrão (5 min).
 * @returns {Promise<number>} minutos inteiros entre 1 e FOCO_COOLDOWN_CAP
 */
async function focoGetPendingCooldownMinutes() {
  const d = await chrome.storage.local.get(FOCO_COOLDOWN_KEY);
  const v = d[FOCO_COOLDOWN_KEY];
  if (v == null) {
    return FOCO_DEFAULT_MINUTES;
  }
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) {
    return FOCO_DEFAULT_MINUTES;
  }
  return Math.max(FOCO_COOLDOWN_FLOOR, Math.min(FOCO_COOLDOWN_CAP, Math.floor(n)));
}

/** @returns {Promise<number>} duração em milissegundos */
function focoGetPendingCooldownMs() {
  return focoGetPendingCooldownMinutes().then((m) => m * 60 * 1000);
}

/**
 * True se a extensão estiver inativa (bloqueio desligado) e não houver temporizador de desativação nem remoções a correr.
 * Só nesse estado o utilizador pode alterar os minutos de “tempo de reflexão”.
 * @returns {Promise<{ canEdit: boolean, reason: string }>}
 */
async function focoCanEditCooldownSetting() {
  const d = await chrome.storage.local.get([
    "blockingEnabled",
    "pendingDisableAt",
    "pendingRemovals"
  ]);
  const now = Date.now();
  if (d.blockingEnabled !== false) {
    return { canEdit: false, reason: "blocking" };
  }
  if (d.pendingDisableAt && typeof d.pendingDisableAt === "number" && d.pendingDisableAt > now) {
    return { canEdit: false, reason: "disableTimer" };
  }
  const pr = d.pendingRemovals;
  if (pr && typeof pr === "object" && !Array.isArray(pr)) {
    for (const t of Object.values(pr)) {
      const n = typeof t === "number" ? t : Number(t);
      if (Number.isFinite(n) && n > now) {
        return { canEdit: false, reason: "removalTimers" };
      }
    }
  }
  return { canEdit: true, reason: "" };
}

/**
 * @param {number} minutos
 * @returns {Promise<void>}
 */
async function focoSetPendingCooldownMinutes(minutos) {
  const n = typeof minutos === "number" ? minutos : parseInt(String(minutos), 10);
  if (!Number.isFinite(n)) {
    return;
  }
  const clamped = Math.max(FOCO_COOLDOWN_FLOOR, Math.min(FOCO_COOLDOWN_CAP, Math.floor(n)));
  await chrome.storage.local.set({ [FOCO_COOLDOWN_KEY]: clamped });
}
