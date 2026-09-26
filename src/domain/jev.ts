import type { Cents } from "@/lib/money";
import { formatCents } from "@/lib/money";

/**
 * O que o Jev recebe e como a resposta dele vira decisao (secao 15).
 *
 * O Jev nao escreve texto: recebe uma SITUACAO e uma pergunta de escolha, e
 * devolve a opcao escolhida com a probabilidade de cada uma. Este arquivo
 * monta as duas coisas e le a volta. Nao chama rede - quem chama e
 * `lib/jev-classify.ts`.
 *
 * DUAS DECISOES DE DESENHO:
 *
 *   1. A PERGUNTA E POR ESTABELECIMENTO, nunca por lancamento. Doze almocos
 *      no mesmo restaurante sao uma pergunta so, com os numeros dos doze na
 *      situacao - e mais barato, e o Jev decide melhor vendo o padrao do que
 *      vendo uma compra solta.
 *
 *   2. AS OPCOES LEVAM OS EXEMPLOS DA PROPRIA CASA. "TSH" nao diz nada a
 *      ninguem de fora; "TSH - na casa: MERCADOLIVRE, AMAZON, LEROY MERLIN"
 *      diz. E o mesmo que uma pessoa nova na casa precisaria para acertar.
 *
 * E UMA REGRA QUE NAO SE NEGOCIA: palpite do Jev nunca vira regra aprendida
 * sozinho. Regra aprendida e o que a casa DISSE; o Jev so propoe. Quem
 * transforma palpite em regra e a casa, ao confirmar.
 */

/** A partir daqui o palpite de CATEGORIA entra na importacao, marcado. */
export const JEV_MIN_CATEGORIA = 0.6;
/**
 * A partir daqui o palpite de SUBCATEGORIA entra. Mais alto que o da
 * categoria: subcategoria errada engana mais (o almoco de sabado contado
 * como almoco do trabalho), e ficar sem subcategoria nao engana ninguem.
 */
export const JEV_MIN_SUBCATEGORIA = 0.8;
/** Abaixo disto a proposta nem aparece na revisao das subcategorias. */
export const JEV_MIN_PROPOSTA = 0.5;

/** A opcao "nenhuma" das perguntas de subcategoria. */
export const NENHUMA = "nenhuma";

/**
 * O que cada categoria inicial quer dizer, para quem nunca viu a casa.
 *
 * Pelo nome CANONICO (o de `matchCategoryNames`), e nao pelo nome da casa:
 * quem renomeou "Transporte" para "Carro" continua querendo dizer carro,
 * combustivel e pedagio.
 */
const SIGNIFICADO: Record<string, string> = {
  Alimentacao: "comida: restaurante, lanchonete, padaria, delivery, mercado, hortifruti",
  Transporte: "carro e deslocamento: combustível, recarga elétrica, pedágio, estacionamento, Uber, táxi",
  Moradia: "a casa: aluguel, condomínio, luz, água, gás, reforma, material de construção",
  Saude: "saúde: farmácia, consulta, exame, plano de saúde, dentista",
  Educacao: "estudo: curso, escola, faculdade, livro didático",
  Lazer: "diversão: cinema, show, academia, esporte, passeio, livro, jogo",
  Assinaturas: "cobrança recorrente de serviço digital: streaming, app, nuvem, software",
  Compras: "compra de objeto: roupa, eletrônico, loja online, presente",
  Viagens: "viagem: passagem, hotel, milhas, passeio e compra fora da cidade",
  Servicos: "serviço contratado: telefone, internet, contador, conserto, cabeleireiro",
  Tarifas: "cobrança do próprio banco ou cartão: anuidade, juros, IOF, multa",
  Impostos: "imposto e taxa do governo: IPVA, IPTU, DAS do MEI",
  Outros: "o que não se encaixa em nenhuma outra",
};

export interface CategoryOption {
  id: string;
  name: string;
  /** Nome canonico que esta categoria atende, se atende algum. */
  canonical: string | null;
  /** Estabelecimentos que a casa ja pos aqui, do mais frequente ao menos. */
  examples: readonly string[];
}

/** Quantos exemplos da casa entram em cada opcao. Mais que isto e ruido. */
const MAX_EXEMPLOS = 6;

function descricao(option: CategoryOption): string {
  const partes = [option.name];
  const significado = option.canonical ? SIGNIFICADO[option.canonical] : undefined;
  if (significado) partes.push(`(${significado})`);
  const exemplos = option.examples.slice(0, MAX_EXEMPLOS);
  if (exemplos.length > 0) partes.push(`— na casa: ${exemplos.join(", ")}`);
  return partes.join(" ");
}

/**
 * Chave de uma opcao: o nome sem acento, em minusculas.
 *
 * Legivel de proposito - o Jev le a chave junto com a descricao, e "c7" nao
 * diz nada -, e unica por construcao: dois nomes que dariam a mesma chave
 * ganham um sufixo.
 */
function chaveDe(nome: string, usadas: Set<string>): string {
  const base =
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "opcao";
  let chave = base === NENHUMA ? `${base}_` : base;
  for (let i = 2; usadas.has(chave); i += 1) chave = `${base}_${i}`;
  usadas.add(chave);
  return chave;
}

export interface Criteria {
  criteria: Record<string, string>;
  /** chave -> id da categoria. "nenhuma" nao esta aqui. */
  idByKey: Map<string, string>;
}

/** As opcoes da pergunta "em que categoria isto cai?". */
export function categoryCriteria(options: readonly CategoryOption[]): Criteria {
  const usadas = new Set<string>();
  const criteria: Record<string, string> = {};
  const idByKey = new Map<string, string>();
  for (const option of options) {
    const chave = chaveDe(option.name, usadas);
    criteria[chave] = descricao(option);
    idByKey.set(chave, option.id);
  }
  return { criteria, idByKey };
}

/**
 * As opcoes da pergunta "em que subcategoria isto cai?".
 *
 * Sempre com "nenhuma": a maior parte do que esta em Alimentacao nao e nem
 * almoco do trabalho nem fim de semana, e uma pergunta sem saida obrigaria o
 * Jev a escolher uma das duas mesmo assim.
 */
export function subcategoryCriteria(
  parentName: string,
  subs: readonly CategoryOption[],
): Criteria {
  const { criteria, idByKey } = categoryCriteria(subs);
  criteria[NENHUMA] = `Nenhuma destas — fica só em ${parentName}, sem subcategoria`;
  return { criteria, idByKey };
}

export const CATEGORY_INSTRUCTIONS =
  "Em qual categoria de gasto de uma casa esta compra de cartão de crédito se encaixa? Use o nome do estabelecimento como pista principal e os exemplos de cada categoria.";

export function subcategoryInstructions(parentName: string): string {
  return `Esta compra é de ${parentName}. Em qual subcategoria ela se encaixa? Compare com os exemplos de cada uma; se nenhuma servir, escolha "${NENHUMA}".`;
}

// ---------------------------------------------------------------------------
// A situacao
// ---------------------------------------------------------------------------

export interface MerchantEvidence {
  /** Como aparece na fatura. */
  label: string;
  count: number;
  medianCents: Cents;
  /** Fracao das compras em dia util (seg-sex), 0 a 1. */
  weekdayShare: number;
  /** A categoria que o banco mandou no arquivo, se mandou. */
  bankHint: string | null;
}

/**
 * A situacao que o Jev le: o estabelecimento e os numeros dele.
 *
 * So o que ajuda a decidir, e nada que identifique a casa: nome da loja,
 * valor, quantas vezes, em que dias. Nome das pessoas, cartao, data exata e
 * descricao livre ficam de fora.
 */
export function merchantState(e: MerchantEvidence): string {
  const linhas = [`Estabelecimento na fatura: ${e.label}`];
  linhas.push(
    e.count === 1
      ? `Uma compra de ${formatCents(e.medianCents)}.`
      : `${e.count} compras, valor típico de ${formatCents(e.medianCents)}.`,
  );
  if (e.count >= 3) {
    const pct = Math.round(e.weekdayShare * 100);
    linhas.push(`${pct}% das compras em dia útil (segunda a sexta).`);
  }
  if (e.bankHint) {
    // Dito como pista fraca, porque e: sai do ramo cadastrado na maquininha,
    // e ja chamou supermercado de "Associacao".
    linhas.push(`O banco classificou como "${e.bankHint}" (costuma errar).`);
  }
  return linhas.join("\n");
}

/** Mediana de valores em centavos. */
export function medianCents(values: readonly Cents[]): Cents {
  if (values.length === 0) return 0;
  const ordenados = [...values].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? ordenados[meio]!
    : Math.round((ordenados[meio - 1]! + ordenados[meio]!) / 2);
}

/** Fracao das datas (AAAA-MM-DD) que caem de segunda a sexta. */
export function weekdayShare(dates: readonly string[]): number {
  if (dates.length === 0) return 0;
  const uteis = dates.filter((d) => {
    const dia = new Date(`${d.slice(0, 10)}T12:00:00Z`).getUTCDay();
    return dia >= 1 && dia <= 5;
  }).length;
  return uteis / dates.length;
}

// ---------------------------------------------------------------------------
// A volta
// ---------------------------------------------------------------------------

export interface JevPick {
  /** Id da categoria escolhida, ou `null` quando a escolha foi "nenhuma". */
  id: string | null;
  probability: number;
}

/**
 * Le a escolha e diz se ela passa do corte.
 *
 * `null` quando nao passa, ou quando a chave nao corresponde a nada - o
 * cliente ja confere isso, mas esta funcao nao confia em quem a chamou.
 */
export function readPick(
  answer: { choice: string; probabilities: Record<string, number> } | undefined,
  idByKey: ReadonlyMap<string, string>,
  minProbability: number,
): JevPick | null {
  if (!answer) return null;
  const probability = answer.probabilities[answer.choice];
  if (probability === undefined || probability < minProbability) return null;
  if (answer.choice === NENHUMA) return { id: null, probability };
  const id = idByKey.get(answer.choice);
  return id ? { id, probability } : null;
}

/** "87%" - como a probabilidade aparece na tela. */
export function probabilityLabel(p: number): string {
  return `${Math.round(p * 100)}%`;
}

// ---------------------------------------------------------------------------
// Uma pergunta por estabelecimento
// ---------------------------------------------------------------------------

export interface JevCategories {
  parents: readonly CategoryOption[];
  subsByParent: ReadonlyMap<string, readonly CategoryOption[]>;
  nameById: ReadonlyMap<string, string>;
}

export interface MerchantAsk {
  /** Estabelecimento normalizado - a mesma chave das regras aprendidas. */
  merchant: string;
  evidence: MerchantEvidence;
  /**
   * Categoria ja decidida por fonte forte (regra, nome da loja). Com ela, so
   * a subcategoria e perguntada; sem ela, as duas.
   */
  knownCategoryId: string | null;
}

/** O formato de pergunta que `lib/openrouter.ts` manda. */
export interface ChoiceQuestionShape {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface BuiltQuestions {
  questions: Record<string, ChoiceQuestionShape>;
  category: Criteria | null;
  /** nome da pergunta -> [id da categoria-mae, opcoes]. */
  subs: Map<string, { parentId: string; criteria: Criteria }>;
}

/**
 * As perguntas de um estabelecimento, numa chamada so.
 *
 * Quando a categoria ainda nao e conhecida, vai tambem uma pergunta de
 * subcategoria para CADA categoria que tem subcategorias - antes de saber a
 * resposta da primeira. Parece desperdicio, e e o contrario: a pergunta a
 * mais custa centavos de milesimo (o Jev cobra so a entrada), e esperar a
 * primeira resposta para fazer a segunda dobraria o tempo da revisao.
 *
 * `null` quando nao ha o que perguntar: categoria conhecida e sem
 * subcategorias.
 */
export function buildQuestions(
  ask: MerchantAsk,
  cats: JevCategories,
): BuiltQuestions | null {
  const questions: Record<string, ChoiceQuestionShape> = {};
  const subs = new Map<string, { parentId: string; criteria: Criteria }>();
  let category: Criteria | null = null;

  if (ask.knownCategoryId === null) {
    if (cats.parents.length < 2) return null;
    category = categoryCriteria(cats.parents);
    questions.categoria = {
      type: "choice",
      instructions: CATEGORY_INSTRUCTIONS,
      criteria: category.criteria,
    };
  }

  const parentes =
    ask.knownCategoryId === null
      ? [...cats.subsByParent.keys()]
      : cats.subsByParent.has(ask.knownCategoryId)
        ? [ask.knownCategoryId]
        : [];
  parentes.forEach((parentId, i) => {
    const opcoes = cats.subsByParent.get(parentId) ?? [];
    if (opcoes.length === 0) return;
    const nomePai = cats.nameById.get(parentId) ?? "a categoria";
    const criteria = subcategoryCriteria(nomePai, opcoes);
    const nome = `sub_${i + 1}`;
    questions[nome] = {
      type: "choice",
      instructions: subcategoryInstructions(nomePai),
      criteria: criteria.criteria,
    };
    subs.set(nome, { parentId, criteria });
  });

  if (Object.keys(questions).length === 0) return null;
  return { questions, category, subs };
}

export interface MerchantVerdict {
  /** Categoria que o Jev escolheu, quando ela foi perguntada e passou do corte. */
  categoryId: string | null;
  categoryProbability: number | null;
  subcategoryId: string | null;
  subcategoryProbability: number | null;
}

/**
 * O que fazer com as respostas de um estabelecimento.
 *
 * A subcategoria so vale sob a categoria que ficou: a pergunta de
 * subcategoria de Alimentacao foi feita junto, mas se a categoria escolhida
 * foi Transporte, a resposta dela e descartada.
 */
export function readVerdict(
  answers: Record<string, { choice: string; probabilities: Record<string, number> }>,
  built: BuiltQuestions,
  ask: MerchantAsk,
  thresholds: { category: number; subcategory: number } = {
    category: JEV_MIN_CATEGORIA,
    subcategory: JEV_MIN_SUBCATEGORIA,
  },
): MerchantVerdict {
  const cat = built.category
    ? readPick(answers.categoria, built.category.idByKey, thresholds.category)
    : null;
  const parentId = ask.knownCategoryId ?? cat?.id ?? null;

  let sub: JevPick | null = null;
  for (const [nome, { parentId: pai, criteria }] of built.subs) {
    if (pai !== parentId) continue;
    sub = readPick(answers[nome], criteria.idByKey, thresholds.subcategory);
  }

  return {
    categoryId: cat?.id ?? null,
    categoryProbability: cat?.probability ?? null,
    subcategoryId: sub?.id ?? null,
    subcategoryProbability: sub && sub.id !== null ? sub.probability : null,
  };
}

// ---------------------------------------------------------------------------
// Na importacao
// ---------------------------------------------------------------------------

export interface ImportRowForJev {
  merchantNormalized: string;
  merchantOriginal: string;
  description: string;
  amountCents: Cents;
  date: string;
  categoryHint: string | null;
  categoryId: string | null;
  /**
   * A categoria veio de fonte fraca: a dica do banco, ou nenhuma. E so
   * nesses casos que o Jev pode TROCAR a categoria - regra aprendida e nome
   * de loja conhecido vencem qualquer palpite.
   */
  weak: boolean;
  /** Uma regra aprendida ja decide a subcategoria desta loja. */
  ruleDecidesSubcategory: boolean;
}

/**
 * Quais estabelecimentos da fatura vao ao Jev, e o que perguntar de cada um.
 *
 * Os mais frequentes primeiro: se o teto de chamadas cortar a lista, corta a
 * loja que aparece uma vez, e nao a que aparece doze.
 */
export function importAsks(
  rows: readonly ImportRowForJev[],
  subsByParent: ReadonlyMap<string, readonly CategoryOption[]>,
): MerchantAsk[] {
  const grupos = new Map<string, ImportRowForJev[]>();
  for (const r of rows) {
    if (!r.merchantNormalized) continue;
    const g = grupos.get(r.merchantNormalized) ?? [];
    g.push(r);
    grupos.set(r.merchantNormalized, g);
  }

  const asks: MerchantAsk[] = [];
  for (const [merchant, g] of grupos) {
    const primeira = g[0]!;
    const fraca = g.some((r) => r.weak);
    if (!fraca) {
      // Categoria firme: so vale perguntar a subcategoria, e so se a
      // categoria tem subcategorias e nenhuma regra ja decide.
      if (primeira.categoryId === null) continue;
      if (!subsByParent.has(primeira.categoryId)) continue;
      if (g.some((r) => r.ruleDecidesSubcategory)) continue;
    }
    asks.push({
      merchant,
      knownCategoryId: fraca ? null : primeira.categoryId,
      evidence: {
        label: primeira.merchantOriginal || primeira.description,
        count: g.length,
        medianCents: medianCents(g.map((r) => r.amountCents)),
        weekdayShare: weekdayShare(g.map((r) => r.date)),
        bankHint: g.find((r) => r.categoryHint)?.categoryHint ?? null,
      },
    });
  }
  return asks.sort((a, b) => b.evidence.count - a.evidence.count);
}

// ---------------------------------------------------------------------------
// De quem e o cartao
// ---------------------------------------------------------------------------

/** A partir daqui a sugestao de dono aparece. Dono errado distorce o filtro inteiro. */
export const JEV_MIN_DONO = 0.7;

export interface OwnerProfile {
  id: string;
  firstName: string;
  /** Lojas tipicas da pessoa, da mais frequente para a menos. */
  examples: readonly string[];
}

/**
 * As opcoes da pergunta "de quem e este cartao?".
 *
 * Os exemplos de cada pessoa saem do que ja e dela - marcado com ela, ou nos
 * cartoes dela - e so as lojas que SO ela usa: loja que os dois frequentam
 * nao ajuda a separar, so empata.
 */
export function ownerCriteria(profiles: readonly OwnerProfile[]): Criteria {
  const contagem = new Map<string, number>();
  for (const p of profiles) for (const e of new Set(p.examples)) contagem.set(e, (contagem.get(e) ?? 0) + 1);
  return categoryCriteria(
    profiles.map((p) => {
      const proprias = p.examples.filter((e) => contagem.get(e) === 1);
      return {
        id: p.id,
        name: p.firstName,
        canonical: null,
        examples: proprias.length > 0 ? proprias : p.examples,
      };
    }),
  );
}

export const OWNER_INSTRUCTIONS =
  "De qual pessoa da casa é este cartão de crédito? Compare as lojas do cartão com as lojas típicas de cada pessoa. Nomes ou apelidos dentro do nome da loja são uma pista forte.";

/** A situacao: as lojas do cartao, com quantas vezes aparecem. Sem o final dele. */
export function cardState(merchants: readonly { label: string; count: number }[]): string {
  const lista = merchants.slice(0, 15).map((m) => `${m.label} (${m.count}x)`);
  return `Lojas mais frequentes neste cartão:\n${lista.join("\n")}`;
}
