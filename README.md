# Foco — extensão Chrome (Manifest V3)

Bloqueia **sítios que escolhe manualmente**. Ao abrir (ou embater num iframe) num desses sítios, a extensão mostra o ecrã **Foco** com a mensagem de que o endereço está bloqueado em vez de uma página vazia de “sem ligação”.

## Com utilizar

1. Carregue a pasta do projeto em `chrome://extensions` (Modo de programador → Carregar sem empaquetamento).
2. Clique no botão de extensão: ative o bloqueio, adicione sítio (+) ou abra a **lista completa e definições** para a lista geral, centralizada, com o nome do sítio, **Adicionar** e a lista com **Remover** em cada linha.
3. Limite: **5000** regras (limite de regras dinâmicas do Chrome).

## Privacidade

Só a sua lista fica no armazenamento local da extensão; ninguém envia os domínios a serviços nossos.

## Técnica

- `declarativeNetRequest` com ação `redirect` para a página [blocked.html](blocked.html) (apenas `main_frame` e `sub_frame` para não reencaminhar assets como imagens a torto e a direito).
- A lista é guardada em `chrome.storage.local` e o *service worker* aplica a reconstrução de regras (com fila interna para evitar conflitos de `id`).

## Licença

Use o projeto de acordo com a licença do autor, se a fixar.
