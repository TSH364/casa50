import type { Transaction } from "./types";

/**
 * Juntar as grafias do mesmo estabelecimento.
 *
 * O caso que originou isto, MEDIDO na base real: o Mercado Livre aparece sob
 * QUINZE grafias e a Amazon sob CINCO, somando R$ 28.604 espalhados. O sufixo
 * que as diferencia e o VENDEDOR do marketplace, nao o que foi comprado -
 * "MERCADOLIVRE CIAPNEUS", "MERCADOLIVRE ARTBOX3D", "MERCADOLIVRE JHHUIH". Esse
 * pedaco nao ajuda ninguem a lembrar da compra, e quebra em quinze pedacos o
 * que e uma loja so.
 *
 * O QUE ISTO NAO FAZ, de proposito:
 *
 *   - nao mexe no extrato. A lista de lancamentos continua mostrando o que a
 *     fatura escreveu, porque extrato e documento: conferir uma linha com o
 *     banco exige ver o texto que o banco mandou.
 *   - nao junta CATEGORIA. O Mercado Livre aparece em Compras e em TSH, e sao
 *     compras diferentes feitas na mesma loja. Juntar o nome nao junta o
 *     proposito.
 *   - nao junta a ASSINATURA do marketplace com as compras dele. "MELIMAIS" e
 *     Meli+, que a casa classificou em Assinaturas enquanto as compras estao em
 *     Compras e TSH - sao produtos diferentes vendidos pela mesma empresa, e
 *     juntar o nome misturaria uma mensalidade com compras avulsas.
 */

/**
 * O que o sufixo da grafia significa, que e o que decide o tratamento.
 *
 *   `marketplace` - o sufixo e o VENDEDOR. A loja nao diz nada sobre o gasto:
 *     "MERCADOLIVRE CIAPNEUS" e pneu e "MERCADOLIVRE ARTBOX3D" e decoracao.
 *     Nao propoe subcategoria nenhuma.
 *   `grocery` - o sufixo e a UNIDADE da rede ("GRANJA", "JUNDIAI", "1885").
 *     A loja diz exatamente o que e o gasto: compra de mercado.
 *   `service` - nao ha sufixo: a EMPRESA trocou de nome no meio da serie, e a
 *     fatura passou a escrever outro. Nao e loja nem rede - e uma assinatura
 *     so, partida em duas pela troca de nome.
 *
 * A distincao existe porque tratar os tres igual erraria de todos os lados -
 * o marketplace proporia padrao que nao tem, o supermercado deixaria de ser
 * reconhecido como mercado, e o servico seria julgado pelo dia da semana.
 */
type MerchantKind = "marketplace" | "grocery" | "service";

/**
 * Lojas cujo sufixo e ruido para efeito de agrupamento.
 *
 * Ancorados no INICIO do nome (`^`), e essa ancora e a regra inteira de
 * seguranca: sem ela, `mercado` casaria com "SUPERMERCADO PERIM",
 * "LF MINIMERCADOS" e "ADCMICROMERCADOS", que sao mercearias de verdade e nao
 * tem nada a ver com o marketplace. E o mesmo tropeco que `mercad\w*` ja teria
 * causado nas regras de subcategoria.
 *
 * Os padroes casam a forma NORMALIZADA (sem acento, maiuscula), que e como o
 * banco grava - dai `acucar` e nao `açúcar`. O nome canonico, que e o que
 * aparece na tela, leva os acentos de volta.
 */
const CANONICOS: {
  canonical: string;
  kind: MerchantKind;
  pattern: RegExp;
}[] = [
  {
    canonical: "Mercado Livre",
    kind: "marketplace",
    // "MERCADO MERCADOLIVRE" existe na base: a maquininha repete o prefixo.
    pattern: /^(mercadolivre|mercado\s*livre|mercado\s+mercadolivre|mercadopago)\b/i,
  },
  {
    canonical: "Amazon",
    kind: "marketplace",
    pattern: /^(amazon|amazonmktplc|amzn)\b/i,
  },
  {
    // MEDIDO: tres grafias na base - GRANJA (7x), sem sufixo (1x) e JUNDIAI
    // (1x). So a primeira passava do minimo de tres lancamentos, entao as
    // outras duas eram invisiveis para a proposta de subcategoria.
    canonical: "OBA Hortifruti",
    kind: "grocery",
    pattern: /^oba\s+hortifrut/i,
  },
  {
    // Duas grafias, separadas pelo numero da loja: 1885 e 2050.
    canonical: "Pão de Açúcar",
    kind: "grocery",
    pattern: /^p[aã]o\s+de\s+a[cç]u[cç]ar\b/i,
  },
  {
    /**
     * A MESMA assinatura sob dois nomes, porque a empresa trocou o nome na
     * fatura. Nabu Casa e a empresa por tras do Home Assistant Cloud.
     *
     * MEDIDO: "HOME ASSISTANT CLOUD SA" cobra 12 vezes de 20/12/2025 a
     * 20/05/2026, e "NABU CASA HA CLOUD SA" continua de 20/06 a 20/07 - mesmo
     * dia do mes, serie sem buraco, so o nome mudou.
     *
     * Juntar nao e cosmetica aqui, e o que faz a regra funcionar: o valor
     * varia (conversao de dolar), entao quem reconhece esta cobranca e o dia
     * do mes, que exige tres meses distintos. Separadas, a metade nova tem
     * dois meses e some do reconhecimento; juntas, sao oito.
     */
    canonical: "Home Assistant Cloud",
    kind: "service",
    // Ancorado como os outros, e aqui a ancora tem alvo conhecido: "CASA
    // PRETOLA CAFE" existe na base e casaria com um `casa` solto.
    pattern: /^(home\s+assistant|nabu\s+casa)\b/i,
  },
];

/**
 * Produtos que levam o nome da loja mas nao sao a loja.
 *
 * Assinatura do marketplace nao entra na mesma cesta das compras dele - ver o
 * porque no cabecalho. Fica fora tambem o que carrega "PRIME" no nome, porque
 * separar a mensalidade do aluguel avulso pelo texto da fatura nao da, e
 * absorver a mensalidade por engano custa mais do que deixar um aluguel de
 * R$ 11,90 de fora.
 */
const NAO_E_A_LOJA = /\b(melimais|meli\s*\+|prime)\b/i;

/**
 * Nome canonico da loja, ou `null` quando nao ha o que juntar.
 *
 * Recebe `merchant_normalized` - ja sem acento, em maiuscula e sem pontuacao,
 * como o banco o grava.
 */
export function canonicalMerchant(
  merchantNormalized: string | null | undefined,
): string | null {
  const nome = merchantNormalized?.trim();
  if (!nome) return null;
  if (NAO_E_A_LOJA.test(nome)) return null;

  for (const { canonical, pattern } of CANONICOS) {
    if (pattern.test(nome)) return canonical;
  }
  return null;
}

/** De que tipo e a loja por tras deste nome canonico. */
function kindOf(name: string | null | undefined): MerchantKind | null {
  if (!name) return null;
  return CANONICOS.find((m) => m.canonical === name)?.kind ?? null;
}

/**
 * Este nome e o de um marketplace ja canonizado?
 *
 * Existe por causa de uma armadilha que so aparece DEPOIS de juntar: o nome
 * canonico "Mercado Livre" contem a palavra "Mercado", e a regra que reconhece
 * mercearia por nome (`subcategories.ts`) casa com ela. Sem esta checagem, a
 * compra de marketplace passaria a ser classificada como compra de mercado -
 * junta as grafias e quebra a classificacao no mesmo movimento.
 */
export function isCanonicalMarketplace(name: string | null | undefined): boolean {
  return kindOf(name) === "marketplace";
}

/**
 * Este nome canonico e de uma rede de supermercado?
 *
 * Existe pelo motivo inverso do de cima. A regra que reconhece mercearia em
 * `subcategories.ts` procura palavras genericas - "supermercado", "hortifruti",
 * "atacadista" - e "Pão de Açúcar" nao tem nenhuma delas. Sem esta funcao, uma
 * rede conhecida cujo nome nao carrega a palavra deixaria de ser classificada
 * como mercado e seria julgada pelo dia da semana, virando "refeicao de fim de
 * semana". Juntar a grafia sem ensinar o que a loja E deixaria o trabalho pela
 * metade.
 */
export function isCanonicalGrocery(name: string | null | undefined): boolean {
  return kindOf(name) === "grocery";
}

/**
 * Chave de COMPARACAO entre nomes de estabelecimento.
 *
 * Tira acento, caixa, pontuacao e - o ponto desta funcao - ESPACO. A fatura
 * escreve a mesma loja com e sem ele: "APPLECOMBILL" em tres meses,
 * "APPLE COM BILL" nos outros seis. Qualquer comparacao que preserve o espaco
 * trata as duas como lojas diferentes, e foi exatamente isso que fez o app
 * cadastrar DUAS recorrencias para a mesma assinatura da Apple - uma em Lazer
 * e outra em Assinaturas, R$ 19,90 contados duas vezes no esperado do mes, e
 * uma delas marcada "ausente" todo mes mesmo tendo sido paga.
 *
 * MEDIDO nos 658 lancamentos reais: tirar o espaco junta EXATAMENTE um par de
 * nomes distintos, o da Apple. Nenhum outro colide. O risco de juntar lojas
 * diferentes existe no papel - e a medicao na base de verdade e o que
 * autoriza, nao a intuicao.
 */
export function merchantCompareKey(
  name: string | null | undefined,
): string | null {
  const limpo = name
    ?.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
  return limpo ? limpo : null;
}

/**
 * Por que chave este lancamento deve ser AGRUPADO.
 *
 * Usada por tudo que conta por estabelecimento - proposta de subcategoria,
 * reconhecimento de cobranca fixa, sugestao de recorrencia. Uma funcao so para
 * as tres nao divergirem.
 *
 * O nome canonico sai INTEIRO, com espaco e acento: ele e nome proprio, e
 * `isCanonicalMarketplace` compara contra ele por igualdade. So o nome cru,
 * que nao tem grafia oficial nenhuma, passa pela chave de comparacao.
 */
export function merchantKey(t: Transaction): string | null {
  const canonico = canonicalMerchant(t.merchantNormalized);
  if (canonico) return canonico;
  return merchantCompareKey(t.merchantNormalized);
}

/**
 * Como este lancamento deve ser EXIBIDO num agrupamento.
 *
 * O apelido escrito a mao vence sempre: quem renomeou ja disse o que quer ler,
 * e uma regra automatica nao desfaz decisao de gente.
 */
export function merchantLabel(t: Transaction): string {
  return t.merchantAlias ?? canonicalMerchant(t.merchantNormalized) ?? t.description;
}
