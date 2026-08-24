# Foco 3.0

O **Foco** é um assistente local de atenção para navegadores Chromium. Ele combina sessões de foco, bloqueio consciente, proteção opcional contra conteúdo adulto, orçamento diário de sites, limite de abas e métricas de progresso para ajudar a interromper hábitos automáticos de navegação.

Tudo funciona no navegador: sem conta, servidor ou telemetria.

## O que há na versão 3.0

### Sessões de foco integradas

Antes de começar, o usuário registra uma intenção e escolhe uma duração entre 5 e 180 minutos. Durante a sessão:

- a lista de distrações é bloqueada mesmo que o bloqueio contínuo esteja desligado;
- o limite de abas fica temporariamente mais rígido;
- o popup e o painel exibem o tempo restante;
- o modo profundo impede liberações temporárias;
- o resultado é salvo no histórico e nas métricas diárias.

### Painel de atenção

A antiga página de opções virou um painel com três áreas:

- **Hoje:** sessão atual, meta diária, sequência e gráfico dos últimos sete dias;
- **Distrações:** bloqueio contínuo, lista de sites e orçamento diário de tempo;
- **Progresso:** minutos focados, sessões, tentativas bloqueadas, ranking de gatilhos e histórico.

### Bloqueio consciente

A tela de bloqueio agora mostra o site, a intenção da sessão, tempo restante, foco acumulado e número de tentativas naquele dia. Fora do modo profundo, o usuário pode solicitar uma liberação de cinco minutos depois de uma pausa obrigatória de dez segundos.

### Recursos preservados

- bloqueio manual por domínio e subdomínio;
- limite diário de 1 a 1.440 minutos por site;
- tempo de reflexão para remover proteções;
- limite global de 2 a 100 abas;
- cancelamento de ações agendadas;
- armazenamento exclusivamente local.

### Proteção opcional contra conteúdo adulto

Nas configurações, o usuário pode ativar uma proteção independente das sessões de foco. Ela bloqueia uma lista local de sites pornográficos conhecidos e força pesquisa segura no Google, Bing e DuckDuckGo. Depois de ativada, sua desativação exige uma espera fixa de 30 minutos e uma segunda confirmação; durante a espera, a proteção continua ativa e a solicitação pode ser cancelada.

## Instalação

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta que contém `manifest.json`.

Não há dependências ou etapa de compilação. Depois de editar o código, use **Recarregar** no cartão da extensão.

## Uso rápido

1. Abra o popup e escreva o que pretende concluir.
2. Escolha 15, 25, 50 minutos ou uma duração personalizada.
3. Inicie a sessão; as distrações cadastradas e o limite de abas entram em ação juntos.
4. Abra o painel para configurar sites, orçamento diário e meta de foco.
5. Use `Alt+Shift+F` para abrir o painel rapidamente.

## Estrutura

```text
background/background.js   Service worker, regras, alarmes e sessões
lib/foco-core.js           Regras determinísticas compartilhadas e testáveis
lib/foco-cooldown.js       Política do tempo de reflexão
lib/adult-protection.js    Estado e regras da proteção de conteúdo adulto
data/adult-domains.js      Lista interna de domínios adultos conhecidos
ui/popup/                  Controle rápido de sessões
ui/options/                Dashboard principal
ui/blocked/                Intervenção exibida em sites bloqueados
ui/settings/               Preferências globais
tests/                     Testes com o test runner nativo do Node.js
manifest.json              Manifest V3 e pontos de entrada
```

## Desenvolvimento e testes

O projeto usa JavaScript, HTML e CSS sem frameworks.

```bash
node --test tests/*.test.js
```

Também é possível verificar a sintaxe dos scripts com:

```bash
for file in background/background.js lib/*.js ui/*/*.js; do node --check "$file"; done
```

## Privacidade e permissões

Os dados ficam em `chrome.storage.local`. A extensão não envia histórico, domínios, intenções ou métricas para serviços externos. A lista de conteúdo adulto também é empacotada localmente, sem consultas remotas.

| Permissão | Uso |
| --- | --- |
| `declarativeNetRequest` | Aplicar redirecionamentos de bloqueio. |
| `storage` | Persistir configurações, sessões e métricas. |
| `alarms` | Encerrar sessões, contabilizar uso e aplicar ações pendentes. |
| `tabs` | Contar tempo de sites e aplicar limites de abas. |
| `<all_urls>` | Cobrir os domínios escolhidos pelo usuário. |

## Compatibilidade

A atualização preserva as chaves anteriores (`userDomains`, `siteTimeLimits`, `siteTimeUsage`, cooldown e limite de abas). Uma migração aditiva cria apenas os campos novos; nenhuma lista ou configuração antiga é apagada.

Consulte [DOCUMENTACAO.md](DOCUMENTACAO.md) para detalhes de arquitetura, armazenamento e fluxos.

## Licença

Este repositório ainda não possui uma licença definida.
