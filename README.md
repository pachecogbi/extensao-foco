<div align="center">

# Foco

**Bloqueio consciente de sites no Google Chrome**  
*a tua lista, a tua decisão, com fricção controlada*

<kbd>Manifest V3</kbd> · <strong>v2.2.0</strong> · <em>Chrome (Chromium)</em>

</div>

---

## O que é o Foco

O **Foco** é uma extensão para o browser que deixa de mostrar a página de um **site** quando o marcas na tua **lista pessoal de bloqueio**. No lugar, aparece um ecrã próprio (o “Foco”) a indicar que aquele endereço está bloqueado, em vez de deixar o **site** carregar à vontade.

Isto é útil quando queres **reduzir distrações** (redes sociais, notícias, serviços) sem depender de listas genéricas na Internet: o que fica fechado é o que **tu** adicionas.

---

## O que a extensão faz

| Aspeto | Descrição |
|--------|------------|
| **Lista manual** | Adicionas **domínios** (nomes de **site**) no popup ou na página de definições. Só o que está na lista é afectado. |
| **Bloqueio na prática** | Páginas nesses domínios (em janela ou iframe) são intercetadas e o Chrome mostra o ecrã **Foco** em substituição. |
| **Bloqueio liga / desliga** | Podes activar ou desactivar a extensão; quando está desligada, as regras de bloqueio deixam de se aplicar. |
| **Tempo de reflexão** | Se quiseres **desligar** a extensão ou **tirar um site da lista**, a acção real só acontece após **um intervalo a contar decrescente** (o “tempo de reflexão”, configurável, por omissão 5 min). Antes de acabar, podes **anular** no mesmo ecrã. |
| **Cada site, o seu contador** | A remoção de um **site** da lista pode ser agendada de forma **independente** por domínio, com o mesmo tipo de atraso. |
| **Mais definições** | Um botão de **engrenagem** abre o ecrã de **configurações**, onde podes ajustar, entre outras opções (no futuro), o **duração em minutos** do tempo de reflexão — só quando a extensão estiver inactiva e nenhum temporizador estiver a correr. |
| **Limite do Chrome** | Só podes ter até cerca de **5000** entradas na prática, por causa do teto de **regras de rede** dinâmicas do browser. |

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

1. Clica no **ícone da Foco** na barra: liga o bloqueio e, se quiseres, adiciona um **site** pelo **+**.
2. Para a lista alargada, escolhe **“Lista completa e definições”** (abre a página de opções).
3. A **engrenagem** (no popup ou nessa página) leva a **configurações**, p.ex. a alterar o tempo de reflexão quando as condições o permitirem.
4. Para **desligar** tudo com reflexão, ou **remover** domínios com atraso, lê a mensagem no ecrã, observa o temporizador e **anula** se mudares de ideia.

---

## Privacidade

A lista de **sites** e as opções vivem em **`chrome.storage.local`**, no teu perfil de browser. **Nada disso é enviado a um servidor** desta extensão: não há contas nem telemetria forçada; o código é o que vês no projecto.

---

## Resumo técnico

- **Manifest V3** com *service worker* e **Declarative NetRequest**: redireccionamento de pedidos (tipicamente `main_frame` e `sub_frame`) para a página [blocked.html](blocked.html) incluída na extensão.
- **Alarms** do Chrome para cumprir os atrasos de desativação e de remoção.
- Tudo ajustado a partir do armazenamento local, com fila de reconstrução de regras no *background* para respeitar limites e evitar conflitos.

---

## Licença

Utiliza o código de acordo com a licença que o autor definir e associar a este repositório.

---

<div align="center"><sub>Foco — foco no que importa, o resto fica fora (quando tu o decidires).</sub></div>
