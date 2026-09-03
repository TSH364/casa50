# Fluxo – Finanças do Casal

Central financeira compartilhada: importa faturas, categoriza lançamentos,
projeta o que já está comprometido e registra quem fez cada alteração.

---

## Estado atual — leia antes de usar

As sete etapas estão implementadas. O que **não** está pronto está listado
abaixo, em "Limitações conhecidas" — nada aparece na interface como dado
inventado.

| Etapa | Escopo | Situação |
|---|---|---|
| 1 | Estrutura, autenticação, banco, migrations, seed, layout base | **Pronta** |
| 2 | Cartões, categorias, lançamentos, extratos, membros, resumo do mês | **Pronta** |
| 3 | Importação de fatura, normalização, duplicidades, revisão | **Pronta para CSV** — XLSX e PDF não leem |
| 4 | Extratos, edição, exclusão, histórico, auditoria na tela | **Pronta** |
| 5 | Parcelas, recorrências, previsão, conciliação | **Pronta** |
| 6 | Orçamentos, metas, insights, divisão de despesas | **Pronta** |
| 7 | Testes E2E, acessibilidade, deploy | **Parcial** — E2E escritos, não executados aqui |

**159 testes unitários** cobrem dinheiro, datas, resumo do mês, leitura de
fatura, parcelas, recorrências, previsão, metas, insights e divisão.

### Limitações conhecidas

Estas são reais e nenhuma está escondida atrás de uma tela que finge funcionar.

- **XLSX e PDF não são lidos.** A tela de importação pede o CSV com uma
  mensagem clara em vez de tentar ler e importar dado parcial em silêncio.
- **Os testes E2E nunca rodaram até o fim nesta máquina.** O projeto está
  dentro de uma pasta do OneDrive, e a sincronização disputa os arquivos que o
  Next.js reescreve em `.next` a cada compilação (`EBUSY: resource busy or
  locked`), derrubando o servidor de desenvolvimento com erro 500 no meio da
  suíte. Os testes estão escritos e configurados; para executá-los, mova o
  projeto para fora do OneDrive ou pause a sincronização antes de rodar.
- **Nenhuma tela foi exercitada com dados reais do casal.** Tudo foi verificado
  por teste automatizado, por consulta direta ao banco e por build — nunca
  usando o app de verdade com uma fatura sua.
- **O app não envia e-mail.** O convite de membro cria o vínculo pendente; a
  pessoa precisa ser avisada por fora e entrar com o mesmo endereço.
- **Divisão de despesas divide igual ou por peso fixo.** A divisão por item e
  o rateio proporcional à renda com atualização automática ficaram de fora; o
  documento do produto os coloca em "Evolução planejada".

### O que a Etapa 4 entrega

- **Faturas do mês** em Extratos: cada importação com arquivo, instituição,
  quem importou, quando, quantos lançamentos e o total — com **desfazer**.
  Quando o arquivo traz o total do banco, a divergência contra a soma
  calculada aparece em destaque (secao 6).
- **Totais por cartão no mês**, calculados dos mesmos lançamentos que a lista
  mostra, com a mesma função de sinal — o número do cartão não pode divergir
  do total do mês. Tocar num cartão filtra a lista; tocar de novo volta a
  "Todos".
- **Página de histórico** (`/historico`) com filtro por pessoa, ação e tipo de
  registro. Frases prontas, nunca JSON cru:

```text
Vinicius alterou o orçamento de Alimentação: o limite de R$ 2.000,00 para R$ 2.300,00
Vinicius alterou Starlink: a categoria de Serviços para Assinaturas
Vinicius excluiu Starlink de R$ 98,00
```

O JSON antes/depois continua guardado no banco para rastreabilidade, mas a
tela não o lê.

### O que a Etapa 3 entrega

Fluxo de importação em `/importar`, com o arquivo lido **no navegador** — nada
sai da máquina antes de você revisar e confirmar.

- **CSV do Nubank** (`date,title,amount`) e variantes em português.
- **Convenção de sinal detectada por arquivo.** O CSV real do Nubank traz
  despesa positiva; o exemplo da especificação usa negativa. O importador
  decide pela maioria das linhas, mostra a conclusão e deixa inverter.
- **Mês pelo nome do arquivo** (`2026-08`, `08-2026`, `agosto-2026`, `202608`),
  com as datas como segunda tentativa e confirmação manual sempre disponível.
- **Parcela extraída da descrição** (`NETFLIX 3/12`), sem confundir `12/2026`.
- **Tipos classificados**: despesa, tarifa (anuidade, IOF, juros), pagamento de
  fatura e estorno. `Desconto` **nunca** vira pagamento — exigência da secao 6.
- **Duplicidade por identidade completa**: mês, data, estabelecimento
  normalizado, valor, cartão e parcela. A mesma assinatura em meses diferentes
  não é repetição; a parcela 3/10 não é igual à 4/10.
- **Revisão antes de gravar**: novos, repetidos, ignorados, sem categoria e
  total calculado, com cada linha alternável entre importar e ignorar.
- **Categorização automática** por regra aprendida ou pela categoria do arquivo.
- **Desfazer a importação**, que apaga os lançamentos e marca a fatura como
  revertida — o registro de que houve importação continua no histórico.

Arquivo de exemplo para testar: `docs/exemplo-nubank.csv`.

**XLSX e PDF ainda não leem.** A tela mostra mensagem clara pedindo o CSV, em
vez de importar dado parcial em silêncio.

### O que a Etapa 2 entrega (parcial)

- **Cartões**: criar, editar, arquivar e excluir. A exclusão é recusada quando
  há histórico — o cartão é arquivado, para não deixar lançamentos órfãos.
- **Lançamento manual**: criar, editar e excluir, com os campos da secao 9
  (tipo, categoria e subcategoria, quem gastou, cartão, visibilidade, divisão,
  parcela, apelido, observação) e confirmação explícita antes de excluir.
- **Resumo do mês**: gasto líquido de estornos, receitas, saldo, contagem,
  previsto e comprometido em parcelas — cada um em card próprio.
- **Para onde foi**: rosca e lista por categoria, com percentual e valor.
- **Extratos**: lista cronológica com busca por descrição, estabelecimento e
  apelido, filtro por mês, pessoa e cartão.
- **Troca de mês sem valor obsoleto**: mês e filtros vivem na URL e cada seção
  está sob `Suspense` com chave derivada deles, então trocar de mês derruba os
  cards em skeleton em vez de mostrar o total anterior sob o título novo
  (secao 20).

Ainda não feito na Etapa 2: convite de membro por e-mail e CRUD de categorias
e subcategorias.

### O que a Etapa 1 entrega

- **Banco completo**: as 15 tabelas do modelo de dados da especificação, com
  enums, índices, constraints e triggers.
- **Isolamento por casa via Row Level Security** — a garantia está no banco,
  não em filtro de frontend.
- **Auditoria automática por trigger**, com texto legível e o JSON antes/depois.
- **Autenticação real** (e-mail e senha), criação de casa, seleção de casa ativa.
- **Camada de domínio financeiro testada** — 159 testes unitários passando.
- **Layout base** dark, mobile-first, com as seis seções navegáveis.

### Banco em produção

O projeto Supabase já existe e as migrations já estão aplicadas:

| | |
|---|---|
| Projeto | **Fluxo** (`admauxgjmhskhvrogaaf`) |
| Região | `sa-east-1` — São Paulo |
| URL | `https://admauxgjmhskhvrogaaf.supabase.co` |
| Migrations aplicadas | 0001 → 0005 |

### O que foi verificado

Contra o banco real, em transações revertidas ao final (nenhum dado de teste
ficou gravado):

- Trigger de perfil dispara no cadastro e grava o nome informado.
- Criar casa semeia **14 categorias** e insere o criador como `owner`.
- `PG *99 RIDE 3/12` normaliza para `99 RIDE` (prefixo e sufixo de parcela removidos).
- `duplicate_key` é gerada no insert.
- Auditoria produz texto humano: *"alterou Corrida: amount de R$ 32,90 para R$ 45,00"*.
- **Isolamento**: logado como a Pessoa A, o banco devolve 1 lançamento da própria
  casa, **0** da casa alheia, 1 casa, 14 categorias e 1 perfil; a tentativa de
  gravar na casa alheia foi **bloqueada pelo RLS**.
- *Security advisor* do Supabase: nenhum erro. Um aviso conhecido e aceito —
  `accept_house_invite` é `SECURITY DEFINER` chamável por usuário logado, o que é
  necessário porque um convidado ainda não é membro; a função só casa o convite
  com o e-mail autenticado de quem chama.

Também passam: `npm run typecheck`, `npm test` (159 testes) e `npm run build`
(14 rotas). As telas de login e cadastro foram carregadas contra o banco real,
em 375px e em desktop, sem erro de console.

Pela interface, já com a conta real logada: Início, Extratos, Cartões e Casa
carregam contra o banco; o modal de lançamento abre com cabeçalho e rodapé
fixos e só o corpo rolando; nenhum erro de console.

**Ainda não exercitado**: gravar de fato um lançamento, editar e excluir pela
interface. As actions estão escritas e tipadas, mas nenhum dado foi criado na
casa real — esse teste é seu.

### Antes do primeiro cadastro

No painel do Supabase, em **Authentication → URL Configuration**, adicione às
*Redirect URLs*:

```text
http://localhost:3000/auth/confirmar
```

E depois, quando publicar na Vercel, também a URL de produção. Sem isso o link
de confirmação de e-mail não volta para o app.

## Stack

| Peça | Escolha | Por quê |
|---|---|---|
| Framework | Next.js 15, App Router | Server Actions evitam uma camada de API só para formulários |
| Linguagem | TypeScript, `strict` + `noUncheckedIndexedAccess` | Acesso a índice devolve `T \| undefined`, o que pega acesso fora de faixa em tempo de compilação |
| Estilo | Tailwind CSS v4 | Tokens de tema em CSS puro, sem `tailwind.config.js` |
| Componentes | Padrão shadcn/ui, escritos à mão | Mesma API, sem depender de rodar a CLI para compilar |
| Banco e auth | Supabase (Postgres + GoTrue) | RLS resolve o isolamento por casa dentro do banco |
| Gráficos | Recharts | Pedido na especificação |
| Validação | Zod | Mesmo schema valida formulário e Server Action |
| Testes | Vitest, Playwright | Vitest compartilha a resolução de `@/` com o Vite |

### Desvios da especificação, e por quê

1. **`profiles` em vez de `User`.** No Supabase a identidade canônica vive em
   `auth.users`, gerenciada pelo GoTrue e não alterável por nós. `public.profiles`
   espelha os dados de exibição e é o que a aplicação lê. Os nomes vêm sempre
   daí — não há nome fixo em código.

2. **`goals.current_amount` não é coluna.** É a soma de `goal_deposits`,
   exposta pela view `goals_with_progress`. Guardar o saldo em duplicidade
   abriria espaço para ele divergir do histórico de depósitos.

3. **`duplicate_key` tem índice não-único.** A especificação exige que
   duplicidades sejam *exibidas para revisão*, não bloqueadas — a mesma compra
   pode aparecer legitimamente em faturas de meses diferentes.

4. **Sinal do CSV Nubank é detectado, não fixado.** No arquivo real do Nubank a
   despesa vem positiva e o pagamento negativo; o exemplo da especificação usa a
   convenção oposta (`PG *99 RIDE,"-32,90"`). Como as duas aparecem, a Etapa 3
   vai inferir a convenção por arquivo e pedir confirmação, em vez de assumir.

5. **`xlsx`, `pdfjs-dist` e `papaparse` completos entram na Etapa 3.** Instalar
   agora bibliotecas pesadas de parsing sem código que as use só engordaria o
   bundle.

6. **A rosca de categorias é SVG puro, não Recharts.** A biblioteca está no
   projeto e vai ganhar o mapa de fluxo e as séries da Etapa 5, onde eixos,
   escala e tooltip valem o peso. Para uma rosca estática ela custava 98 kB no
   bundle de `/inicio` — mais que todo o resto da página somado. Em SVG o
   componente roda no servidor e envia zero JavaScript.

7. **PIX e dinheiro não são tipos de lançamento.** São formas de pagamento: uma
   despesa paga em PIX é `expense` sem cartão. Criar um tipo por meio de
   pagamento faria os totais somarem categorias que são a mesma coisa.

---

## Instalação

Pré-requisitos: Node 20+ e Docker Desktop (para o Supabase local).

```bash
npm install
```

### Opção A — Supabase local (recomendado para desenvolver)

```bash
npm run db:start
```

O comando imprime `API URL` e `anon key`. Copie `.env.example` para `.env.local`
e preencha com esses valores. Depois:

```bash
npm run db:reset
```

Isso aplica as três migrations e roda o seed. Contas de teste:
`vinicius@exemplo.test` e `larissa@exemplo.test`, senha `fluxo1234`.

### Opção B — Supabase na nuvem (já configurado)

O `.env.local` já aponta para o projeto **Fluxo** em São Paulo, com as migrations
aplicadas. Não há nada a fazer além de `npm run dev`.

Para vincular a CLI e aplicar migrations futuras:

```bash
npx supabase link --project-ref admauxgjmhskhvrogaaf
npm run db:push
```

**Não** rode o seed na nuvem: ele cria usuários fictícios.

### Rodar

```bash
npm run dev
```

---

## Deploy

O app precisa de um servidor Node rodando: ele monta cada tela no servidor,
com a sessão de quem pediu. **Não funciona como site estático** — exportar
para HTML derrubaria middleware de autenticação, Server Actions e importação.

Nos dois caminhos abaixo, o banco continua sendo o Supabase. A escolha de
hospedagem não move seus dados.

### Variáveis de ambiente (iguais nos dois)

| Variável | Valor | Obrigatória? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publicável (anon) | sim |
| `NEXT_PUBLIC_SITE_URL` | endereço final do app | só fora da Vercel |

Na Vercel, o endereço de produção é descoberto sozinho por
`VERCEL_PROJECT_PRODUCTION_URL`, então bastam as duas primeiras. Defina a
terceira quando usar domínio próprio ou outra hospedagem — sem ela, e sem a
variável da Vercel, o app se recusa a subir em produção em vez de mandar o
link de confirmação de e-mail para `localhost`.

`SUPABASE_SERVICE_ROLE_KEY` **não vai para o servidor de produção**: ela ignora
o RLS e nenhuma rota do app a usa. Ela existe só para scripts administrativos
rodados na sua máquina.

Depois de publicar, nos dois casos:

1. No Supabase, em **Authentication → URL Configuration**, adicione
   `https://SEU-DOMINIO/auth/confirmar` às *Redirect URLs*. Sem isso o link de
   confirmação de e-mail volta para `localhost`.
2. Mantenha **Confirm email** ligado. O `supabase/config.toml` desliga isso
   apenas no ambiente local.
3. Ligue **Leaked password protection** em Authentication → Password. O
   advisor do Supabase aponta isso como pendente; é uma caixa de seleção.

### Opção A — Vercel

1. Importe o repositório do GitHub na Vercel.
2. Configure as duas primeiras variáveis em Settings → Environment Variables.
3. Publique. Cada `git push` na `main` republica sozinho.

É a implementação de referência do Next.js: middleware, Server Actions e
revalidação são de primeira mão. Para um app de duas pessoas o plano gratuito
sobra — e ele é permanente nesse volume, não período de teste. O plano
gratuito proíbe uso comercial; finanças pessoais de um casal está dentro.

### Opção B — Hostinger (Hospedagem de Aplicações Web)

Só o produto de **aplicações web** (Node.js). A hospedagem de site comum
(Premium/Business) é PHP e não roda este app.

1. Conecte o repositório do GitHub no painel.
2. Configure as três variáveis de ambiente — aqui a terceira é obrigatória,
   porque não existe a variável automática da Vercel.
3. Comando de build `npm run build`, de início `npm run start`.

Dois pontos antes de fechar o plano:

- **O preço anunciado é de 48 meses pagos adiantado.** Na renovação o valor
  mensal é várias vezes maior. Compare com o gratuito da Vercel considerando o
  custo total, não a parcela.
- **O plano mais barato não informa a RAM.** `next build` costuma pedir 1–2 GB;
  com menos que isso o build falha. O plano com 4 GB não tem esse problema.

Faz sentido se você já paga Hostinger e quer um fornecedor só, ou se quer os
dados fora dos EUA.

---

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testes unitários (Vitest) |
| `npm run test:e2e` | Testes end-to-end (Playwright) — Etapa 7 |
| `npm run db:start` | Sobe o Supabase local |
| `npm run db:reset` | Recria o banco local e roda o seed |
| `npm run db:push` | Aplica as migrations no projeto vinculado |

---

## Estrutura

```text
src/
  app/
    (app)/            área autenticada; o layout exige sessão e casa ativa
    entrar/           login, cadastro e Server Actions de auth
    nova-casa/        fora de (app) para não criar laço de redirecionamento
    auth/confirmar/   troca o token do e-mail por sessão
  components/
    ui/               botão, campos, card — padrão shadcn/ui
    states.tsx        skeleton, estado vazio, estado de erro
  domain/             regras financeiras puras, sem I/O
  lib/
    money.ts          leitura e formatação de valores; aritmética em centavos
    supabase/         clients de browser e de servidor
    houses.ts         casa ativa e membros
  middleware.ts       renova a sessão e protege as rotas
supabase/
  migrations/         0001 estrutura · 0002 RLS · 0003 auditoria
  seed.sql            dados fictícios — nunca dados reais
  importers/          leitura de fatura: colunas, sinal, mês, duplicidade
tests/unit/           159 testes
```

---

## Decisões de engenharia que valem saber

**Dinheiro em centavos inteiros.** `0.1 + 0.2` em ponto flutuante dá
`0.30000000000000004`. Numa fatura de centenas de linhas isso vira divergência
contra o total impresso pelo banco — justamente o número que a especificação
manda comparar. Todo cálculo em `src/domain` opera em centavos.

**`parseAmount` devolve `null`, não `0`.** Zero é um valor legítimo; usá-lo
como sinal de erro faria a importação engolir linhas quebradas em silêncio.

**Despesa e receita têm funções separadas.** Somar receita com sinal invertido
dentro do total de despesa faz os cards "total gasto" e "receitas" saírem do
mesmo número e nunca fecharem.

**Meses são strings `YYYY-MM`, nunca `Date`.** `new Date("2026-08-01")` é
interpretado como UTC e, no fuso de Brasília, `getMonth()` devolve julho.

**Auditoria por trigger, não pela aplicação.** Assim ela registra também
alterações feitas por script, RPC ou pelo painel do Supabase.

**`audit_log` é append-only.** Não existe policy de UPDATE nem de DELETE; com
RLS ligada, a ausência de policy nega a operação.

**A normalização de estabelecimento existe em SQL e em TypeScript.** O banco
precisa dela para preencher `merchant_normalized` em qualquer gravação; o
importador precisa dela antes de gravar, para agrupar e comparar. As duas
implementações são cobertas pelos mesmos exemplos em
`tests/unit/importers.test.ts` — foi assim que apareceu o bug em que "PAG"
comia o começo de "PAGUE MENOS" (corrigido na migration 0006).

**`viewer` lê e não escreve.** A função `app.can_write()` exclui esse papel, e
todas as policies de escrita passam por ela.

---

## Segurança

- Isolamento entre casas imposto por RLS em todas as 15 tabelas.
- Funções de autorização são `SECURITY DEFINER` para não recursionar nas
  próprias policies, e vivem no schema `app`, fora do PostgREST.
- Logs registram só o código do erro — nunca e-mail, valor ou descrição.
- Mensagens de login são genéricas, para não permitir enumerar quem tem conta.
- O parâmetro `?proximo=` é validado como caminho interno, contra open redirect.
- `SUPABASE_SERVICE_ROLE_KEY` só é legível em código de servidor e não é usada
  por nenhuma rota — existe para scripts administrativos locais.
