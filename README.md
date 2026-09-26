# localhub

## Sobre

**localhub** é um hub de ferramentas locais para desenvolvedores: um app de
desktop (Go + Wails + React/TypeScript) para reunir num só lugar as tarefas
repetitivas de manter um ambiente de desenvolvimento local em ordem.

Hoje ele cobre o gerenciamento de portas — lista, em tempo real, todas as
portas TCP/UDP ativas na máquina (porta, protocolo, PID, processo, estado) e
permite encerrar o processo responsável com um clique, sempre com confirmação
antes de agir. Substitui o ritual de `lsof -i` / `netstat` + `kill -9`.

O plano é expandir para outras frentes do dia a dia de desenvolvimento local,
como gerenciamento de containers e imagens Docker.

## Configuração

Você pode configurar o projeto editando o `wails.json`. Mais informações sobre
as configurações do projeto podem ser encontradas aqui:
https://wails.io/docs/reference/project-config

## Live Development

To run in live development mode, run `wails dev` in the project directory. This will run a Vite development
server that will provide very fast hot reload of your frontend changes. If you want to develop in a browser
and have access to your Go methods, there is also a dev server that runs on http://localhost:34115. Connect
to this in your browser, and you can call your Go code from devtools.

## Building

To build a redistributable, production mode package, use `wails build`.
