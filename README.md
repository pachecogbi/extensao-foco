<div align="center">

# 🎯 Foco

**Bloqueio consciente de sites no Google Chrome**  
*Lista manual, fricção controlada e, se quiser, limite de tempo diário por site*

---

✨ <kbd>Manifest V3</kbd> · <strong>v2.7.0</strong> · <em>🌐 Chrome (Chromium)</em> ✨

<br/>

> *« Menos distração. Mais controle. »*

</div>

<br/>

---

## ✨ O que é o Foco

<div align="center">
<img src="https://img.shields.io/badge/Extens%C3%A3o-Local%20%26%20sob%20seu%20controle-5E81AC?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Extensão local" />
</div>

<br/>

O **Foco** é uma extensão para o navegador que, quando você **ativa**, deixa de mostrar a página dos **sites** que coloca na sua **lista pessoal de bloqueio** — ou cujo **limite de tempo diário** de uso você tiver atingido. No lugar, aparece uma tela própria (o *« Foco »*) em vez da página do site carregar normalmente.

| 🎁 Benefício | Descrição |
|:---:|:---|
| 🧠 | Serve para **reduzir distrações** *sem* listas genéricas da internet. |
| 👤 | O que fica **afetado** é o que **você** define: **bloqueio completo** e/ou **minutos de uso** por dia e por domínio. |

---

## 🛡️ O que a extensão faz

| Recurso | Descrição |
|:---:|:---|
| 📝 **Lista manual** | Você adiciona **domínios** (nomes de **site**) no popup ou na página de configurações. Só o que está na lista é **afetado** quando o **bloqueio** da extensão está ligado. |
| 🚧 **Bloqueio na prática** | Páginas nesses domínios (em janela ou *iframe*) são **interceptadas** e o Chrome mostra a tela **Foco** no lugar. |
| 🔛 **Bloqueio liga / desliga** | Você pode ativar ou desativar a extensão; quando o bloqueio manual está desligado, a lista deixa de aplicar regras, **exceto** **sites** que já tenham **atingido o limite de tempo do dia** (veja a linha seguinte). |
| ⏱️ **Limite de tempo por site (cada dia)** | Na página de configurações, você pode definir **X minutos por domínio e por dia** (1 a 24 h). O tempo avança **enquanto houver pelo menos uma aba** desse site aberta (fuso do equipamento; subdomínios, como `www`, entram). Ao **bater no teto**, o site fica **bloqueado** como os outros até **meia-noite** do dia seguinte, quando o contador **recomeça**. *Você não precisa* colocar o site na lista de bloqueio manual. |
| 🧘 **Tempo de reflexão** | Se quiser **desligar** a extensão, **remover um site da lista** de bloqueio ou **desligar o limite de abas**, a ação de fato só acontece após **um intervalo com contagem regressiva** (o *« tempo de reflexão »*, configurável, **5 min** por padrão). Antes de acabar, você pode **desfazer** na mesma tela. |
| 🔢 **Cada site, o seu contador (remoção da lista)** | A remoção de um **site** da lista de bloqueio pode ser agendada de forma **independente** por domínio, com o mesmo tipo de atraso. |
| 📑 **Limite de abas** | Em **configurações** (ícone de engrenagem) você pode limitar o número de abas em **todas** as janelas (2 a 100), com ajuste e opção de desligar (também sujeito ao tempo de reflexão, ao **aplicar**). |
| ⚙️ **Configurações** | A tela de **configurações** permite ajustar os **minutos** do tempo de reflexão, o **limite de abas** e, na página de opções principal, o **limite de tempo** por site — quando as condições permitirem (sem a extensão *« forçar »* a edição enquanto houver temporizadores **ativos**, conforme as regras no código). |
| 📊 **Limite do Chrome** | Na prática, a combinação de regras de bloqueio manual + sites com tempo esgotado fica abaixo do teto de **cerca de 5000 regras** de rede dinâmicas. |

---

## 🚀 Como instalar (modo desenvolvedor)

1. 📥 **Clone** ou **faça o download** deste repositório para uma pasta no seu computador.
2. 🌐 **Abra** o Chrome (ou outro navegador baseado em Chromium) e acesse:  
   [`chrome://extensions`](chrome://extensions)  
3. 🛠️ **Ative** o *« Modo do desenvolvedor »* (canto superior direito).
4. 📂 **Clique** em **« Carregar sem compactação »** (ou *Load unpacked*).
5. 📁 **Selecione** a **pasta raiz** do projeto (onde está o `manifest.json`, com as pastas `background/`, `ui/`, `lib/`, `icons/`, etc.).
6. ✅ **Confirme:** a extensão **Foco** deve surgir na lista, com o *fixar* opcional na barra de extensões.

> **💡 Nota:** Se a pasta for movida depois, o navegador pode deixar de encontrá-la — use de novo *« Carregar sem compactação »* apontando para o novo caminho, ou reinstale a partir de um `.zip` com a mesma estrutura.

### 🗂️ Estrutura do repositório

O código está separado por função, com o `manifest.json` e os ícones na raiz:

| 📂 Local | 📦 Conteúdo |
|:---:|:---|
| **`background/`** | *Service worker* (`background.js`) — regras DNR, alarmes, limite de abas, contagem de tempo por site. |
| **`lib/`** | Código compartilhado (p. ex. `foco-cooldown.js` carregado pelas páginas de UI). |
| **`ui/blocked/`** | Página mostrada ao bloquear um site (`web_accessible_resources`). |
| **`ui/options/`** | Página de opções (lista de bloqueio, limites de tempo). |
| **`ui/popup/`** | *Popup* da ação da extensão. |
| **`ui/settings/`** | Configurações (tempo de reflexão, limite de abas), com estilos compartilhados a partir de `ui/options/`. |
| **`icons/`** | Ícones do *manifest*. |

As rotas no `manifest.json` e o `extensionPath` do DNR usam esses caminhos relativos à raiz da extensão (ex.: `ui/blocked/blocked.html`).

---

## 🎬 Uso rápido

1. **🖱️** **Clique** no **ícone do Foco** na barra: ligue o bloqueio e, se quiser, adicione um **site** pelo atalho do popup.
2. **📋** Para a lista e os **limites de tempo** completos, abra a **página de opções** da extensão (menu do ícone do Foco → opções, ou atalho equivalente no Chrome).
3. **⚙️** A **engrenagem** (no popup ou nessa página) leva a **configurações** (tempo de reflexão, limite de abas).
4. **⏳** Para **desligar** o bloqueio geral com reflexão, **remover** domínios da lista com atraso ou ajustar **minutos de uso** por site, leia a mensagem na tela, **confira** os temporizadores e **cancele** se mudar de ideia.

---

## 🔐 Privacidade

| | |
|:---:|:---|
| 🏠 | A lista de **sites**, o **limite de tempo** por domínio, o **uso do dia** e o restante das opções ficam em **`chrome.storage.local`**, no perfil do navegador. |
| 👀 | A extensão **consulta as abas** (API `chrome.tabs`) só para contar o tempo de uso e o limite de abas, **sempre localmente**. |
| ✈️ | **Nada disso é enviado a um servidor** desta extensão: não há contas nem telemetria forçada; o código é o que você vê no **projeto**. |

---

## 🧩 Resumo técnico

- **📜 Manifest V3** com *service worker* e **Declarative Net Request**: **redirecionamento** de requisições (`main_frame` e `sub_frame`) para [ui/blocked/blocked.html](ui/blocked/blocked.html) incluída na extensão; regras reconstruídas a partir de armazenamento local, com teto e fila de reconstrução no *background*.
- **⏰ Alarms** do Chrome: atrasos de **desativação**, remoções pendentes, limite de abas e, para limites de **tempo por site**, lembrete de **1 minuto** que soma o uso.
- **📅 Limites de tempo diários** (`siteTimeLimits`, `siteTimeUsage` e ponto de retomada de segmento no armazenamento) com contagem **enquanto houver** abas HTTP(S) correspondendo ao domínio, *reset* por **chave de dia** no fuso local, e união de domínios de bloqueio manual + domínios com **teto** de tempo atingido em um único `updateDynamicRules`.

---

## 📄 Licença

Use o código de acordo com a licença que o autor definir e associar a este repositório.

---

<div align="center">

### 🎯 Foco

*Foco no que importa — o resto fica de fora (quando **você** decidir).*

<br/>

<sub>Feito com ☕ e intenção · README com ✨ e capricho</sub>

</div>
