# Documentação técnica — Foco 3.0

## Visão do produto

O Foco evoluiu de bloqueador para um **ritual local de atenção**. O fluxo principal é intencionalmente curto:

1. declarar o que importa agora;
2. iniciar uma sessão;
3. simplificar o ambiente automaticamente;
4. interromper acessos impulsivos com contexto;
5. registrar o resultado e tornar o progresso visível.

Os recursos compartilham a mesma lista de distrações. Assim, o usuário não precisa configurar separadamente sessões, bloqueios e estatísticas.

## Arquitetura

### `background/background.js`

Service worker responsável por:

- reconstruir regras dinâmicas do `declarativeNetRequest`;
- contar uso diário dos sites com orçamento;
- processar cooldowns e alarmes;
- iniciar e finalizar sessões;
- aplicar limite global ou temporário de abas;
- registrar tentativas bloqueadas e liberações conscientes;
- compor bloqueios adultos e regras de SafeSearch quando a proteção estiver ativa;
- migrar armazenamento antigo;
- atualizar o badge durante uma sessão.

As reconstruções DNR usam fila e debounce. Mutações de métricas também são serializadas para reduzir perda de contagens quando várias páginas bloqueadas são abertas simultaneamente.

### `lib/foco-core.js`

Concentra regras puras usadas pelo background e pelas interfaces:

- normalização e comparação de domínios;
- criação, validação e conclusão de sessões;
- chave de dia local;
- atualização e retenção de métricas;
- cálculo de sequência;
- validação de liberações temporárias.

O arquivo expõe `FocoCore` no navegador e `module.exports` no Node.js, permitindo testes sem simular todas as APIs do Chrome.

### Proteção de conteúdo adulto

- `data/adult-domains.js` mantém a lista interna e versionada de domínios explicitamente adultos;
- `lib/adult-protection.js` concentra as transições puras de ativação, espera e confirmação, a comparação de subdomínios e a construção das regras SafeSearch;
- o background persiste o estado, agenda o alarme e inclui as regras no mesmo ciclo de reconstrução DNR já usado pelo projeto.

A lista adulta não é adicionada a `userDomains`. Ela tem prioridade e motivo de bloqueio próprios, continua ativa sem sessão de foco e não é afetada por `temporaryAllowances`.

### Interfaces

- `ui/popup`: início rápido, cronômetro, resumo diário e cadastro do site atual;
- `ui/options`: dashboard com Hoje, Distrações e Progresso;
- `ui/blocked`: intervenção consciente e acesso temporário controlado;
- `ui/settings`: cooldown, proteção de conteúdo adulto e limite global de abas.

## Estado e armazenamento

Todos os campos usam `chrome.storage.local`.

### Campos anteriores preservados

| Chave | Conteúdo |
| --- | --- |
| `blockingEnabled` | Estado do bloqueio contínuo. |
| `userDomains` | Lista de distrações. |
| `siteTimeLimits` | Minutos diários por domínio. |
| `siteTimeUsage` | Uso acumulado por domínio e dia. |
| `siteTimeAccrueSinceByHost` | Início persistido do segmento de contagem. |
| `pendingCooldownMinutes` | Duração do tempo de reflexão. |
| `pendingDisableAt` | Desativação futura do bloqueio. |
| `pendingRemovals` | Remoções futuras da lista. |
| `pendingTimeLimitRemovals` | Remoções futuras de orçamento. |
| `tabLimitEnabled`, `tabLimitMax` | Limite global de abas. |
| `pendingTabLimitDisableAt` | Desativação futura do limite. |

### Novos campos

| Chave | Conteúdo |
| --- | --- |
| `schemaVersion` | Versão da migração local; atualmente `3`. |
| `focusSession` | Sessão ativa ou `null`. |
| `focusHistory` | Até 120 sessões concluídas ou encerradas. |
| `dailyStats` | Até 120 dias de métricas agregadas. |
| `dailyFocusGoalMinutes` | Meta diária, padrão de 50 minutos. |
| `blockedAttemptsByHost` | Ranking por domínio dos últimos 30 dias. |
| `temporaryAllowances` | Liberações conscientes ainda válidas. |
| `adultContentBlockingEnabled` | Ativa a lista adulta e o SafeSearch; padrão `false`. |
| `adultContentDisableRequestedAt` | Instante em que a desativação foi solicitada. |
| `adultContentDisableAvailableAt` | Instante em que a confirmação passa a ser aceita. |

### Formato de sessão

```js
{
  id: "identificador-local",
  intention: "Concluir a proposta",
  startedAt: 1770000000000,
  endsAt: 1770001500000,
  durationMin: 25,
  status: "active",
  deepMode: true,
  sessionTabLimit: 6
}
```

### Métrica diária

```js
{
  "2026-08-14": {
    focusMinutes: 50,
    sessionsCompleted: 2,
    sessionsAbandoned: 0,
    blockedAttempts: 7,
    mindfulPauses: 1
  }
}
```

## Fluxos principais

### Início da sessão

1. Popup ou dashboard envia `startFocusSession`.
2. O background valida duração e limite de abas.
3. A sessão é persistida e recebe um alarme de término.
4. A lista DNR é reconstruída considerando a sessão ativa.
5. O limite efetivo de abas passa a ser o menor entre o global e o da sessão.

Uma sessão ativa faz a lista de distrações valer mesmo com `blockingEnabled: false`.

### Conclusão

Ao disparar o alarme, o background:

1. cria uma entrada de histórico;
2. soma minutos e sessão concluída ao dia de início;
3. limpa a sessão ativa e o badge;
4. restaura as regras e o limite de abas normais.

Encerramentos antecipados preservam os minutos transcorridos e incrementam `sessionsAbandoned`.

### Composição dos bloqueios

A lista efetiva é a união de:

- `userDomains`, quando o bloqueio contínuo ou uma sessão está ativo;
- domínios cujo orçamento diário foi esgotado.

Fora de uma sessão, liberações conscientes ainda válidas são removidas temporariamente dessa união. Durante qualquer sessão, a liberação é recusada; no modo profundo, a própria interface não oferece a ação.

Quando `adultContentBlockingEnabled` está ativo, a reconstrução também adiciona:

- regras de redirecionamento para a página bloqueada para cada domínio de `data/adult-domains.js`;
- regras de transformação de busca para Google (`safe=active`), Bing (`adlt=strict`) e DuckDuckGo (`kp=1`).

Essas regras independem de `blockingEnabled` e de `focusSession`. As regras adultas usam IDs e prioridade separados das regras comuns. Uma liberação consciente nunca remove essas regras, e o próprio handler de `grantMindfulAllowance` rejeita domínios adultos como segunda camada de proteção.

### Página bloqueada

Cada regra inclui o domínio na URL da página interna. Ao carregar, a página envia `recordBlockedAttempt`, mostra contexto local e oferece:

- retorno imediato à página anterior;
- abertura do painel;
- fora do modo profundo, liberação por cinco minutos após dez segundos de reflexão.

Regras adultas acrescentam `reason=adult` ao redirecionamento. Nesse caso, a mesma página mostra uma mensagem específica, não registra a tentativa como distração de foco e não oferece liberação temporária.

### Desativação da proteção adulta

1. A ativação limpa qualquer solicitação antiga e aplica imediatamente bloqueio e SafeSearch.
2. Ao desmarcar a opção, o background grava os instantes de solicitação e disponibilidade, separados por 30 minutos.
3. Um `chrome.alarms` persistente é criado para o instante de disponibilidade.
4. Até esse instante, a proteção permanece integralmente ativa e a interface permite cancelar a solicitação.
5. No fim da espera, o alarme não desliga nada: a interface passa a oferecer **Desativar proteção** e **Manter proteção**.
6. A confirmação é validada novamente no background antes de alterar `adultContentBlockingEnabled` para `false`.

Na inicialização e no reinício do navegador, o estado persistido é normalizado e o alarme futuro é recriado. Se a hora já passou, a confirmação fica disponível, mas a proteção continua ligada.

### Reinício e recuperação

No `onStartup`, `onInstalled` e na inicialização do service worker, o projeto:

- executa migração aditiva;
- aplica ações pendentes vencidas;
- atualiza tempo dos sites;
- recria alarmes;
- conclui sessões vencidas;
- remove liberações expiradas;
- reconstrói regras e reaplica limites de abas.

## Migração e compatibilidade

A migração verifica `schemaVersion`, atualmente `4`. Para instalações antigas, adiciona apenas valores padrão ausentes para meta, histórico, métricas, liberações e proteção adulta. Os formatos anteriores continuam sendo lidos diretamente; não existe conversão destrutiva.

## Testes

Execute:

```bash
node --test tests/*.test.js
```

A suíte cobre normalização, subdomínios, limites de sessão, conclusão antecipada, métricas, expiração de liberações, sequência, integridade do manifesto, transições da proteção adulta e regras SafeSearch.

## Limitações conhecidas

- O tempo de sites é contado enquanto existe uma aba correspondente aberta, não apenas quando ela está visível.
- O histórico é agregado localmente; não existe sincronização entre perfis ou dispositivos.
- Sessões encerradas por desligamento abrupto são concluídas na próxima ativação do service worker quando o horário final já passou.
- A liberação consciente retorna para a raiz HTTPS do domínio, pois o DNR não preserva o caminho original neste fluxo.
- Não há testes end-to-end automatizados dentro de uma instância real do Chrome; a validação automatizada atual cobre regras puras, sintaxe e estrutura do manifesto.
- A lista adulta inicial é deliberadamente limitada e pode não cobrir sites novos, espelhos, conteúdo sexual hospedado em plataformas gerais ou acesso por endereço IP.
- SafeSearch reduz resultados explícitos nos mecanismos cobertos, mas não substitui controles do próprio navegador, DNS ou sistema operacional.

## Próximas evoluções sugeridas

- agendas locais para modos Trabalho e Estudo;
- exportação e importação de dados em JSON;
- pausa e retomada explícita de sessões;
- relatório semanal com horários de maior impulsividade;
- testes end-to-end com uma extensão carregada em Chromium.
