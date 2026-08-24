# Projeto Foco

O **Foco** é uma extensão local para navegadores Chromium que ajuda a criar um ambiente de atenção. Ela reúne sessões temporizadas, bloqueio de distrações, orçamento diário por site, limite de abas, métricas e uma proteção opcional contra conteúdo adulto.

## Funcionamento

O usuário pode iniciar uma sessão com uma intenção e duração. Durante esse período, os domínios cadastrados como distrações são bloqueados e o limite de abas pode ficar mais rígido. Fora das sessões, o bloqueio contínuo e os orçamentos diários continuam disponíveis.

A proteção de conteúdo adulto é independente desse fluxo. Quando ativada, ela bloqueia domínios pornográficos conhecidos e força SafeSearch no Google, Bing e DuckDuckGo. Sua desativação exige 30 minutos de espera e uma confirmação posterior; fechar o navegador não elimina a espera.

## Estrutura

```text
background/background.js   Service worker, regras DNR, alarmes e persistência
data/adult-domains.js       Lista local de domínios adultos conhecidos
lib/foco-core.js           Regras puras de sessões, domínios e métricas
lib/foco-cooldown.js       Tempo de reflexão das proteções gerais
lib/adult-protection.js    Estado e regras da proteção adulta
ui/popup/                  Controle rápido das sessões
ui/options/                Painel de atenção e distrações
ui/settings/               Preferências e proteção de conteúdo
ui/blocked/                Página compartilhada de bloqueio
tests/                     Testes executados pelo Node.js
manifest.json              Configuração Manifest V3
```

## Princípios técnicos

- JavaScript, HTML e CSS sem frameworks ou build;
- armazenamento exclusivo em `chrome.storage.local`;
- bloqueios e SafeSearch aplicados por `declarativeNetRequest`;
- tarefas temporais persistidas e recuperadas com `chrome.alarms`;
- funções determinísticas em `lib/` para permitir testes sem simular o Chrome;
- nenhuma conta, API externa, telemetria ou banco remoto.

## Executando

Carregue a raiz do repositório em `chrome://extensions` usando **Carregar sem compactação**. Após modificar um arquivo, recarregue a extensão nessa mesma tela.

Para executar a suíte:

```bash
node --test tests/*.test.js
```

Para verificar a sintaxe:

```bash
for file in background/background.js data/*.js lib/*.js ui/*/*.js; do
  node --check "$file"
done
```

Consulte [`README.md`](README.md) para instalação e uso, e [`DOCUMENTACAO.md`](DOCUMENTACAO.md) para os formatos de estado e fluxos internos.
