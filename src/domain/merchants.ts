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
 * Marketplaces cujo sufixo e o vendedor.
 *
 * Ancorados no INICIO do nome (`^`), e essa ancora e a regra inteira de
 * seguranca: sem ela, `mercado` casaria com "SUPERMERCADO PERIM",
 * "LF MINIMERCADOS" e "ADCMICROMERCADOS", que sao mercearias de verdade e nao
 * tem nada a ver com o marketplace. E o mesmo tropeco que `mercad\w*` ja teria
 * causado nas regras de subcategoria.
 */
const MARKETPLACES: { canonical: string; pattern: RegExp }[] = [
  {
    canonical: "Mercado Livre",
    // "MERCADO MERCADOLIVRE" existe na base: a maquininha repete o prefixo.
    pattern: /^(mercadolivre|mercado\s*livre|mercado\s+mercadolivre|mercadopago)\b/i,
  },
  { canonical: "Amazon", pattern: /^(amazon|amazonmktplc|amzn)\b/i },
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

  for (const { canonical, pattern } of MARKETPLACES) {
    if (pattern.test(nome)) return canonical;
  }
  return null;
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
  if (!name) return false;
  return MARKETPLACES.some((m) => m.canonical === name);
}

/**
 * Por que chave este lancamento deve ser AGRUPADO.
 *
 * Usada por tudo que conta por estabelecimento - proposta de subcategoria,
 * reconhecimento de cobranca fixa, sugestao de recorrencia. Uma funcao so para
 * as tres nao divergirem.
 */
export function merchantKey(t: Transaction): string | null {
  const canonico = canonicalMerchant(t.merchantNormalized);
  if (canonico) return canonico;
  return t.merchantNormalized ?? null;
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
