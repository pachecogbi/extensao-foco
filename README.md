<div align="center">

# Foco

**Bloqueio consciente de sites no Google Chrome**  
*lista manual, fricção controlada e, se quiseres, limite de tempo diário por site*

<kbd>Manifest V3</kbd> · <strong>v2.7.0</strong> · <em>Chrome (Chromium)</em>

</div>

---

## O que é o Foco

O **Foco** é uma extensão para o browser que, quando o activas, deixa de mostrar a página de **sites** que colocas na tua **lista pessoal de bloqueio** ou cujo **limite de tempo diário** de uso tiveres atingido. No lugar, aparece um ecrã próprio (o “Foco”) em vez de a página do site carregar normalmente.

Serve para **reduzir distrações** sem listas genéricas na Internet: o que fica afectado é o que **tu** definires (bloqueio completo e/ou minutos de uso por dia e por domínio).

---

## O que a extensão faz

| Aspeto | Descrição |
|--------|------------|
| **Lista manual** | Adicionas **domínios** (nomes de **site**) no popup ou na página de definições. Só o que está na lista é afectado quando o **bloqueio** da extensão está ligado. |
| **Bloqueio na prática** | Páginas nesses domínios (em janela ou iframe) são intercetadas e o Chrome mostra o ecrã **Foco** em substituição. |
| **Bloqueio liga / desliga** | Podes activar ou desactivar a extensão; quando o bloqueio manual está desligado, a lista deixa de aplicar regras, **exceto** sítios que já tenham **atingido o limite de tempo do dia** (vê a linha seguinte). |
| **Limite de tempo por site (cada dia)** | Na página de definições, podes atribuir **X minutos por domínio e por dia** (1 a 24 h). O tempo avança **enquanto tiveres pelo menos uma aba** desse site aberta (fuso do equipamento; subdomínios, como `www`, entram). Ao bateres no tecto, o site passa a ser bloqueio como os outros até **meia-noite** do novo dia, quando o contador recomeça. Não precisas de pôr o site na lista de bloqueio manual. |
| **Tempo de reflexão** | Se quiseres **desligar** a extensão, **tirar um site da lista** de bloqueio ou **desligar o limite de abas**, a acção real só acontece após **um intervalo a contar decrescente** (o “tempo de reflexão”, configurável, por omissão 5 min). Antes de acabar, podes **anular** no mesmo ecrã. |
| **Cada site, o seu contador (remoção da lista)** | A remoção de um **site** da lista de bloqueio pode ser agendada de forma **independente** por domínio, com o mesmo tipo de atraso. |
| **Limite de abas** | Nas **configurações** (ícone de engrenagem) podes limitar o número de abas em **todas** as janelas (2 a 100), com ajuste e opção de desligar (também sujeita ao tempo de reflexão, quando aplicas). |
| **Configurações** | O ecrã de **configurações** permite ajustar os **minutos** do tempo de reflexão, o **limite de abas** e, na página de opções principal, o **limite de tempo** por site — quando as condições o permitirem (sem a extensão a “forçar” a edição enquanto há temporizadores activos, conforme as regras no código). |
| **Limite do Chrome** | Na prática, a combinação de regras de bloqueio manual + sites com tempo esgotado fica abaixo do teto de **cerca de 5000 regras** de rede dinâmicas. |

---

## Como instalar (modo de programador)

1. Clona ou descarrega este repositório para uma pasta no teu computador.
2. Abre o Chrome (ou outro browser baseado em Chromium) e visita:  
   [`chrome://extensions`](chrome://extensions)  
3. **Activa o “Modo de programador”** (canto superior direito).
4. Clica em **“Carregar sem empaquetamento”** (ou *Load unpacked*).
5. Selecciona a **pasta raiz** do projecto (onde está o `manifest.json`, ao lado de `background.js`, `options.html`, etc.).
6. Confirma: a extensão **Foco** deve surgir na lista, com o pin opcional na barra de extensões.

> **Nota:** Se a pasta for movida depois, o browser pode deixar de a encontrar — volta a “Carregar sem empaquetamento” apontando para a nova localização, ou reinstala a partir de um `.zip` com a mesma estrutura.

---

## Utilização rápida

1. Clica no **ícone da Foco** na barra: liga o bloqueio e, se quiseres, adiciona um **site** pelo atalho do popup.
2. Para a lista e **limites de tempo** completos, abre **“Lista completa e definições”** (página de opções).
3. A **engrenagem** (no popup ou nessa página) leva a **configurações** (tempo de reflexão, limite de abas).
4. Para **desligar** o bloqueio geral com reflexão, **remover** domínios da lista com atraso, ou ajustar **minutos de uso** por site, lê a mensagem no ecrã, confere os temporizadores e **anula** se mudares de ideia.

---

## Privacidade

A lista de **sites**, o **limite de tempo** por domínio, o **uso do dia** e o resto das opções vivem em **`chrome.storage.local`**, no teu perfil de browser. A extensão **consulta as abas** (API `chrome.tabs`) só para contabilizar o tempo de uso e o limite de abas, **sempre localmente**. **Nada disso é enviado a um servidor** desta extensão: não há contas nem telemetria forçada; o código é o que vês no projecto.

---

## Resumo técnico

- **Manifest V3** com *service worker* e **Declarative Net Request**: redireccionamento de pedidos (`main_frame` e `sub_frame`) para [blocked.html](blocked.html) incluída na extensão; regras reconstruídas a partir de armazenamento local, com teto e fila de reconstrução no *background*.
- **Alarms** do Chrome: atrasos de desactivação, remoções pendentes, limite de abas e, para limites de **tempo por site**, lembrete de **1 minuto** que soma o uso.
- **Limites de tempo diários** (`siteTimeLimits`, `siteTimeUsage` e ponto de retoma de segmento no armazenamento) com contagem **enquanto houver** tabs HTTP(S) a corresponder ao domínio, reset por **chave de dia** no fuso local, e reunião de domínios bloqueio manual + domínios com tecto de tempo atingido num único `updateDynamicRules`.

---

## Licença

Utiliza o código de acordo com a licença que o autor definir e associar a este repositório.

---

<div align="center"><sub>Foco — foco no que importa, o resto fica fora (quando tu o decidires).</sub></div>
