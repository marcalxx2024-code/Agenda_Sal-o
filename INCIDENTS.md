# Pendencias operacionais

## 2026-09-02 — npm executado no diretorio pai

Uma operacao npm executada em `C:\Users\marca` atualizou a instalacao local de
Supabase desse diretorio para `2.116.0`. Os timestamps, o cache do npm e os
modulos remanescentes indicam que havia uma instalacao anterior de
`supabase@2.109.1`, acompanhada por `jose@6.2.4`, mas o manifesto e o lockfile
anteriores exatos nao foram recuperados.

O log npm da operacao original ja nao estava disponivel. O historico continha
`npm install supabase --save-dev`, mas a ocorrencia preservada estava associada
a uma instalacao de julho; por isso, o comando exato executado em setembro nao
pode ser afirmado apenas a partir desse registro. Pacotes relacionados a HEIC
tambem apareceram no cache global, sem evidencia suficiente para concluir que
pertenciam ao `node_modules` do diretorio pai.

Decisao: nenhuma recuperacao sera feita em `C:\Users\marca` sem uma copia
confiavel do estado anterior. A instalacao atual deve ser preservada e essa
incerteza permanece pendente.

O projeto `agenda-salao` possui `package.json`, `package-lock.json` e
`node_modules` proprios. A resolucao das dependencias foi conferida e aponta
para os modulos locais do projeto, sem depender da instalacao do diretorio pai.
Nenhuma credencial foi registrada neste documento.
