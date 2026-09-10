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
- `create_appointment_with_services`: RPC transacional para criar um atendimento
  e todos os seus itens, reutilizando os triggers de snapshots e retornos.
- `mark_return_contacted`: RPC idempotente que confirma o contato usando o
  horário do banco sem concluir o retorno.
- `bookings` e `booking_services`: agenda futura e snapshots do plano,
  separados do histórico do atendimento efetivamente realizado.
- `complete_booking`: conclui um agendamento e cria seu atendimento vinculado
  pela mesma regra transacional usada nos atendimentos avulsos.

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
apagadas diretamente pela Data API. A conta do salão pode editar diretamente
apenas o `status`; `contacted_at` e `contact_note` são gravados exclusivamente
pela RPC `mark_return_contacted`.

Atendimentos novos e seus itens são criados exclusivamente pela RPC
`create_appointment_with_services`. A Data API permite consultar ambos e
corrigir somente `performed_on` e `notes` em um atendimento existente. Não há
INSERT ou DELETE direto em `appointments`, nem escrita direta em
`appointment_services`; assim, cliente e serviços ativos, atomicidade e
snapshots históricos são invariantes impostas pelo banco.

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
aplica as migrations. Os testes pgTAP usam somente nomes, telefones, e-mails e
UUIDs fictícios. A suíte comum roda em transação e termina com `rollback`; o
teste de concorrência usa duas conexões independentes e remove explicitamente
todas as suas fixtures.

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

Em 10 de setembro de 2026, com Supabase CLI `2.116.0` e PostgreSQL local 17:

- as sete migrations, incluindo `20260910213811_complete_booking`, foram
  aplicadas do zero por `supabase db reset`;
- `supabase test db --local` aprovou 8 arquivos e 352 testes pgTAP;
- `supabase db lint` não encontrou erros nos schemas `public` e
  `agenda_salao_private`;
- os advisors locais de segurança e desempenho não encontraram problemas;
- `database.types.ts` foi regenerado e inclui o contrato público de
  `complete_booking`.

Os testes exercitam conta autorizada, bloqueio de outra conta autenticada,
bloqueio anônimo, meses de calendário (inclusive fim do mês e ano bissexto),
vários serviços por atendimento, rollback integral após falha em um item,
validação das entradas, horário de contato gerado pelo banco, idempotência do
contato, preservação do status, preservação do intervalo histórico, privilégios
mínimos, bloqueio de escrita direta e proteção dos snapshots.
Os testes da conclusão também cobrem divergência entre serviços planejados e
realizados, idempotência, concorrência real em duas conexões e rollback em
falhas de appointments, appointment_services e returns.

## Operações para o frontend

As operações críticas mantêm wrappers `SECURITY INVOKER` no schema `public`, com
execução concedida somente a `authenticated`. A escrita
é delegada a implementações `SECURITY DEFINER` em `agenda_salao_private`, schema
que não é exposto pela Data API. Essas implementações usam `search_path = ''`,
nomes totalmente qualificados e verificam explicitamente que `auth.uid()`
pertença a `agenda_salao_private.salon_users` antes de usar os privilégios do
proprietário. As tabelas públicas continuam com RLS habilitada.

### Registrar atendimento com serviços

Chame `create_appointment_with_services` por RPC com:

- `p_client_id` (`bigint`): identificador de uma cliente existente e ativa;
- `p_performed_on` (`date`): data em que o atendimento ocorreu;
- `p_service_ids` (`bigint[]`): lista não vazia, sem nulos ou duplicatas, de
  serviços existentes e ativos;
- `p_notes` (`text`, opcional): observações do atendimento.

A função valida todos os dados antes da inserção, bloqueia cliente e serviços
na mesma transação e cria o atendimento e seus itens em uma única chamada. Os
campos históricos não são aceitos como parâmetros: `service_name`, intervalo e
data de retorno continuam sendo produzidos pelos triggers existentes. Qualquer
erro desfaz atendimento, itens e retornos gerados pela chamada.

O resultado contém uma linha com `appointment_id`, `appointment_client_id`,
`appointment_performed_on`, `service_count` e `return_count`. Clientes Supabase
podem usar `.single()` após `.rpc(...)` para consumir essa única linha.

Erros esperados:

- `22023`: parâmetro obrigatório ausente ou lista vazia, com nulo ou duplicata;
- `23503`: cliente ou algum serviço não existe;
- `55000`: cliente ou algum serviço está inativo;
- `42501`: sessão ausente ou conta autenticada sem autorização do salão.

### Confirmar contato de retorno

Chame `mark_return_contacted` com `p_return_id` (`bigint`) e `p_note` (`text`,
opcional). A primeira chamada grava `contacted_at` com `statement_timestamp()`
do PostgreSQL e armazena a nota. Não há parâmetro de horário, portanto o
frontend não pode fornecer um timestamp arbitrário.

A operação não altera `status`: um retorno `pending` continua pendente até uma
ação explícita de conclusão ou cancelamento. Abrir o WhatsApp não deve chamar
essa RPC; ela deve ser executada apenas depois da confirmação humana de que o
contato ocorreu.

Chamadas repetidas são idempotentes: retornam e preservam o primeiro horário, a
primeira nota e o status atual. Um identificador inexistente produz `P0002`;
identificador nulo produz `22023`; falta de autorização produz `42501`.
O resultado contém uma linha com `return_id`, `contacted_at` e `status`.

### Criar e editar agendamentos futuros

`create_booking` recebe `p_client_id` (`bigint`), `p_starts_at` (`timestamptz`),
`p_service_ids` (`bigint[]`), `p_duration_minutes` (`integer`, opcional) e
`p_notes` (`text`, opcional). A operação exige cliente e serviços ativos,
duração estimada configurada em todos os serviços e horário futuro. Sem duração
manual, `ends_at` é calculado pela soma das durações dos serviços; com duração
manual, o valor positivo informado define o intervalo total reservado.

`update_booking` recebe primeiro `p_booking_id` e depois os mesmos dados
editáveis. A edição substitui exatamente o plano de serviços, regenera os
snapshots a partir do catálogo atual, recalcula `ends_at` e só aceita bookings
em `scheduled` ou `confirmed`. O status e `status_updated_at` são preservados.

Ambas retornam uma linha com `booking_id`, `booking_client_id`,
`booking_starts_at`, `booking_ends_at`, `booking_status` e `service_count`. A
exclusion constraint continua sendo a garantia definitiva contra sobreposição;
conflitos são expostos com SQLSTATE `23P01` e a mensagem
`booking time conflicts with another active booking`. Qualquer falha desfaz o
booking e seus snapshots na mesma transação.

### Alterar estado de um agendamento

As RPCs `confirm_booking`, `cancel_booking` e `mark_booking_no_show` recebem
somente `p_booking_id`. Elas bloqueiam a linha durante a transição, usam o
horário do banco e retornam `booking_id`, `booking_status`, `status_updated_at`
e `updated_at`.

- `confirm_booking`: `scheduled` para `confirmed`;
- `cancel_booking`: `scheduled` ou `confirmed` para `cancelled`;
- `mark_booking_no_show`: `scheduled` ou `confirmed` para `no_show`, somente
  quando `starts_at` já foi alcançado.

Repetir a mesma transição é idempotente e preserva os timestamps. Estados
terminais não podem ser convertidos para outro estado. Essas operações não
criam atendimentos realizados nem retornos.

### Concluir um agendamento

`complete_booking` recebe `p_booking_id` (`bigint`), `p_performed_on`
(`date`), `p_service_ids` (`bigint[]`) e `p_notes` (`text`, opcional).
O cliente vem do booking e não pode ser enviado pelo frontend. A data realizada
é independente de `starts_at`, que permanece como histórico do plano.

A lista informada representa os serviços efetivamente realizados e pode ser
diferente do plano. Serviços ativos podem ser adicionados; um serviço inativo
só é aceito se já constar em `booking_services`. A operação cria
`appointments` e `appointment_services` pela mesma implementação interna da
RPC avulsa, permitindo que os triggers existentes produzam snapshots e returns.
Nenhum return é criado diretamente por `complete_booking`.

O resultado contém `booking_id`, `appointment_id`, `booking_status`,
`performed_on` e `service_count`. Bookings `scheduled` ou `confirmed`
podem ser concluídos. Uma repetição sobre um booking `completed` consistente
retorna o vínculo já existente sem criar novos registros; `cancelled` e
`no_show` são rejeitados. O lock `FOR UPDATE` e a unicidade de
`appointments.booking_id` garantem no máximo um atendimento por booking mesmo
com requisições concorrentes.

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
├── INCIDENTS.md
├── database.types.ts
├── package-lock.json
├── package.json
├── README.md
└── supabase/
    ├── config.toml
    ├── migrations/
    │   ├── 20260902201226_initial_backend.sql
    │   ├── 20260903002433_backend_api_operations.sql
    │   └── 20260903155650_harden_business_operations.sql
    └── tests/
        ├── backend_api_operations.test.sql
        ├── business_operation_hardening.test.sql
        └── initial_backend.test.sql
```

## Próxima etapa sugerida

O próximo passo é integrar essas operações ao futuro frontend e definir a
experiência de autenticação da conta do salão. Antes de qualquer publicação,
ainda é necessário confirmar explicitamente qual projeto Supabase remoto
pertence a esta aplicação. As regras financeiras continuam fora deste escopo e
devem ser levantadas antes de qualquer tabela financeira ser criada.
