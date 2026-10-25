# Design system do Fluxo

O que o app já usa, escrito num lugar só. A fonte da verdade continua sendo o código:
os tokens em `src/app/globals.css` e os componentes em `src/components/ui/`. Se este
arquivo e o código discordarem, vale o código, e este arquivo é que está desatualizado.

A skill `design-audit` lê este arquivo antes de auditar uma tela; a `ui-typography`
segue as regras de texto da última seção.

## Princípios

- Grafite e preto no escuro, branco e cinza claro no claro, um acento índigo. Sem gradiente.
- O tema padrão é o claro. Os tokens de base (em `@theme`) são os do escuro, e o claro só os
  redefine. Nenhum componente sabe em que tema está: quem pinta com `bg-surface` e `text-ink`
  funciona nos dois.
- Vermelho é reservado para excesso e erro, nunca é cor decorativa.
- A cor nunca carrega a informação sozinha. O tom de um alerta também vai no ícone, no título
  e na etiqueta (atenção e perigo se confundem no tema claro para quem tem daltonismo).
- Todo contraste de texto é medido e passa em AA nos dois temas. Os números estão nos
  comentários de `globals.css`; um token novo entra com a medição dele.

## Cores

Use sempre o token (`bg-surface-2`, `text-ink-muted`, `border-line`), nunca o hexadecimal.

| Token | Para quê | Escuro | Claro |
| --- | --- | --- | --- |
| `canvas` | fundo da página | `#08090c` | `#f4f5f8` |
| `surface` | cartão | `#101219` | `#ffffff` |
| `surface-2` | bloco dentro do cartão, hover | `#171a23` | `#eef0f4` |
| `surface-3` | botão secundário, skeleton | `#1f232e` | `#e2e5ec` |
| `line` | borda padrão | `#262a36` | `#dcdfe6` |
| `line-strong` | borda de controle, hover do secundário | `#343a49` | `#c3c8d2` |
| `ink` | texto principal | `#f3f4f8` | `#15171d` |
| `ink-muted` | texto secundário | `#9aa0b0` | `#4b5160` |
| `ink-faint` | legenda, descrição | `#858b9b` | `#5c6271` |
| `brand` | ação principal, foco, link | `#7c86ff` | `#3d45bd` |
| `brand-soft` | fundo de item ativo | `#2a2d4d` | `#e5e7ff` |
| `on-brand` | texto sobre `brand` | `#08090c` | `#ffffff` |
| `positive` / `-soft` | estorno, abaixo do normal, ok | `#35d29a` / `#12352b` | `#065c3e` / `#d6f1e5` |
| `info` | receita (dinheiro que entrou) | `#6cb6ff` | `#1f5fbf` |
| `attention` / `-soft` | aviso, parcial | `#f2b23c` / `#3a2e13` | `#704600` / `#faebcc` |
| `danger` / `-soft` | excesso, erro | `#f2686b` / `#3c1c20` | `#9c272c` / `#fbe1e2` |
| `danger-fill` | fundo do botão de perigo | `#c9383c` | `#9c272c` |
| `doria` | a Dori (botão central, avatar) | `#7c86ff` nos dois | |
| `meta` / `meta-feita` | barra de meta em andamento / alcançada | `#7c86ff` / `#35d29a` nos dois | |
| `on-meta` | porcentagem sobre a barra de meta | `#08090c` nos dois | |

Etiquetas translúcidas (`bg-attention/15` e parentes) também foram medidas: o texto passa sobre
elas em `surface-2`.

### Escalas de gráfico

- **Calendário de gastos** (`day-1` a `day-4`): um matiz só, e mais gasto é mais escuro. Foi
  invertida a pedido de quem usa. Dia sem gasto fica sem preenchimento: a diferença entre
  "gastou pouco" e "não gastou" é ter ou não ter cor. O número usa `on-day-dark` nos dois
  primeiros passos e `on-day-light` nos dois últimos.
- **Matriz mês × categoria** (`cell-below`, `cell-typical`, `cell-above`): divergente, com o
  meio em cinza. Os tokens `-soft` reprovaram aqui (Delta E baixo demais).
- **Projeção** (`chart-in`, `chart-out`): recebido e gasto, validados para daltonismo.
- **Barra de medida** (`MedidaBar` em `components/insights/insight-card.tsx`): cinza até a
  referência, o excesso na cor do tom, o que falta para a referência tracejado. A geometria
  nunca sai do cartão (mês negativo fica em zero).
- **Faixas e barras de categoria** (`Ramos`, `Barras` no Início): cor lisa, sem degradê e sem
  sombra. A porcentagem usa a tinta que der mais contraste com a cor (`tintaSobre`); a faixa
  tem no mínimo 44px, para a porcentagem caber.

## Tipografia

- Fonte: Instrument Sans (400, 500, 600, 700), servida pelo próprio app via `next/font`.
- Escala de seis passos, e só:

| Classe | Tamanho / entrelinha | Uso |
| --- | --- | --- |
| `text-legenda` | 12 / 16px | legenda, metadado, etiqueta |
| `text-corpo` | 14 / 20px | texto corrido, linhas de lista |
| `text-destaque` | 16 / 24px | título de cartão (`CardHeader`) |
| `text-titulo` | 20 / 28px | título de página |
| `text-numero` | 26 / 32px | número de destaque |
| `text-principal` | 38 / 42px | o número principal da tela |

- Valores em dinheiro levam `.tabular` (algarismos de largura fixa), para não "pular" quando
  o total muda.
- Rótulo em caixa alta leva espaçamento entre letras, de 5% a 12% (`tracking-[0.08em]` é o
  comum). Hoje o valor varia; ver as divergências.

## Forma e espaço

- Raio: `rounded-(--radius-card)` (16px) no cartão, `rounded-(--radius-control)` (10px) em
  botão e campo, `rounded-full` em etiqueta, avatar e chip.
- Cartão (`Card`): `border-line`, `bg-surface`, `p-4` no celular e `p-5` a partir de `sm`.
  Sem sombra: é a borda que separa o cartão do fundo, e ela funciona nos dois temas.
- Espaço entre itens com `gap`. Os passos comuns são `gap-1.5`, `gap-2` e `gap-3`.
- Celular primeiro: tudo é testado em 375px de largura antes do desktop.

## Componentes

- `Button` (`ui/button.tsx`): variantes `default`, `secondary`, `outline`, `ghost`, `danger` e
  `link`. Tamanhos `default` (altura mínima de 44px, o alvo de toque), `sm`, `lg` e `icon`
  (44 × 44px). Ícone dentro do botão em `size-4`.
- `Card` / `CardHeader` (`ui/card.tsx`): título em `text-destaque font-semibold`, descrição em
  `text-corpo text-ink-faint`, ação à direita. `nivel={3}` quando o cartão fica sob um rótulo
  de grupo.
- Rótulo de grupo: `text-legenda font-semibold uppercase tracking-[0.08em] text-ink-faint`,
  seguido de uma linha (`h-px flex-1 bg-line`). É o “O mês em detalhe” do Início.
- Aviso (`home/aviso-linha.tsx`): uma linha de lista com ícone num círculo `-soft` do tom,
  rótulo em caixa alta na cor do tom, o texto e a ação. A ação é um link de 44px de altura.
- Links de ação e chips de filtro têm 44px de altura (`min-h-11`), mesmo quando são texto.
- `Dialog` / `ConfirmDialog` (`ui/dialog.tsx`): folha que sobe no celular, caixa centralizada
  a partir de 640px.
- `Field`, `Input`, `Textarea`, `Label` (`ui/field.tsx`) e `Select` (`ui/select.tsx`).
- Estados (`components/states.tsx`): `Skeleton`, `SkeletonValue`, `EmptyState` e `ErrorState`.
  Toda tela com dado tem os três: carregando, vazio e erro.
- Ícones: `lucide-react`, uma biblioteca só.
- Avisos rápidos: `sonner`.

## Movimento

- Entrada de bloco: `.rise` (320ms, sobe 6px).
- Skeleton: `.skeleton`, pulso discreto de 1,6s, sem brilho atravessando a tela.
- Modal: 150 a 260ms (`fluxo-fade-in`, `fluxo-sheet-in`).
- Com "reduzir movimento" ligado no sistema, nenhuma animação roda.

## Acessibilidade

- Foco visível em todo controle: contorno de 2px em `brand` (`:focus-visible`).
- Alvo de toque de pelo menos 44px.
- Contraste AA medido nos dois temas, inclusive sobre as etiquetas translúcidas.
- As barras de medida têm `aria-label` com o valor por escrito; gráfico novo segue o mesmo.

## Texto (pt-BR)

As regras da skill `ui-typography`, ajustadas ao português e ao app:

- Aspas curvas: “assim”, nunca "assim" na tela. No JSX, escreva o caractere direto no texto;
  `“` entre tags aparece literal.
- Intervalo com meia-risca: “7–10 dias”, “jan.–mar.”. Pausa na frase com travessão: “—”.
- Reticências num caractere só: “…”.
- Dinheiro sempre por `formatBRL` / `formatCents` (`lib/money.ts`): o `Intl` do pt-BR já põe o
  espaço que não quebra entre “R$” e o número.
- Multiplicação com “×” (“3 × R$ 50,00”).
- Negrito ou itálico, nunca os dois juntos; sem sublinhado fora de link.
- O modelo de CSS da skill (fonte com serifa, `clamp` no tamanho do corpo) **não** vale aqui:
  a fonte e a escala acima são decisões do app. Mudar a escala é proposta de auditoria, não
  correção automática.

## Divergências conhecidas

O que está fora deste sistema hoje. É a lista de partida da primeira auditoria, não um erro a
corrigir de passagem:

O Início já foi auditado e está dentro do sistema. Fora dele, ainda:

- Tamanhos fora da escala: `text-sm` (95 usos), `text-xl` (13), `text-base` (10), `text-lg` (3)
  e `text-2xl` (4). O próprio `Button` usa `text-sm`, que é igual a `text-corpo` em tamanho.
- Raios fora dos tokens: `rounded-xl` e `rounded-2xl` (5 cada) e `rounded-md` (2).
- Caixa alta com `0.18em` (a marca “Fluxo” no menu e nas telas de entrada, acima dos 12% da
  `ui-typography`) e um `tracking-wide` no chat.
- Sombras soltas (`shadow-[…]`) em quatro lugares fora do Início.

## Decisões e lições

As decisões de design que já foram tomadas e por quê. A skill `design-audit` pede um
`LESSONS.md`; aqui, as lições entram nesta seção.

- O calendário de gastos ficou com “mais gasto é mais escuro”, a pedido de quem usa, apesar de
  a convenção para fundo escuro ser a contrária. O custo foi medido e aceito.
- `ink-faint` foi clareado de `#6b7180` (3,8:1, reprovava) para `#858b9b`.
- O texto sobre o índigo é escuro no tema escuro (branco dava 3,1:1) e branco no claro.
- Barras de medida com valor negativo (mais estorno que gasto) ficam em zero, e o texto explica.
- Número de nota fiscal comprido espremia o nome do produto: o link virou só “nota”, e o número
  foi para o `aria-label`.
- Primeira auditoria (Início, outubro de 2026), com as três fases aprovadas:
  - um cartão só (o do `Card`), em vez de raio de 20px com sombra: no escuro, a sombra não
    aparece e o cartão sumia no fundo;
  - receitas em `info`, não em `positive`;
  - o gasto do mês primeiro; os e-mails do Secretário viraram uma linha de “Pede atenção”;
  - os avisos em lista, sem a aba com losango;
  - ramos e metas sem degradê nem sombra;
  - ao pôr os ramos dentro do cartão, os nomes das categorias ficaram cortados: o desenho
    da esquerda passou de 150px para 120px. Lição: ao mudar o contêiner de um gráfico,
    conferir no celular de 375px com nomes compridos (“Transporte”).
