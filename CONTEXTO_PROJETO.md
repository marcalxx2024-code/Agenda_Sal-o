# Relatório técnico do projeto Agenda Salão

Data da análise: 16 de setembro de 2026.

A análise indica um **MVP parcialmente funcional, com banco e regras de negócio mais completos do que a interface**. Login, clientes, serviços e operações principais de agendamento já possuem integração real com Supabase. Conclusão de atendimentos, histórico e retornos ainda precisam de interface.

**Durante a análise, nenhum arquivo foi alterado, nenhuma dependência foi instalada e nenhuma operação de escrita no banco foi executada.** O Git permaneceu sem alterações. Este documento foi salvo posteriormente, a pedido do usuário, como único arquivo novo.

Neste relatório, “implementado” significa identificado no código. O funcionamento completo contra um banco em execução não foi validado nesta análise.

O relatório abaixo preserva todas as 16 seções da resposta original. Os caminhos foram convertidos em links relativos para facilitar a leitura no repositório. Saídas brutas de ferramentas não fazem parte do relatório; valores de variáveis de ambiente e segredos não são reproduzidos.

## 1. VISÃO GERAL DO PROJETO

O objetivo aparente é organizar a rotina interna do salão **Monica Lugo Alisamentos**, seguindo este fluxo:

**Cliente → agendamento → atendimento realizado → serviços realizados → previsão de retorno → novo agendamento.**

Há uma separação importante e adequada entre:

- **`bookings`**: o que está planejado na agenda;
- **`appointments`**: o atendimento efetivamente realizado;
- **`returns`**: o acompanhamento de retornos sugeridos após os serviços.

**Já implementado e integrado no código:**

- Login por e-mail e senha.
- Verificação de autorização da conta do salão.
- Proteção das rotas internas.
- Cadastro, consulta, edição, inativação e reativação de clientes.
- Cadastro, consulta, edição, inativação e reativação de serviços.
- Listagem de agendamentos.
- Criação e edição de agendamentos com vários serviços.
- Cálculo de duração e duração manual.
- Bloqueio de sobreposição no banco.
- Confirmação, cancelamento e registro de não comparecimento.
- Tratamento de carregamento, falhas e listas vazias.

**Implementado apenas no backend:**

- Registro de atendimento avulso.
- Conclusão de agendamento com criação do atendimento.
- Histórico de serviços realizados.
- Geração de retornos.
- Registro de contato de retorno.
- Consulta de retornos pendentes.

**Incompleto ou ausente:**

- Dashboard com dados reais.
- Interface de retornos.
- Interface de conclusão e histórico dos atendimentos.
- Profissionais.
- Horários de trabalho, intervalos, folgas e bloqueios.
- Permissões por função.
- Calendário por dia/semana e filtros da agenda.
- Paginação das consultas.
- Recuperação de senha na interface.
- Deploy reproduzível e configuração de produção.

**Estágio:** desenvolvimento intermediário de um sistema interno para **uma agenda compartilhada**, ainda sem fechar o ciclo operacional completo pela interface.

Os READMEs estão desatualizados: afirmam que o frontend não existe ou que clientes, serviços e agenda ainda não acessam dados reais. O código atual contradiz essas descrições.

## 2. TECNOLOGIAS UTILIZADAS

Fontes: [package.json](package.json), [frontend/package.json](frontend/package.json), lockfile do frontend e [supabase/config.toml](supabase/config.toml).

| Categoria | Tecnologia identificada |
|---|---|
| Linguagem frontend | TypeScript **6.0.3**, TSX |
| Linguagem backend | SQL e PL/pgSQL |
| Frontend | React **19.3.0**, React DOM **19.3.0** |
| Rotas | React Router DOM **7.18.3** |
| Backend | Supabase: Auth, Data API e funções PostgreSQL |
| Banco | PostgreSQL **17** configurado para o ambiente local |
| Cliente de API | `@supabase/supabase-js` **2.116.0** |
| ORM | Não há Prisma, Drizzle ou outro ORM |
| UI | Componentes próprios, CSS e HTML nativo |
| Autenticação | Supabase Auth |
| Gerenciador de pacotes | npm, com lockfiles separados na raiz e no frontend |
| Build | Vite **8.3.0**, plugin React **6.1.1** |
| Lint | ESLint **10.10.0**, typescript-eslint **8.70.0** |
| Regras React | eslint-plugin-react-hooks **7.1.1**, react-refresh **0.5.6** |
| CLI backend | Supabase CLI **2.116.0** |
| Testes de banco | pgTAP; teste de concorrência com `dblink` |
| Ambiente local observado | Node **24.18.1**, npm **11.16.0** |
| Calendário | Nenhuma biblioteca; agenda implementada como lista |
| Datas | `Date` e `Intl.DateTimeFormat` nativos |
| Estado | Hooks React e Context para autenticação |
| APIs externas | Supabase; nenhuma integração de WhatsApp, pagamentos ou calendário externo encontrada |
| Hospedagem | Nenhuma configuração versionada de deploy identificada |

Há configuração para executar Supabase localmente com Docker. **Não foi possível determinar** se existe uma aplicação publicada ou quais migrations estão aplicadas em um projeto remoto.

## 3. ESTRUTURA DO PROJETO

```text
agenda-salao/
├── README.md
├── INCIDENTS.md
├── package.json
├── package-lock.json
├── database.types.ts
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── README.md
│   ├── .env.example
│   ├── index.html
│   ├── vite.config.ts
│   ├── eslint.config.js
│   ├── tsconfig*.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── AppShell.tsx
│       │   ├── RouteGuards.tsx
│       │   ├── SessionLoader.tsx
│       │   ├── NavIcon.tsx
│       │   ├── BookingDialog.tsx
│       │   └── BookingConfirmDialog.tsx
│       ├── hooks/
│       │   ├── AuthProvider.tsx
│       │   ├── auth-context.ts
│       │   └── useAuth.ts
│       ├── data/
│       │   ├── clients.ts
│       │   ├── services.ts
│       │   └── bookings.ts
│       ├── lib/supabase.ts
│       ├── types/database.ts
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── DashboardPage.tsx
│       │   ├── AgendaPage.tsx
│       │   ├── ClientsPage.tsx
│       │   ├── ServicesPage.tsx
│       │   └── PlaceholderPage.tsx
│       └── styles/global.css
└── supabase/
    ├── config.toml
    ├── migrations/       # 8 migrations
    └── tests/            # 9 arquivos SQL
```

Funções principais:

- **`database.types.ts`**: contrato TypeScript gerado do schema público.
- **`frontend/src/types/database.ts`**: reexporta os tipos da raiz; não mantém outro schema.
- **`data/`**: acesso ao Supabase e contratos de resultado/erro.
- **`pages/`**: telas e parte significativa dos formulários.
- **`components/`**: navegação, proteção de acesso e diálogos da agenda.
- **`hooks/`**: sessão e autorização.
- **`migrations/`**: fonte das tabelas, permissões, triggers e operações transacionais.
- **`tests/`**: verificações das regras e segurança do banco.
- **`INCIDENTS.md`**: registra um incidente anterior de instalação npm no diretório pai; não representa uma funcionalidade da aplicação.

## 4. TELAS E FUNCIONALIDADES JÁ EXISTENTES

Rotas definidas em [App.tsx](frontend/src/App.tsx).

| Rota/tela | Estado | O que existe |
|---|---|---|
| `/login` | Implementada e integrada | E-mail/senha, mensagens de erro e redirecionamento |
| `/` | Apenas visual | Cards com `—`, textos ilustrativos e descrição do fluxo |
| `/agenda` | Parcialmente pronta, integrada | Listagem, criação, edição, confirmação, cancelamento e não comparecimento |
| `/clientes` | Cadastro básico implementado | Busca por nome/telefone, criar, editar, inativar e reativar |
| `/servicos` | Cadastro básico implementado | Busca, criar, editar, duração, retorno sugerido, inativar e reativar |
| `/retornos` | Placeholder | Apenas explicação de funcionalidade futura |
| Acesso não autorizado | Implementado | Conta autenticada sem autorização recebe bloqueio e opção de sair |
| Falha de autorização | Implementado | Mensagem de erro e tentativa de nova verificação |
| Rota desconhecida | Implementado | Redireciona para `/` |

**Não existem telas** de profissionais, horários de trabalho, bloqueios, configurações, relatórios, financeiro, histórico de atendimentos, cadastro público ou recuperação de senha.

Clientes e serviços não têm exclusão pela interface; utilizam inativação.

## 5. FLUXO DE AGENDAMENTO

Fontes principais: [BookingDialog.tsx](frontend/src/components/BookingDialog.tsx), [bookings.ts](frontend/src/data/bookings.ts) e [migration de operações da agenda](supabase/migrations/20260910211802_add_booking_operations.sql).

**Criação**

1. A pessoa abre `/agenda` e seleciona “Novo agendamento”.
2. O formulário consulta clientes e serviços no banco.
3. Seleciona uma cliente ativa.
4. Informa data e horário de início.
5. Seleciona um ou mais serviços ativos com duração configurada.
6. Opcionalmente informa duração total manual e observações.
7. O frontend converte data/hora para ISO e chama `create_booking`.
8. O banco valida, cria o agendamento e grava seus serviços na mesma transação.
9. A tela recarrega a listagem.

**Dados exigidos**

| Dado | Regra |
|---|---|
| Cliente | Existente e ativo |
| Serviços | Lista não vazia, sem duplicatas, existentes e ativos |
| Duração dos serviços | Obrigatória para agendar, mesmo havendo duração manual |
| Início | Deve estar no futuro segundo o banco |
| Duração manual | Opcional; inteiro positivo |
| Observações | Opcionais |
| Profissional | Não existe no modelo |

**Duração**

Sem duração manual:

`ends_at = starts_at + soma das durações dos serviços`

Com duração manual:

`ends_at = starts_at + duração manual`

Cada item de `booking_services` guarda uma cópia do nome e da duração do serviço naquele momento.

Não existem intervalos entre serviços, distribuição por profissional ou fases paralelas de execução.

**Conflitos**

O banco impede sobreposição entre agendamentos `scheduled` e `confirmed` por uma **exclusion constraint GiST**.

O intervalo é `[início, fim)`: um agendamento pode começar exatamente quando outro termina.

A proteção é **global para o salão**. Dois profissionais não poderiam atender simultaneamente usando o modelo atual.

O erro de conflito é `23P01`, convertido pelo frontend em mensagem compreensível.

**Edição**

É permitida para `scheduled` e `confirmed`.

Pode alterar cliente, início, serviços, duração e observações. A operação:

- bloqueia a linha durante a alteração;
- exige novamente início futuro;
- exige cliente e serviços ativos;
- substitui os itens planejados;
- refaz os snapshots com o catálogo atual;
- recalcula o término;
- preserva o status.

Consequência: editar somente observações também passa por todas essas regras e pode recalcular a duração.

**Status e transições**

| Operação | Transição |
|---|---|
| Criar | → `scheduled` |
| Confirmar | `scheduled` → `confirmed` |
| Cancelar | `scheduled` ou `confirmed` → `cancelled` |
| Não compareceu | `scheduled` ou `confirmed` → `no_show` |
| Concluir | `scheduled` ou `confirmed` → `completed`, somente via backend atualmente |

Não comparecimento exige que o início já tenha chegado, segundo o relógio do banco.

Confirmação, cancelamento e não comparecimento são idempotentes: repetir o mesmo comando preserva o resultado e os timestamps.

Não há reabertura de estados terminais.

**Conclusão e histórico**

`complete_booking` já está implementada no banco, mas não é chamada pelo frontend.

Ela:

- usa a cliente do agendamento;
- recebe a data efetiva e os serviços realmente realizados;
- permite serviços diferentes do plano;
- aceita serviço inativo somente se ele já estava no planejamento;
- cria o atendimento e seus itens;
- gera retornos pelos triggers existentes;
- marca o agendamento como concluído;
- impede dois atendimentos para o mesmo agendamento.

Há histórico de dados planejados e realizados, mas **não há trilha completa de todas as edições e transições**, nem tela para consultar o histórico de atendimentos.

**Confirmação e observações**

A confirmação é manual e interna. Não envia mensagem para cliente.

Existem observações separadas para cliente, agendamento, atendimento realizado e contato de retorno. Não existe campo próprio de motivo do cancelamento.

## 6. BANCO DE DADOS

O modelo abaixo resulta das **oito migrations em conjunto**, não apenas da migration inicial.

Fontes: [migration inicial](supabase/migrations/20260902201226_initial_backend.sql), [estrutura de agendamentos](supabase/migrations/20260910203936_add_booking_structure.sql) e [database.types.ts](database.types.ts).

Nas tabelas públicas, `id` é `bigint`, chave primária e `generated always as identity`. Campos indicados como opcionais aceitam `NULL`.

**`clients` — clientes**

| Campo | Tipo/restrição |
|---|---|
| `id` | bigint, PK |
| `name` | text, obrigatório, 2–150 caracteres após trim |
| `phone` | text, obrigatório, 8–30 caracteres após trim |
| `notes` | text, opcional |
| `active` | boolean, padrão `true` |
| `created_at` | timestamptz, padrão `now()` |
| `updated_at` | timestamptz, atualizado por trigger |

Não há unicidade de telefone nem validação de conteúdo numérico.

**`services` — catálogo**

| Campo | Tipo/restrição |
|---|---|
| `id` | bigint, PK |
| `name` | text, obrigatório, 2–120 caracteres |
| `suggested_return_months` | smallint, opcional, 1–120 |
| `estimated_duration_minutes` | smallint, opcional, positivo |
| `active` | boolean, padrão `true` |
| `created_at` | timestamptz |
| `updated_at` | timestamptz, atualizado por trigger |

Índice único em `lower(name)`. Duração máxima representável pelo tipo: 32.767 minutos.

Não há preço, categoria ou vínculo com profissionais.

**`bookings` — planejamento da agenda**

| Campo | Tipo/restrição |
|---|---|
| `id` | bigint, PK |
| `client_id` | bigint, FK obrigatória → `clients.id`, DELETE RESTRICT |
| `starts_at` | timestamptz, obrigatório |
| `ends_at` | timestamptz, obrigatório, maior que início |
| `status` | text, padrão `scheduled`, limitado por CHECK |
| `notes` | text, opcional |
| `status_updated_at` | timestamptz |
| `created_at` | timestamptz |
| `updated_at` | timestamptz |

Status: `scheduled`, `confirmed`, `completed`, `cancelled`, `no_show`.

Índices por `starts_at`, `client_id` e exclusão GiST de sobreposição para estados ativos.

**`booking_services` — serviços planejados**

| Campo | Tipo/restrição |
|---|---|
| `id` | bigint, PK |
| `booking_id` | bigint, FK → `bookings.id`, DELETE RESTRICT |
| `service_id` | bigint, FK → `services.id`, DELETE RESTRICT |
| `service_name` | text, snapshot obrigatório |
| `estimated_duration_minutes` | smallint positivo, snapshot obrigatório |
| `created_at` | timestamptz |

Unicidade de `(booking_id, service_id)`. Índice adicional em `service_id`.

**`appointments` — atendimentos realizados**

| Campo | Tipo/restrição |
|---|---|
| `id` | bigint, PK |
| `client_id` | bigint, FK → `clients.id`, DELETE RESTRICT |
| `booking_id` | bigint, opcional, FK → `bookings.id`, DELETE RESTRICT, UNIQUE |
| `performed_on` | date, obrigatório |
| `notes` | text, opcional |
| `created_at` | timestamptz |
| `updated_at` | timestamptz |

Índices por cliente e data realizada decrescente.

O vínculo opcional permite atendimento avulso. A unicidade de `booking_id` permite no máximo um atendimento por agendamento.

**`appointment_services` — serviços realizados**

| Campo | Tipo/restrição |
|---|---|
| `id` | bigint, PK |
| `appointment_id` | bigint, FK → `appointments.id`, DELETE CASCADE |
| `service_id` | bigint, FK → `services.id`, DELETE RESTRICT |
| `service_name` | text, snapshot preenchido por trigger |
| `return_interval_months` | smallint, opcional |
| `return_due_on` | date, opcional |
| `created_at` | timestamptz |

Unicidade de `(appointment_id, service_id)`, índice em `service_id` e CHECK de consistência entre intervalo e data de retorno.

Triggers copiam nome e intervalo do catálogo e calculam a data de retorno.

**`returns` — acompanhamento de retorno**

| Campo | Tipo/restrição |
|---|---|
| `id` | bigint, PK |
| `appointment_service_id` | bigint, FK → `appointment_services.id`, UNIQUE, DELETE CASCADE |
| `due_on` | date, obrigatório |
| `status` | text: `pending`, `completed`, `cancelled`; padrão `pending` |
| `contacted_at` | timestamptz, opcional |
| `contact_note` | text, opcional |
| `created_at` | timestamptz |
| `updated_at` | timestamptz |

Índice parcial em `due_on` para retornos pendentes.

Contato não equivale a conclusão: os estados são independentes.

**`agenda_salao_private.salon_users` — autorização**

| Campo | Tipo/restrição |
|---|---|
| `user_id` | uuid, PK, FK → `auth.users.id`, DELETE RESTRICT |
| `created_at` | timestamptz, padrão `now()` |

É uma lista de contas autorizadas, sem papel, profissional ou salão associado.

**`auth.users`**

Tabela gerenciada pelo Supabase Auth. O projeto referencia seu `id`, mas não define seu schema completo.

**View `pending_returns`**

Retorna:

- `id`: bigint;
- `due_on`, `performed_on`: date;
- `contacted_at`: timestamptz;
- `contact_note`: text;
- `client_id`: bigint;
- `client_name`, `client_phone`, `service_name`: text;
- `return_interval_months`: smallint.

Inclui somente retornos `pending`, com `security_invoker` e `security_barrier`.

**Regras gerais**

- Não há enums PostgreSQL; status são `text` com CHECK.
- Todas as tabelas públicas têm RLS.
- Agendamentos e atendimentos novos são gravados pelas RPCs.
- Snapshots preservam o contexto histórico.
- Retornos usam meses de calendário, inclusive ajuste de fim de mês.
- Não há tabelas de profissionais, salões, horários, bloqueios, preços ou pagamentos.

## 7. AUTENTICAÇÃO E USUÁRIOS

Fontes: [AuthProvider.tsx](frontend/src/hooks/AuthProvider.tsx), [RouteGuards.tsx](frontend/src/components/RouteGuards.tsx) e [supabase.ts](frontend/src/lib/supabase.ts).

**Fluxo**

1. Login com `signInWithPassword`.
2. Supabase fornece sessão e tokens.
3. `AuthProvider` restaura sessão com `getSession`.
4. Escuta mudanças com `onAuthStateChange`.
5. Chama `has_salon_access`.
6. A RPC verifica se `auth.uid()` pertence à tabela privada de autorização.
7. As rotas internas só são exibidas para contas autorizadas.

O cliente configura:

- persistência da sessão;
- renovação automática do token;
- detecção de sessão na URL.

Não há storage customizado; a persistência no navegador fica a cargo do SDK.

**Papéis**

Não existem papéis de admin, recepcionista, profissional ou cliente.

Existe a distinção entre:

- não autenticado;
- autenticado sem autorização;
- autenticado autorizado para os dados do salão.

A documentação prevê uma conta compartilhada. A tabela tecnicamente aceita várias contas, todas com o mesmo nível de acesso.

**Cadastro e recuperação**

- Sem cadastro público no frontend.
- Conta criada e autorizada administrativamente.
- Sem fluxo de recuperação de senha implementado.
- Sem interface de gerenciamento de usuários.
- Sem MFA implementado na aplicação.

No `config.toml`, o cadastro global está desativado, mas o bloco de e-mail contém `enable_signup = true`. Essa combinação deve ser revisada na configuração final; não comprova que o cadastro esteja aberto no serviço em execução.

## 8. BACKEND / API

Não existe servidor Express/Nest, controller HTTP próprio ou server action.

O frontend conversa com a Data API do Supabase e com RPCs PostgreSQL.

Os caminhos abaixo são relativos à URL do Supabase. São contratos inferidos do código e schema, não endpoints testados por HTTP nesta análise.

**Tabelas e view**

| Método/rota | Entrada/finalidade | Retorno e uso |
|---|---|---|
| `GET /rest/v1/clients` | Consultar clientes | `id`, nome, telefone, notas e ativo |
| `POST /rest/v1/clients` | Nome, telefone e notas | Cliente criado |
| `PATCH /rest/v1/clients?id=eq.…` | Dados cadastrais ou `active` | Cliente atualizado |
| `GET /rest/v1/services` | Consultar catálogo | Nome, duração, retorno sugerido e ativo |
| `POST /rest/v1/services` | Nome, duração e retorno | Serviço criado |
| `PATCH /rest/v1/services?id=eq.…` | Dados ou `active` | Serviço atualizado |
| `GET /rest/v1/bookings` | Consultar agenda | Agendamento com cliente e itens relacionados |
| `GET /rest/v1/booking_services` | Consultar planejamento | Snapshots de serviços |
| `GET /rest/v1/appointments` | Consultar atendimentos | Disponível no backend; sem tela |
| `PATCH /rest/v1/appointments?id=eq.…` | Somente `performed_on` e `notes` | Correção do atendimento |
| `GET /rest/v1/appointment_services` | Consultar serviços realizados | Snapshots históricos |
| `GET /rest/v1/returns` | Consultar retornos | Registros de retorno |
| `PATCH /rest/v1/returns?id=eq.…` | Somente `status` | Atualiza estado do retorno |
| `GET /rest/v1/pending_returns` | Consultar pendências | Retorno com dados de cliente e serviço |

Clientes e serviços também possuem permissão SQL de DELETE para contas autorizadas, sujeita às FKs. A interface não utiliza essa operação.

Implementação frontend: `frontend/src/data/clients.ts`, `services.ts` e `bookings.ts`. Permissões efetivas: migrations inicial e de endurecimento das operações.

**RPCs**

Todas podem ser chamadas com `POST /rest/v1/rpc/<nome>`.

| RPC | Entrada | Retorno |
|---|---|---|
| `has_salon_access` | Sem parâmetros | boolean |
| `calendar_months_after` | `base_date`, `month_count` | date |
| `create_booking` | `p_client_id`, `p_starts_at`, `p_service_ids`, opcionais `p_duration_minutes`, `p_notes` | ID, cliente, início, fim, status e quantidade de serviços |
| `update_booking` | Mesmo conjunto, mais `p_booking_id` | Mesmo contrato da criação |
| `confirm_booking` | `p_booking_id` | ID, status, `status_updated_at`, `updated_at` |
| `cancel_booking` | `p_booking_id` | Mesmo contrato de status |
| `mark_booking_no_show` | `p_booking_id` | Mesmo contrato de status |
| `complete_booking` | `p_booking_id`, `p_performed_on`, `p_service_ids`, opcional `p_notes` | `booking_id`, `appointment_id`, status, data realizada, quantidade de serviços |
| `create_appointment_with_services` | `p_client_id`, `p_performed_on`, `p_service_ids`, opcional `p_notes` | ID do atendimento, cliente, data, contagens de serviços e retornos |
| `mark_return_contacted` | `p_return_id`, opcional `p_note` | ID do retorno, horário de contato e status |

As operações que retornam registros usam resultado tabular de uma linha; o frontend aplica `.single()` nas RPCs consumidas.

**Localização**

- Agenda: `20260910211802_add_booking_operations.sql`.
- Conclusão: `20260910213811_complete_booking.sql`.
- Atendimento e contato: wrappers em `20260903155650_harden_business_operations.sql`; núcleo de atendimento atualizado na migration de conclusão.
- Autorização: `20260911175130_add_has_salon_access.sql`.
- Meses de calendário: migration inicial.

Os wrappers públicos usam `SECURITY INVOKER`; implementações privadas privilegiadas verificam autorização e usam `search_path = ''`.

**Autenticação**

O SDK também consome a API Auth para login, restauração/renovação de sessão e logout. Não há implementação própria desses endpoints no repositório.

## 9. FRONTEND

A arquitetura é uma **SPA React**, organizada em telas, componentes, contexto de autenticação e funções de acesso a dados.

**Estado**

- `useState` para formulários, listas, carregamento, erros e diálogos.
- `useEffect` para consultas.
- `useMemo` para buscas e dados derivados.
- Context somente para autenticação.
- Sem Redux, Zustand ou TanStack Query.
- Após alterações, as telas geralmente consultam os dados novamente.
- Sem assinatura Realtime.

**Formulários**

São controlados pelo React, sem biblioteca de formulários ou schema de validação.

Validações locais incluem:

- tamanho de nome e telefone;
- inteiros positivos;
- intervalo de retorno entre 1 e 120 meses;
- início futuro;
- cliente e serviços ativos;
- presença de serviços e duração.

O banco repete as regras críticas.

**Componentes**

- `AppShell`: navegação, cabeçalho, conta e logout.
- `RouteGuards`: proteção e estados de acesso.
- `BookingDialog`: criação e edição.
- `BookingConfirmDialog`: compartilha a estrutura de confirmar, cancelar e não comparecer.
- `SessionLoader`: restauração de sessão.
- `NavIcon`: ícones próprios.
- Formulários e diálogos de clientes/serviços ficam dentro das próprias páginas.

**Calendário e listagens**

Não há calendário visual. A agenda é uma lista cronológica.

As listagens são construídas com HTML e CSS próprios; não há biblioteca de tabelas, virtualização ou paginação.

**Modais e acessibilidade**

Uso de `<dialog>` com `showModal()`, labels, mensagens com `role="alert"`/`status`, atributos ARIA e bloqueio de fechamento durante submissões.

Há suporte CSS a `prefers-reduced-motion`.

**Responsividade e visual**

[global.css](frontend/src/styles/global.css) define:

- cores creme, rosa, areia e oliva;
- títulos com fontes serifadas;
- navegação lateral no desktop;
- navegação inferior e cabeçalho adaptado no celular;
- breakpoints de 920, 700 e 390 px;
- largura mínima de 320 px.

A responsividade está implementada no CSS, mas não foi validada visualmente em navegador nesta análise.

## 10. PROBLEMAS ENCONTRADOS

**Verificações executadas sem emissão de arquivos**

No diretório `frontend`:

| Verificação | Comando | Resultado |
|---|---|---|
| TypeScript da aplicação | `.\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit --incremental false` | Saída 0; nenhum diagnóstico TypeScript |
| TypeScript da configuração | `.\node_modules\.bin\tsc.cmd -p tsconfig.node.json --noEmit --incremental false` | Saída 0; nenhum diagnóstico TypeScript |
| Lint | `.\node_modules\.bin\eslint.cmd . --no-cache` | Saída 0; nenhum diagnóstico ESLint |

Os três processos emitiram esta mensagem de ambiente:

```text
ERROR:third_party\crashpad\crashpad\util\win\registration_protocol_win.cc:108
CreateFile: Acesso negado. (0x5)
```

Ela não veio acompanhada de erro TypeScript/ESLint. **Não foi possível determinar** sua causa exata.

O build convencional não foi executado porque `tsc -b && vite build` gera arquivos. Portanto, **não foi possível determinar se o bundle de produção compila integralmente**.

Os testes SQL também não foram executados: criam fixtures, e o teste de concorrência utiliza dados efetivamente confirmados entre conexões.

Há **9 arquivos e 361 testes planejados** pelos `plan(...)`. O README registra uma execução anterior de 352 testes, antes da adição da suíte de autorização. Esse histórico não substitui uma execução atual.

Durante a inspeção, houve falhas auxiliares de leitura do lockfile pelo PowerShell e de quoting de um comando Node. Foram falhas dos comandos de inspeção, não do projeto; as versões foram depois verificadas diretamente no arquivo.

**Achados concretos**

| Achado | Consequência |
|---|---|
| READMEs desatualizados | Outro desenvolvedor pode avaliar incorretamente o progresso |
| Dashboard sem consultas | Indicadores não representam o salão |
| Retornos como placeholder | Backend existente não é utilizável pela interface |
| `complete_booking` sem integração frontend | Não é possível finalizar o ciclo pela aplicação |
| Ausência de profissionais | Capacidade global de apenas um agendamento ativo por intervalo |
| Ausência de expediente/bloqueios | Horários fora do funcionamento continuam aceitos |
| Consultas sem paginação | Listas podem ficar limitadas pelo teto da Data API |
| Agenda sem filtro de período/status | Mistura agendamentos antigos, futuros e terminais |
| Datas dependentes do fuso do navegador | Dispositivos em fusos diferentes podem mostrar ou registrar horários diferentes |
| Edição exige início futuro | Não permite corrigir apenas notas de uma reserva já iniciada |
| Edição refaz snapshots do plano | Alteração simples pode modificar duração/nome planejados |
| Cliente inativo bloqueia conclusão | Atendimento previamente agendado pode exigir reativação da cliente |
| Conclusão sem barreira temporal | A RPC aceita concluir reserva futura; a data realizada também não é limitada ao presente/passado |
| Telefone validado apenas por tamanho | Valores sem formato telefônico podem ser cadastrados |
| Ausência de testes frontend | Interações, navegação e formulários não têm suíte automatizada identificada |

**Outras observações**

- Nenhum import quebrado foi apontado pelo TypeScript.
- Não encontrei marcadores `TODO`, `FIXME`, `HACK` ou `XXX` no código pesquisado.
- Não encontrei funções de negócio vazias disfarçadas de integração.
- As RPCs chamadas pelo frontend existem nas migrations e nos tipos.
- Não identifiquei incompatibilidade estrutural evidente entre tipos e migrations.
- Isso não confirma a sincronização com um banco atualmente em execução.
- As URLs de redirecionamento Auth apontam para porta 3000, enquanto Vite não fixa uma porta. Essa configuração merece alinhamento, especialmente para futuros fluxos por link.

## 11. VARIÁVEIS DE AMBIENTE E SERVIÇOS EXTERNOS

Foram identificadas somente estas variáveis utilizadas pela aplicação:

| Nome | Finalidade |
|---|---|
| `VITE_SUPABASE_URL` | Endereço do serviço Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública utilizada pelo cliente Supabase |

Referências:

- `frontend/src/lib/supabase.ts`;
- `frontend/src/vite-env.d.ts`;
- `frontend/.env.example`;
- `frontend/.env.local`, presente e ignorado pelo Git.

Nenhum valor foi reproduzido.

Se essas variáveis estiverem ausentes, `supabase.ts` lança uma exceção durante a inicialização, antes da tela de login.

Não foi identificado uso de chave privilegiada no código frontend. A segurança depende da sessão, das permissões e do RLS.

**Serviço externo efetivamente integrado:** Supabase.

WhatsApp aparece como intenção na documentação, sem integração implementada.

## 12. DADOS MOCKADOS OU TEMPORÁRIOS

| Item | Situação |
|---|---|
| Dashboard | Array hardcoded `overviewItems`, com valores `—` |
| Retornos | Página placeholder |
| Clientes | Consultados e gravados no Supabase |
| Serviços | Consultados e gravados no Supabase |
| Agenda | Consultada e gravada no Supabase |
| Usuários fake na aplicação | Não encontrados |
| Fixtures fictícias | Presentes em `supabase/tests/*.sql` |
| Dados de negócio em `localStorage` | Nenhum uso direto identificado |
| Persistência de autenticação | Delegada ao SDK Supabase |
| Branding | Nome do salão, monograma e textos fixos no frontend |
| Seed operacional | Não identificado |

Os arquivos `data/clients.ts`, `services.ts` e `bookings.ts` são acessos reais ao backend, não arrays de demonstração.

**Não foi possível determinar** se os registros de um banco local ou remoto atualmente configurado são reais ou de teste, pois eles não foram consultados.

## 13. O QUE FALTA PARA O SISTEMA FICAR FUNCIONAL

Para fechar uma primeira versão utilizável:

1. **Concluir atendimentos pela interface**, consumindo `complete_booking`.
2. **Consultar histórico de atendimentos**, inclusive por cliente.
3. **Implementar retornos**, usando `pending_returns`, `mark_return_contacted` e alteração de status.
4. **Conectar o dashboard** aos dados reais.
5. **Definir expediente**, intervalos, dias fechados e bloqueios.
6. **Definir se haverá vários profissionais** e, nesse caso, modelar vínculos, disponibilidade e conflitos por profissional.
7. **Adicionar filtros de agenda** por data, período e status.
8. **Adicionar paginação e busca no servidor** onde necessário.
9. **Fixar o fuso do salão** e padronizar conversões.
10. **Resolver regras operacionais de edição**, conclusão antecipada, cliente inativo e reabertura/correção.
11. **Definir acesso individual e papéis**, se a conta compartilhada não atender à operação.
12. **Implementar recuperação de senha** ou documentar procedimento administrativo confiável.
13. **Validar ponta a ponta**, incluindo erros de rede e concorrência.
14. **Preparar produção**, com deploy, URLs Auth, migrations, configuração e recuperação de dados.

Criação, duração, conflito, confirmação, cancelamento e edição básica **já existem**; precisam ser preservados e complementados.

Financeiro, comissão e pagamentos estão explicitamente fora do escopo atual documentado.

## 14. RISCOS TÉCNICOS

**Agenda global**

A exclusão de conflitos não tem `professional_id` nem `salon_id`. É adequada para um único recurso de atendimento, mas exigirá mudança de modelo para paralelismo.

**Fuso horário**

`timestamptz` é apropriado no banco. O risco está no frontend: entrada e apresentação usam o fuso do dispositivo, sem uma referência explícita ao salão.

**Listas incompletas e desempenho**

As consultas buscam todos os registros disponíveis, sem `.range()` ou filtros temporais. Além de desempenho, há risco de resultados incompletos diante do limite de linhas da API. A busca local só pesquisa o que foi carregado.

**Edição com efeitos indiretos**

`update_booking` substitui o planejamento inteiro. Se o catálogo mudou, salvar apenas uma observação pode recalcular o término ou provocar conflito.

A origem “manual versus automática” da duração não é armazenada; o formulário a infere comparando a duração reservada com a soma dos snapshots.

**Concorrência de edição**

Locks protegem integridade e serializam operações, mas não há versão esperada do registro. Duas pessoas editando a mesma reserva podem sobrescrever dados uma da outra.

**Autorização e auditoria**

O RLS e os privilégios mínimos são pontos fortes. Porém, todas as contas autorizadas compartilham acesso e não há registro de quem realizou cada alteração. Uma conta compartilhada também reduz rastreabilidade.

**Permissões mais amplas nos cadastros**

Clientes e serviços permitem mais operações pela API do que a interface oferece, incluindo exclusão quando as FKs permitirem. Isso deve ser considerado ao introduzir perfis com poderes diferentes.

**Histórico parcial**

Há snapshots, mas não histórico completo de alterações. O atendimento realizado não guarda horários reais de início/fim ou duração real, apenas a data.

**Retornos sem vínculo explícito com novo atendimento**

O status é manual; não existe relacionamento que comprove qual novo agendamento/atendimento resolveu determinado retorno.

**Manutenção frontend**

Há duplicação de validação, normalização, tratamento de erros e estrutura de diálogos entre clientes e serviços. As páginas concentram bastante lógica, e o CSS é global.

**Tipagem não representa permissões**

Os tipos gerados incluem estruturas `Insert`/`Update` mesmo para operações proibidas ao usuário autenticado. O próximo desenvolvedor deve consultar os GRANTs/RPCs, não deduzir autorização apenas pelo TypeScript.

## 15. PRÓXIMOS PASSOS SUGERIDOS

Ordem recomendada, sem executar alterações:

1. **Confirmar o escopo operacional:** uma profissional e agenda única ou múltiplos profissionais.
2. **Validar o ambiente de destino:** schema aplicado, conta autorizada, configuração Auth e dados preserváveis.
3. **Fechar o fluxo existente:** conclusão do agendamento, atendimento realizado e histórico.
4. **Implementar retornos**, aproveitando as regras já existentes.
5. **Definir fuso, expediente e bloqueios**, com validação no banco.
6. **Adicionar profissionais**, caso façam parte da primeira versão, ajustando os conflitos.
7. **Melhorar a consulta da agenda:** período, status, paginação e visualização diária/semanal.
8. **Conectar dashboard** às consultas reais.
9. **Ajustar acesso e rastreabilidade:** usuários individuais, papéis e recuperação de senha conforme o escopo.
10. **Testar e preparar publicação:** banco, frontend, fluxo completo, responsividade, configuração e documentação.

Para manter a proposta atual de agenda única, o próximo incremento de maior valor é **integrar `complete_booking` à interface**, pois o backend correspondente já está pronto.

## 16. RESUMO PARA CONTINUAR O PROJETO

O projeto `agenda-salao` é uma aplicação interna para o salão **Monica Lugo Alisamentos**, construída com **React 19.3, TypeScript 6.0.3, Vite 8.3, React Router 7.18.3 e Supabase JS 2.116.0**. O backend é **Supabase Auth + Data API + PostgreSQL 17**, com regras em SQL/PLpgSQL. Não há servidor intermediário, ORM ou biblioteca de UI.

O frontend fica em `frontend/`. As rotas estão em `src/App.tsx`; autenticação em `src/hooks/AuthProvider.tsx`; proteção em `src/components/RouteGuards.tsx`; acesso a dados em `src/data/`; apresentação em `src/pages/` e `src/components/`. O estilo é CSS próprio em `src/styles/global.css`.

O banco é definido por **8 migrations em `supabase/migrations/`**. Existem **7 tabelas públicas**: `clients`, `services`, `bookings`, `booking_services`, `appointments`, `appointment_services` e `returns`. A view `pending_returns` reúne as pendências. A tabela privada `agenda_salao_private.salon_users` autoriza contas de `auth.users`. Os tipos ficam em `database.types.ts`, reexportados no frontend.

A arquitetura separa **agendamento planejado** de **atendimento realizado**. Serviços planejados guardam snapshots de nome/duração; serviços realizados guardam nome/intervalo de retorno. Retornos são gerados por triggers usando meses de calendário.

Estão integrados: login, autorização, cadastro/edição/inativação/reativação de clientes e serviços; listagem, criação, edição, confirmação, cancelamento e não comparecimento de agendamentos. A agenda utiliza RPCs transacionais, duração automática ou manual e bloqueio de sobreposição no banco.

**Ainda não há integração frontend para `complete_booking`, atendimentos avulsos, histórico e retornos.** Dashboard é ilustrativo e `/retornos` é placeholder. Não existem profissionais, expediente, folgas, bloqueios, papéis ou configurações operacionais.

As RPCs principais são `create_booking`, `update_booking`, `confirm_booking`, `cancel_booking`, `mark_booking_no_show`, `complete_booking`, `create_appointment_with_services`, `mark_return_contacted` e `has_salon_access`.

A agenda é **global para o salão**, sem atendimentos simultâneos ativos. Status: `scheduled`, `confirmed`, `completed`, `cancelled`, `no_show`. Edição exige início futuro e refaz snapshots com o catálogo atual. Conclusão gera atendimento e retornos atomicamente, de forma idempotente.

Principais cuidados: fuso do navegador, consultas sem paginação, ausência de auditoria e controle de edição concorrente, cliente inativo impedindo conclusão e possibilidade de concluir reservas futuras pela RPC. Os READMEs estão desatualizados.

Variáveis utilizadas: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Não foi identificada configuração versionada de deploy.

TypeScript da aplicação, TypeScript da configuração e ESLint passaram com saída zero; houve uma mensagem de ambiente do Crashpad sobre acesso negado. Build de produção e testes SQL não foram executados. A suíte SQL contém 9 arquivos e 361 testes planejados. O funcionamento contra banco ativo e o estado de produção **não foram confirmados**.

**Próximo passo recomendado:** confirmar se a primeira versão continuará com agenda única e integrar a conclusão de agendamento usando `complete_booking`, seguida de histórico e retornos. Preservar as garantias transacionais e de RLS existentes.
