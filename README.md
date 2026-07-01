# TRACKTUDO

Dashboard local para monitorar **contas de anúncio da Meta** (Facebook/Instagram) sem abrir o
Gerenciador de Negócios conta por conta. Uso **somente leitura** — o software nunca cria, edita
ou pausa nada.

Duas telas principais:

1. **Limites** — limite de gastos (`spend_cap`), gasto acumulado (`amount_spent`), disponível e % usado.
2. **Gastos Diários** — quanto cada conta gastou por dia.

Os dados vêm da **Meta Marketing API (Graph API v25.0)**.

---

## Stack

| Camada     | Tecnologia                                   |
| ---------- | -------------------------------------------- |
| Backend    | Node.js + Express + TypeScript               |
| Banco      | SQLite (`better-sqlite3`)                    |
| Agendador  | `node-cron`                                  |
| Frontend   | React + Vite + TypeScript + `recharts`       |

Estrutura:

```
TRACKTUDO/
├── server/   # backend (API Meta, banco, agendador, rotas REST)
└── client/   # frontend (telas de Limites e Gastos Diários)
```

---

## Pré-requisitos

- **Node.js 20+** (testado com Node 24). Confira com `node -v`.
- Um **token de System User de longa duração** da Meta e o **ID do Business Manager**.

---

## Como gerar e colocar o token

1. Acesse o **Gerenciador de Negócios** → **Configurações do negócio** → **Usuários** → **Usuários do sistema**.
2. Crie (ou selecione) um **System User** e gere um **token de acesso** com a permissão
   **`ads_read`** (leitura de anúncios). Escolha a validade mais longa possível.
3. Anote também o **ID do Business Manager** (aparece em Configurações do negócio → Informações do negócio).
4. Na pasta `server/`, copie o arquivo de exemplo e preencha:

   ```bash
   cd server
   cp .env.example .env      # no Windows PowerShell: Copy-Item .env.example .env
   ```

   Edite `server/.env`:

   ```env
   META_SYSTEM_USER_TOKEN=seu_token_de_system_user_aqui
   META_BUSINESS_ID=seu_business_id_aqui
   ```

> ⚠️ **Nunca** comite o arquivo `.env`. Ele já está no `.gitignore`.

---

## Como rodar

### Backend

```bash
cd server
npm install
npm run dev      # sobe em http://localhost:3000
```

Teste rápido: abra `http://localhost:3000/api/health`.

### Frontend

```bash
cd client
npm install
npm run dev      # sobe em http://localhost:5173
```

O frontend já encaminha as chamadas `/api` para o backend via proxy do Vite.

---

## Agendamento das coletas

- **Limites:** a cada 12h (`CRON_LIMITS`, padrão `0 */12 * * *`).
- **Gastos diários:** a cada 6h (`CRON_DAILY_SPEND`, padrão `0 */6 * * *`), com **backfill inicial**
  dos últimos 30 dias (`BACKFILL_DAYS`) na primeira execução.
- Todos os intervalos são configuráveis no `.env`.

_(Detalhes de cada módulo são preenchidos nas próximas fases de desenvolvimento.)_

---

## Variáveis de ambiente

Veja `server/.env.example` para a lista completa (token, business id, versão da API, cron e rate limit).
