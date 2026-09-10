# Frontend

Base React + TypeScript + Vite da agenda interna Monica Lugo Alisamentos.

## Configuração local

Copie `.env.example` para `.env.local` e preencha apenas a chave pública do
Supabase local:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<chave pública local>
```

Nunca use `service_role` no frontend. Arquivos `.env` e `.env.local` são
ignorados pelo Git.

## Comandos

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
```

O dashboard e as rotas internas são somente a fundação visual. Agenda,
clientes, serviços e retornos ainda não consultam nem alteram dados reais.
