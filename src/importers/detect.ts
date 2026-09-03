import type { MonthKey, TransactionType } from "@/domain/types";
import type { Cents } from "@/lib/money";
import { isMonthKey } from "@/domain/month";
import type { ColumnMap, SignConvention } from "./types";

/**
 * Heurísticas de leitura de fatura.
 *
 * Tudo aqui é sugestão, nunca decisão final: a tela de revisão mostra o que
 * foi inferido e deixa o usuário corrigir antes de gravar (secao 6).
 */

// --------------------------------------------------------------------------
// Normalização de estabelecimento
// --------------------------------------------------------------------------

/**
 * Prefixos de adquirente que aparecem colados no nome da loja.
 *
 * O separador é obrigatório - `*` ou espaço. Sem essa exigência, "PAG"
 * casaria com o começo de "PAGUE MENOS" e a loja viraria "UE MENOS".
 */
const ACQUIRER_PREFIX =
  /^\s*(PG|DL|PAG|PGTO|COMPRA|CB|EC|MP|PP|IFD|APL)(?:\s*\*\s*|\s+)/;
/** Sufixo de parcela: "3/12", "- Parcela 3/12". */
const INSTALLMENT_SUFFIX = /\s*-?\s*(PARCELA\s*)?\d{1,2}\s*\/\s*\d{1,2}\s*$/;
/** Faixa de acentos combinantes, removida após a decomposição NFD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * Mesma normalização de `app.normalize_merchant` no banco.
 *
 * Existe em duas linguagens de propósito: o banco precisa dela para preencher
 * `merchant_normalized` em qualquer gravação (inclusive por script), e o
 * importador precisa dela antes de gravar, para agrupar e comparar. As duas
 * implementações são cobertas pelos mesmos exemplos nos testes.
 */
export function normalizeMerchant(raw: string): string {
  return stripAccents(raw)
    .toUpperCase()
    .replace(ACQUIRER_PREFIX, "")
    .replace(INSTALLMENT_SUFFIX, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Identidade de um lançamento para efeito de duplicidade (secao 6).
 *
 * Inclui mês da fatura, data, cartão e parcela justamente para NÃO colapsar
 * compras legítimas repetidas: a mesma assinatura em meses diferentes, ou a
 * parcela 3/10 e a 4/10, têm chaves distintas.
 */
export function duplicateKey(input: {
  invoiceMonth: MonthKey;
  date: string;
  merchantNormalized: string;
  amountCents: Cents;
  cardId?: string | null;
  installmentCurrent?: number | null;
  installmentTotal?: number | null;
}): string {
  return [
    input.invoiceMonth,
    input.date,
    input.merchantNormalized,
    String(input.amountCents),
    input.cardId ?? "",
    input.installmentCurrent ?? "",
    input.installmentTotal ?? "",
  ].join("|");
}

// --------------------------------------------------------------------------
// Parcela dentro da descrição
// --------------------------------------------------------------------------

const INSTALLMENT_IN_TEXT = /(?:parcela\s*)?\b(\d{1,2})\s*\/\s*(\d{1,2})\b/i;

/** Extrai "3/12" de "NETFLIX 3/12". Devolve `null` quando não há parcela. */
export function extractInstallment(
  description: string,
): { current: number; total: number } | null {
  const match = description.match(INSTALLMENT_IN_TEXT);
  if (!match) return null;

  const current = Number(match[1]);
  const total = Number(match[2]);
  // "12/2026" numa descrição é data, não parcela: a parcela atual nunca passa
  // do total, e nenhuma compra é dividida em mais de 99 vezes.
  if (current < 1 || total < 1 || current > total) return null;
  return { current, total };
}

// --------------------------------------------------------------------------
// Mês pelo nome do arquivo
// --------------------------------------------------------------------------

const MONTH_NAMES: Record<string, string> = {
  jan: "01", janeiro: "01",
  fev: "02", fevereiro: "02",
  mar: "03", marco: "03",
  abr: "04", abril: "04",
  mai: "05", maio: "05",
  jun: "06", junho: "06",
  jul: "07", julho: "07",
  ago: "08", agosto: "08",
  set: "09", setembro: "09",
  out: "10", outubro: "10",
  nov: "11", novembro: "11",
  dez: "12", dezembro: "12",
};

/**
 * Descobre o mês pelo nome do arquivo.
 *
 * Reconhece `2026-08`, `08-2026`, `202608`, `20260105` e nomes de mês em
 * português ("agosto-2026", "ago_2026"). Devolve `null` quando não há certeza
 * - e aí a tela pede o mês, em vez de chutar.
 */
export function monthFromFilename(fileName: string): MonthKey | null {
  const name = stripAccents(fileName.replace(/\.[a-z0-9]+$/i, "")).toLowerCase();

  // 2026-08 / 2026_08 / 2026.08, com um dia opcional que é ignorado.
  const iso = name.match(/(20\d{2})[-_.](0[1-9]|1[0-2])(?:[-_.]\d{1,2})?/);
  if (iso) return `${iso[1]}-${iso[2]}`;

  // 08-2026 / 08_2026. Sem `\b`: "_" conta como caractere de palavra, então
  // não existe fronteira entre "fatura_" e "08" e a busca falhava nesse nome.
  const br = name.match(/(?<!\d)(0[1-9]|1[0-2])[-_.](20\d{2})(?!\d)/);
  if (br) return `${br[2]}-${br[1]}`;

  // agosto2026 / ago-2026 / 2026 agosto
  const named = name.match(
    /\b([a-z]{3,9})[-_. ]*(20\d{2})\b|\b(20\d{2})[-_. ]*([a-z]{3,9})\b/,
  );
  if (named) {
    const word = named[1] ?? named[4] ?? "";
    const year = named[2] ?? named[3];
    const month = MONTH_NAMES[word];
    if (month && year) return `${year}-${month}`;
  }

  // 20260105 colado, o nome que o Itaú dá ao arquivo: é a data de vencimento,
  // e o mês dela é o mês da fatura. Vem antes do formato de 6 dígitos porque
  // "202601" também casaria com o começo de "20260105", pelo mês errado.
  const compactDay = name.match(
    /(?<!\d)(20\d{2})(0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?!\d)/,
  );
  if (compactDay) return `${compactDay[1]}-${compactDay[2]}`;

  // 202608 colado - exige que não seja pedaço de um número maior.
  const compact = name.match(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
  if (compact) return `${compact[1]}-${compact[2]}`;

  return null;
}

/** Mês mais frequente entre as datas lidas - usado quando o nome não diz. */
export function monthFromDates(dates: readonly string[]): MonthKey | null {
  const counts = new Map<MonthKey, number>();
  for (const date of dates) {
    const month = date.slice(0, 7);
    if (!isMonthKey(month)) continue;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }

  let best: MonthKey | null = null;
  let bestCount = 0;
  for (const [month, count] of counts) {
    if (count > bestCount) {
      best = month;
      bestCount = count;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// Colunas
// --------------------------------------------------------------------------

const HEADER_HINTS: Record<keyof ColumnMap, readonly string[]> = {
  date: ["date", "data", "data da compra", "datacompra", "data transacao"],
  description: [
    "title", "descricao", "description", "estabelecimento",
    "historico", "lancamento", "detalhe",
  ],
  amount: ["amount", "valor", "value", "valor (r$)", "montante"],
  category: ["category", "categoria"],
  installment: ["installment", "parcela", "parcelas"],
  card: ["final do cartao", "final cartao", "cartao final", "final", "card"],
};

function normalizeHeader(header: string): string {
  return stripAccents(header)
    .toLowerCase()
    // O "$" sobrevive de propósito: é ele que separa "Valor (em R$)" de
    // "Valor (em US$)" numa fatura internacional.
    .replace(/[^a-z0-9 ()$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Marcas de que a coluna está em real - a moeda que o app registra. */
const LOCAL_CURRENCY = /(?:^|[^a-z])r\$|\breais?\b|\bbrl\b/;
/**
 * Marcas de moeda estrangeira ou de câmbio.
 *
 * É o caso que zerava a fatura inteira: a fatura do Itaú traz
 * "Valor (em US$)" ANTES de "Valor (em R$)", e as duas começam com "valor".
 * Pegando a primeira, toda compra nacional (US$ 0) virava R$ 0,00.
 */
const FOREIGN_CURRENCY =
  /us\$|\busd?\b|\bdolar(?:es)?\b|\bdollars?\b|\beur\b|\beuros?\b|\bmoeda estrangeira\b|\binternacional\b/;
/** Colunas que acompanham o valor sem serem o valor. */
const RATE_COLUMN = /\bcotacao\b|\bcambio\b|\btaxa\b|\biof\b/;

/**
 * Quanto um cabeçalho combina com um papel. `null` = não é candidato.
 *
 * A pontuação existe porque um arquivo pode ter mais de uma coluna plausível
 * para o mesmo papel, e a primeira nem sempre é a certa.
 */
function scoreHeader(role: keyof ColumnMap, key: string): number | null {
  const hints = HEADER_HINTS[role];
  let score: number;
  if (hints.includes(key)) score = 10;
  else if (hints.some((hint) => key.startsWith(hint))) score = 5;
  else return null;

  if (role === "amount") {
    if (LOCAL_CURRENCY.test(key)) score += 4;
    if (FOREIGN_CURRENCY.test(key)) score -= 8;
    if (RATE_COLUMN.test(key)) score -= 12;
  }
  return score;
}

/**
 * Casa os cabeçalhos do arquivo com os papéis que o importador entende.
 *
 * Empate resolve pela ordem do arquivo, para o resultado ser estável.
 */
export function detectColumns(headers: readonly string[]): ColumnMap {
  const map: ColumnMap = {
    date: null,
    description: null,
    amount: null,
    category: null,
    installment: null,
    card: null,
  };
  const normalized = headers.map((h) => ({ raw: h, key: normalizeHeader(h) }));

  for (const role of Object.keys(HEADER_HINTS) as (keyof ColumnMap)[]) {
    let best: { raw: string; score: number } | null = null;
    for (const header of normalized) {
      const score = scoreHeader(role, header.key);
      if (score === null) continue;
      if (best === null || score > best.score) {
        best = { raw: header.raw, score };
      }
    }
    if (best) map[role] = best.raw;
  }
  return map;
}

// --------------------------------------------------------------------------
// Parcela e cartão em coluna própria
// --------------------------------------------------------------------------

/** "Única", "À vista", "-" e afins: compra sem parcelamento. */
const SINGLE_PAYMENT = /^(unica|a vista|avista|-|0|nao|sem parcela)$/;

/**
 * Lê a parcela de uma coluna dedicada ("2/12", "2 de 12", "Única").
 *
 * Vale mais que a descrição quando existe: "ADAPTAORG" não diz nada, mas a
 * coluna ao lado diz "2/12".
 */
export function parseInstallmentCell(
  raw: string,
): { current: number; total: number } | null {
  const key = stripAccents(raw)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^parcela\s*/, "")
    .trim();
  if (key === "" || SINGLE_PAYMENT.test(key)) return null;

  // Ancorado nas duas pontas: a célula é a parcela e nada mais. Sem isso
  // "12/2026" numa coluna mal preenchida viraria a parcela 12 de 20.
  const match = key.match(/^(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})$/);
  if (!match) return null;

  const current = Number(match[1]);
  const total = Number(match[2]);
  if (current < 1 || total < 1 || current > total) return null;
  return { current, total };
}

/**
 * Últimos 4 dígitos de uma coluna de cartão ("2150", "**** 2150").
 *
 * Devolve `null` para qualquer coisa que não termine em 4 dígitos - o nome do
 * titular, por exemplo, se a detecção de coluna tiver errado.
 */
export function parseCardLastFour(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

// --------------------------------------------------------------------------
// Categoria do banco -> categoria da casa
// --------------------------------------------------------------------------

/**
 * Traduz o vocabulário de categoria do banco para o das categorias iniciais.
 *
 * O importador já usava a coluna de categoria do arquivo, mas só por nome
 * exato - e nome exato quase nunca bate. O Itaú escreve "Supermercados /
 * Mercearia / Padarias / Lojas de Conveniência" onde a casa tem "Alimentação";
 * das 24 categorias daquela fatura, só "Transporte" coincidia. Resultado: 96
 * lançamentos entravam sem categoria.
 *
 * A ordem importa: a primeira regra que casar vence, então o específico vem
 * antes do genérico ("telecomunicações" antes de "serviços").
 *
 * Continua sendo palpite: a tela de revisão mostra a categoria de cada linha
 * antes de gravar, e o nome só vira categoria de verdade se a casa tiver uma
 * com aquele nome.
 */
const CATEGORY_SYNONYMS: readonly { pattern: RegExp; category: string }[] = [
  { pattern: /supermercado|mercearia|padaria|conveniencia|restaurante|lanchonete|\bbar\b|alimenta|bebida|delivery/, category: "Alimentacao" },
  { pattern: /combustivel|\bposto\b|estacionamento|pedagio|\btaxi\b|automotivo|transporte|passagem|mobilidade/, category: "Transporte" },
  { pattern: /telecomunica|telefonia|internet|provedor/, category: "Servicos" },
  { pattern: /tv por assinatura|streaming|assinatura|radio/, category: "Assinaturas" },
  { pattern: /medic|odontolog|\bsaude\b|farmacia|drogaria|hospital|laboratorio/, category: "Saude" },
  { pattern: /educa|ensino|escola|faculdade|universidade|\bcurso\b|livraria/, category: "Educacao" },
  { pattern: /entretenimento|recreativ|lazer|cinema|\bjogo|\barte\b|artesanato|passatempo|associacao|clube|esporte|academia/, category: "Lazer" },
  { pattern: /viagem|hotel|hospedagem|aere|turismo|locadora/, category: "Viagens" },
  { pattern: /mobiliario|\bmoveis\b|construcao|imobiliar|aluguel|moradia|condominio|energia eletrica|\bagua\b|utilidade publica/, category: "Moradia" },
  { pattern: /varejo|departamento|desconto|magazine|vestuario|calcado|\bloja\b|marketing direto|\bpet\b/, category: "Compras" },
  { pattern: /tarifa|anuidade|\bjuros\b|encargo|\biof\b|\bmulta\b|seguro/, category: "Tarifas" },
  { pattern: /imposto|tributo|\btaxa\b/, category: "Impostos" },
  { pattern: /servico|profission|empresa|eletric|eletronic|tecnologia|software/, category: "Servicos" },
];

/**
 * Categoria pelo nome do estabelecimento.
 *
 * Vale MAIS que a categoria do banco, e não menos: a do banco vem do código
 * de atividade da maquininha e erra muito. Na fatura que motivou esta tabela,
 * o Itaú classificou "ELETROGRAAL" (recarga de carro elétrico) como Serviços
 * Profissionais, "ASSAI ATACADISTA" como Associação, "CARREFOUR" como
 * Automotivo e "RESTAURANTE E LANCHONE" como Supermercados. O nome da loja é
 * o que a pessoa reconhece, e é o sinal mais confiável dos dois.
 *
 * A ordem é a regra: a primeira que casar vence, então o específico vem antes
 * do genérico. "MERCADOLIVRE" tem que ser testado antes de "MERCADO", senão
 * toda compra de marketplace viraria supermercado; "UBER EATS" antes de
 * "UBER"; combustível antes de rede de supermercado, porque "CARREFOUR PRT" é
 * o posto do Carrefour.
 *
 * Entra aqui só o que é reconhecível sem contexto. Nome de pessoa, sigla e
 * código de maquininha ficam de fora - nesses casos a dica do banco assume, e
 * se ela também não servir a linha fica sem categoria, que é melhor que
 * catalogar errado. Corrigir à mão grava uma regra aprendida, e a partir daí
 * aquele estabelecimento não erra mais.
 *
 * O texto recebido já passou por `normalizeMerchant`: maiúsculas, sem acento
 * e sem pontuação. Por isso "EC *TUPINAMBAENER" chega como "TUPINAMBAENER".
 */
const MERCHANT_RULES: readonly { pattern: RegExp; category: string }[] = [
  // --- Marketplaces e varejo, antes de qualquer palavra genérica ----------
  { pattern: /MERCADO\s?LIVRE|MERCADOLIVRE|MERCADOPAGO/, category: "Compras" },
  { pattern: /AMAZON|MAGAZINE\s?LUIZA|MAGALU|AMERICANAS|SHOPEE|ALIEXPRESS|SHEIN|TIKTOK\s?SHOP|POLISHOP|CASAS\s?BAHIA|PONTO\s?FRIO/, category: "Compras" },
  { pattern: /\bPETZ\b|PETLOVE|COBASI|\bPETSHOP\b/, category: "Compras" },
  { pattern: /UBIQUITI|KABUM|PICHAU|TERABYTE/, category: "Compras" },

  // --- Comida: entrega e restaurante antes das redes de mercado ----------
  { pattern: /UBER\s?EATS|IFOOD|RAPPI|ZE\s?DELIVERY|AIQFOME/, category: "Alimentacao" },
  { pattern: /RESTAURANTE|LANCHONETE|PIZZA|BURGER|HAMBURG|SUSHI|CHURRASC|CANTINA|\bGRILL\b|\bBAR\b|\bBOTECO\b|\bPUB\b/, category: "Alimentacao" },
  { pattern: /PADARIA|CONFEITARIA|\bCAFE\b|CAFETERIA|STARBUCKS|CHURROS|GELATO|SORVET|ACAI|DOCERIA/, category: "Alimentacao" },
  { pattern: /OUTBACK|MCDONALD|BURGER\s?KING|SUBWAY|HABIBS|GIRAFFAS|SPOLETO|DIVINO\s?FOGAO/, category: "Alimentacao" },

  // --- Transporte: combustível e recarga antes de rede de supermercado ---
  { pattern: /RECARGA\s?VE|ELETROPOSTO|EZVOLT|ELETROGRAAL|TUPINAMBAENER|VOLTBRAS|WEG\s?MOBILIDADE/, category: "Transporte" },
  // Posto de rede de supermercado: sem esta linha "CARREFOUR PRT" cairia na
  // regra da rede, logo abaixo, e abastecer viraria compra de mercado.
  { pattern: /CARREFOUR\s?PRT|POSTO\s?CARREFOUR|POSTO\s?EXTRA/, category: "Transporte" },
  { pattern: /\bPOSTO\b|AUTO\s?POSTO|COMBUSTIVEL|IPIRANGA|\bSHELL\b|PETROBRAS|BR\s?MANIA|ALESAT/, category: "Transporte" },
  { pattern: /ESTACIONAMENTO|ALLPARK|ESTAPAR|\bZUL\b|PARKING|\bPEDAGIO\b|SEM\s?PARAR|CONECTCAR|VELOE/, category: "Transporte" },
  { pattern: /\bUBER\b|\b99\s?APP\b|\b99APP\b|CABIFY|\bTAXI\b|TEMBICI|YELLOW|BIKE\s?ITAU|METRO\s?SP|BILHETE\s?UNICO/, category: "Transporte" },
  { pattern: /\bBYD\b|LOCALIZA|MOVIDA|UNIDAS|PORTO\s?SEGURO\s?AUTO|AUTO\s?PECAS|PNEU/, category: "Transporte" },

  // --- Supermercado, depois de combustível e marketplace -----------------
  { pattern: /SUPERMERCADO|MERCEARIA|HORTIFRUTI|ACOUGUE|EMPORIO|CONVENIENC|ATACADIST/, category: "Alimentacao" },
  { pattern: /CARREFOUR|\bASSAI\b|ATACADAO|PAO\s?DE\s?ACUCAR|\bSENDAS\b|\bSONDA\b|\bMAMBO\b|ST\s?MARCHE|OXXO|\bZAFFARI\b|ANGELONI/, category: "Alimentacao" },

  // --- Assinaturas -------------------------------------------------------
  { pattern: /\bGOOGLE\b|\bAPPLE\b|ITUNES|MICROSOFT|OPENAI|ANTHROPIC|\bCLAUDE\b|CHATGPT/, category: "Assinaturas" },
  { pattern: /NETFLIX|SPOTIFY|HBO\s?MAX|HBOMAX|DISNEY|PARAMOUNT|DEEZER|PRIME\s?VIDEO|CRUNCHYROLL|TWITCH|\bSTEAM\b|PLAYSTATION|\bXBOX\b/, category: "Assinaturas" },
  { pattern: /HOME\s?ASSISTANT|DROPBOX|NOTION|CANVA|ADOBE|FIGMA|GITHUB|VERCEL|SUPABASE/, category: "Assinaturas" },

  // --- Saúde -------------------------------------------------------------
  { pattern: /DROGARIA|DROGASIL|DROGA\s?RAIA|FARMACIA|PACHECO|PAGUE\s?MENOS|\bVENANCIO\b/, category: "Saude" },
  { pattern: /HOSPITAL|CLINICA|LABORATORIO|ODONTO|DENTAL|\bUNIMED\b|AMIL|FLEURY|\bDASA\b|PSICOLOG|FISIOTERAP/, category: "Saude" },

  // --- Moradia -----------------------------------------------------------
  { pattern: /LEROY\s?MERLIN|TELHANORTE|CONSTRUCAO|MATERIAL\s?DE\s?CONSTR|TOK\s?STOK|MOBLY|MADEIRA\s?MADEIRA/, category: "Moradia" },
  { pattern: /CONDOMINIO|\bENEL\b|\bSABESP\b|COMGAS|\bCPFL\b|\bLIGHT\b|COPASA|CEMIG|ELETROPAULO/, category: "Moradia" },

  // --- Viagens -----------------------------------------------------------
  { pattern: /AIRBNB|BOOKING|DECOLAR|\bLATAM\b|GOL\s?LINHAS|AZUL\s?LINHAS|AZUL\s?VIAGENS|SMILES|HOTEL|POUSADA|HOSTEL|\bCVC\b/, category: "Viagens" },

  // --- Lazer -------------------------------------------------------------
  { pattern: /SPORTCLUB|SMART\s?FIT|SMARTFIT|ACADEMIA|BIOSPORT|\bGYM\b|CINEMARK|KINOPLEX|\bCINEMA\b|INGRESSO\s?COM|TICKET\s?360|SYMPLA|EVENTIM/, category: "Lazer" },

  // --- Serviços ----------------------------------------------------------
  { pattern: /STARLINK|\bVIVO\b|\bCLARO\b|\bTIM\b|ALGAR|INTERNET|TELECOM/, category: "Servicos" },
  { pattern: /CONTABILIZEI|CONTABIL|CARTORIO|ADVOCACIA|CORREIOS/, category: "Servicos" },

  // --- Cobranças do próprio cartão ---------------------------------------
  // Pelo nome, e não só pelo tipo: "Estorno Tarifa" é um estorno, então a
  // regra que manda tarifa para Tarifas pelo tipo não alcança essa linha.
  { pattern: /\bANUIDADE\b|\bTARIFA\b|\bIOF\b|\bJUROS\b|ENCARGOS?\b|\bMULTA\b/, category: "Tarifas" },

  // --- Educação ----------------------------------------------------------
  { pattern: /UDEMY|ALURA|COURSERA|\bENEM\b|FACULDADE|UNIVERSIDADE|COLEGIO|\bESCOLA\b|CURSO\s/, category: "Educacao" },
];

/**
 * Nome de categoria da casa sugerido pelo estabelecimento.
 *
 * Devolve `null` quando não reconhece - e aí a dica do banco assume.
 */
export function categoryFromMerchant(merchantNormalized: string): string | null {
  const key = merchantNormalized.trim();
  if (key === "") return null;
  return MERCHANT_RULES.find((r) => r.pattern.test(key))?.category ?? null;
}

/**
 * Nome de categoria da casa sugerido pela categoria que o banco mandou.
 *
 * Devolve `null` quando não reconhece - e aí a linha fica sem categoria, que é
 * melhor que catalogar errado.
 */
export function categoryFromHint(hint: string): string | null {
  const key = stripAccents(hint).toLowerCase().replace(/\s+/g, " ").trim();
  if (key === "" || key === "-") return null;
  return CATEGORY_SYNONYMS.find((s) => s.pattern.test(key))?.category ?? null;
}

// --------------------------------------------------------------------------
// Convenção de sinal
// --------------------------------------------------------------------------

/**
 * Descobre se despesa vem positiva ou negativa no arquivo.
 *
 * Uma fatura de cartão é quase toda despesa; pagamento e estorno são poucos.
 * Então o sinal da maioria é o sinal da despesa. Empate ou arquivo vazio caem
 * em `expense_positive`, que é o formato real do Nubank.
 *
 * A tela mostra a conclusão e permite inverter - errar aqui inverteria a
 * fatura inteira, e nenhum palpite deve valer sem confirmação.
 */
export function detectSignConvention(
  amounts: readonly number[],
): SignConvention {
  let positives = 0;
  let negatives = 0;
  for (const amount of amounts) {
    if (amount > 0) positives += 1;
    else if (amount < 0) negatives += 1;
  }
  return negatives > positives ? "expense_negative" : "expense_positive";
}

// --------------------------------------------------------------------------
// Classificação do tipo
// --------------------------------------------------------------------------

/** Cobranças do próprio cartão, que a secao 12 separa do gasto do casal. */
const FEE_PATTERNS = [
  /\banuidade\b/i,
  /\biof\b/i,
  /\bjuros\b/i,
  /\bmulta\b/i,
  /\btarifa\b/i,
  /\bencargos?\b/i,
  /\bseguro\b/i,
];

/** Quitação da fatura. Padrões específicos, nunca a palavra solta. */
const PAYMENT_PATTERNS = [
  /pagamento\s+recebido/i,
  /pagamento\s+em\s+/i,
  /\bpgto\s+recebido/i,
  /pagamento\s+de\s+fatura/i,
  /saldo\s+em\s+aberto\s+anterior/i,
  // Como o Itaú escreve a quitação da fatura anterior.
  /inclus[aã]o\s+de\s+pagamento/i,
  /^\s*pagamento\s*$/i,
];

const REFUND_PATTERNS = [
  /\bestorno\b/i,
  /\bdevolu[cç][aã]o\b/i,
  /\breembolso\b/i,
  /\bcancelamento\b/i,
];

/**
 * Decide o tipo do lançamento.
 *
 * `signed` é o valor como veio no arquivo; `convention` diz qual sinal
 * significa despesa.
 *
 * Cuidado deliberado com "Desconto" (secao 6): a palavra aparece como
 * *categoria* em alguns exports do Nubank e não pode virar pagamento. Só a
 * descrição é consultada aqui, e "desconto" não está em nenhuma lista - um
 * desconto de sinal invertido cai em `refund`, que é o que ele é.
 */
export function classifyType(
  description: string,
  signed: number,
  convention: SignConvention,
): TransactionType {
  // Valor zero não tem lado: é uma cobrança de R$ 0,00, não dinheiro de
  // volta. Sem este caso o sinal ">" jogava toda linha zerada em `refund`.
  if (signed === 0) {
    if (PAYMENT_PATTERNS.some((p) => p.test(description))) return "payment";
    if (REFUND_PATTERNS.some((p) => p.test(description))) return "refund";
    return FEE_PATTERNS.some((p) => p.test(description)) ? "fee" : "expense";
  }

  const isExpenseSide =
    convention === "expense_positive" ? signed > 0 : signed < 0;

  if (isExpenseSide) {
    return FEE_PATTERNS.some((p) => p.test(description)) ? "fee" : "expense";
  }

  if (PAYMENT_PATTERNS.some((p) => p.test(description))) return "payment";
  if (REFUND_PATTERNS.some((p) => p.test(description))) return "refund";

  // Valor do lado contrário sem padrão reconhecido: é dinheiro que voltou.
  // Marcar como `refund` (e não `payment`) mantém o total do mês correto,
  // porque estorno abate a despesa em vez de sair da conta.
  return "refund";
}
