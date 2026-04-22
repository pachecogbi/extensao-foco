# Foco — extensão Google Chrome (Manifest V3)

A extensão **Foco** bloqueia a navegação para os domínios que indicar numa **lista manual** e, se ativar, uma **lista +18** obtida de um ficheiro remoto em **HTTPS** (pode alojar o ficheiro em outro servidor, GitHub, etc.).

## O que a extensão *não* promete

- Não bloqueia “toda a Internet de conteúdo +18” sem listas. A abordagem é: **regras baseadas em domínios** (`declarativeNetRequest`); a cobertura +18 depende da **qualidade e extensão da sua lista** e de um limite no Chrome.
- O Chrome aplica, em conjunto, no máximo **5000 regras dinâmicas** por extensão (e outras regras que possa juntar). A lista **manual** tem **prioridade**: o que faltar fica fora, primeiro na parte +18 (ver mensagens nas opções se houver truncagem).

## Instalação (modo programador)

1. Abra o Chrome e vá a `chrome://extensions`.
2. Ligue o **Modo de programador** (canto superior direito).
3. Clique em **Carregar extensão sem empaquetamento** e escolha a pasta do projeto (onde está o ficheiro `manifest.json`).

## Utilização

1. Clique no ícone **Foco** e confirme que o **Bloqueio** está **ativo** (pode abrir as **Opções** para a lista e o URL +18).
2. **Lista manual**: nas opções, um **domínio por linha**; pode colar `https://…` (só o _hostname_ é usado).
3. **+18 (remoto)**:
   - Ligue a opção correspondente.
   - Defina o **URL HTTPS** de um ficheiro (texto ou JSON — ver formatos abaixo).
   - A lista é atualizada de X em X horas (1 h a 7 d) e pode forçar **“Atualizar lista +18 agora”** nas opções.

## Formatos da lista remota

- **Texto**: um domínio por linha; comentários com `#` (ou início de linha estilo ficheiro `hosts` com `0.0.0.0` / `127.0.0.1`).
- **JSON**: `["a.com", "b.com"]` ou `{ "domains": ["…"] }` (também `hosts` ou `block` com array de strings). Entradas `object` com `domain` são aceites.

Ficheiro de exemplo na pasta: [`example-blocklist.txt`](example-blocklist.txt) (não use como lista real; serve só para testar o *parser* local).

## Privacidade e rede

- A extensão só **descarrega** a lista +18 do **URL que configurou**; não enviamos dados a servidores nossos. Respeite a licença e a legalidade das listas de terceiros.
- A lista fica em **armazenamento local** da extensão (até um teto de entradas em cache para a parte +18, p.ex. 20000, para evitar ficheiros enormes; o bloqueio continua a respeitar o teto de **regras** do Chrome).

## Tecnologias

- [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/)
- `chrome.storage`, `chrome.alarms` e *service worker* `background.js`

## Licença

Use e modifique este projecto de acordo com a licença que o autor fixar. Listas e feeds remotos têm as suas licenças (respeite as fontes que usa).
