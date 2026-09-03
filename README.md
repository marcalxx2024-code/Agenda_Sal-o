# Agenda Salão — backend inicial

Base de banco de dados para um salão pequeno, usando Supabase Auth, PostgreSQL,
Data API e Row Level Security (RLS). Esta etapa não contém frontend nem servidor
intermediário.

Os tipos gerados do schema público ficam em `database.types.ts`. Eles são
produzidos por introspecção do banco local depois das migrations e testes, não
mantidos manualmente como uma segunda definição do schema.

## O que está modelado

- `clients`: cadastro de clientes, telefone, observações e estado ativo.
- `services`: serviços e intervalo padrão de retorno em meses.
- `appointments`: atendimento realizado para uma cliente em uma data.
- `appointment_services`: vários serviços por atendimento. Guarda o nome e o
  intervalo usados naquele momento, portanto mudanças futuras no serviço não
  reescrevem o histórico.
- `returns`: retorno gerado para cada item de atendimento que tenha intervalo.
  Contato, conclusão e cancelamento são estados manuais e independentes.
- `pending_returns`: view segura para consultar retornos ainda pendentes com os
  dados necessários da cliente e do serviço.

O financeiro fica deliberadamente para a próxima etapa. Ainda não há regras de
comissão, parcelamento, despesas ou fechamento de caixa.

## Decisões importantes

### Meses de calendário

`calendar_months_after(data, meses)` usa meses do calendário do PostgreSQL, não
uma multiplicação por 30 dias. Quando o dia não existe no mês de destino, o
PostgreSQL usa o último dia válido: `2025-01-31 + 1 mês = 2025-02-28` e, em ano
bissexto, `2024-01-31 + 1 mês = 2024-02-29`.

O intervalo e a data calculada são gravados em `appointment_services`. Alterar
o intervalo padrão de um serviço afeta somente atendimentos novos. Se a data do
próprio atendimento for corrigida, os retornos daquele atendimento são
recalculados usando o intervalo histórico já gravado.

As datas dos retornos são mantidas por triggers e não podem ser inseridas ou
apagadas diretamente pela Data API. A conta do salão pode editar apenas o
estado e os campos de contato de um retorno.

### Conta única e RLS

Não basta ter login. Todas as tabelas públicas têm RLS e só aceitam uma sessão
cujo `auth.uid()` esteja em `agenda_salao_private.salon_users`. Esse cadastro fica em um
schema não exposto pela Data API. Usuários anônimos e outras contas autenticadas
não recebem acesso aos dados.

O cadastro público por e-mail está desligado no ambiente local. No projeto
hospedado, desative também **Authentication > Providers > Email > Allow new
users to sign up**. Crie a conta compartilhada do salão administrativamente.

Depois de criar a conta, autorize exatamente o seu UUID pelo SQL Editor:

```sql
insert into agenda_salao_private.salon_users (user_id)
values ('00000000-0000-0000-0000-000000000000'); -- substitua pelo UUID real
```

Não use o UUID fictício acima. Confirme a conta em **Authentication > Users** e
execute a instrução uma única vez. Abrir o WhatsApp futuramente não deverá
preencher `contacted_at`; esse campo só deve ser atualizado após confirmação
humana de que o contato foi realmente feito.

## Pré-requisitos

- Docker Desktop instalado e em execução.
- Node.js 20 ou mais recente.
- Dependências locais instaladas com `npm.cmd install` no Windows.

A Supabase CLI está fixada como dependência de desenvolvimento no
`package.json`. Isso evita instalação global e mantém a mesma versão entre
máquinas. Em PowerShell com execução de scripts bloqueada, use `npm.cmd` em vez
de `npm`.

## Uso local

Na raiz deste projeto:

```powershell
npm.cmd install
npm.cmd exec -- supabase --version
npm.cmd run db:start
npm.cmd run db:test
```

Na primeira execução, `db:start` baixa as imagens oficiais, cria a stack local e
aplica as migrations. Os testes pgTAP rodam em transação e usam somente nomes,
telefones, e-mails e UUIDs fictícios; no fim executam `rollback`.

### Reaplicar migrations com segurança

`db reset` descarta alterações e dados do banco local. Antes de usá-lo, confirme
que a stack é a deste diretório (`supabase status` e `supabase/.temp`) e consulte
as contagens ou faça um dump de qualquer dado necessário. Nunca acrescente
`--linked`, `--project-ref` ou `--db-url` ao fluxo local.

Com o destino confirmado e sem dados a preservar:

```powershell
npm.cmd run db:reset -- --local --no-seed
npm.cmd run db:test -- --local
npm.cmd exec -- supabase db lint --local --schema public,agenda_salao_private --level warning --fail-on error
npm.cmd exec -- supabase db advisors --local --type all --level warn --fail-on error
```

Para atualizar os tipos depois que esses comandos passarem:

```powershell
npm.cmd run db:types --silent > database.types.ts
```

O redirecionamento deve conter apenas a saída TypeScript; mensagens de conexão
são escritas separadamente pela CLI.

Para criar uma nova migration, use a CLI para manter o padrão de versão:

```powershell
npm.cmd exec -- supabase migration new nome_descritivo
```

## Validação local executada

Em 2 de setembro de 2026, com Supabase CLI `2.116.0` e PostgreSQL local 17:

- a migration `20260902201226` foi aplicada e listada no banco local;
- `supabase test db --local` aprovou 1 arquivo e 23 testes pgTAP;
- `supabase db lint` não encontrou erros nos schemas `public` e
  `agenda_salao_private`;
- os advisors locais de segurança e desempenho não encontraram problemas;
- `database.types.ts` foi gerado novamente por introspecção do banco aprovado.

Os testes exercitam conta autorizada, bloqueio de outra conta autenticada,
bloqueio anônimo, meses de calendário (inclusive fim do mês e ano bissexto),
vários serviços por atendimento e preservação do intervalo histórico.

## Aplicar em um projeto hospedado

Não associe nem envie migrations até confirmar que o projeto remoto é o destino
correto desta aplicação. Depois da confirmação:

```powershell
supabase login
supabase link --project-ref <PROJECT_REF_CONFIRMADO>
supabase migration list
supabase db push --dry-run
supabase db push
```

Em seguida, crie a conta do salão, desative o cadastro público, autorize o UUID
em `agenda_salao_private.salon_users` e rode os Database Advisors no Dashboard (Security e
Performance). Nunca versione senha, token, chave secreta ou `service_role`.

## Estrutura

```text
agenda-salao/
├── .gitignore
├── database.types.ts
├── package-lock.json
├── package.json
├── README.md
└── supabase/
    ├── config.toml
    ├── migrations/
    │   └── 20260902201226_initial_backend.sql
    └── tests/
        └── initial_backend.test.sql
```

## Próxima etapa sugerida

O próximo passo do backend é definir e testar as operações de cadastro e
consulta que serão consumidas no futuro. Antes de qualquer publicação, ainda é
necessário confirmar explicitamente qual projeto Supabase remoto pertence a
esta aplicação. As regras financeiras devem ser levantadas antes de qualquer
tabela financeira ser criada.
