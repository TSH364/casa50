import "server-only";
import {
  SEARCH_PROMPT,
  checkOffers,
  offersFromCitations,
  offersPrompt,
  searchDiagnostics,
  unverifiedOffers,
  type Offer,
} from "@/domain/shopping";
import { DEFAULT_CHAT_PAID_MODEL } from "@/domain/ai-models";
import { webSearch } from "@/lib/openrouter";
import type { Cents } from "@/lib/money";

/**
 * A busca de ofertas na web, conferida - a mesma para a pesquisa de compra da
 * Dor.IA e para o Radar de produtos.
 *
 * Só o nome do produto (e o teto) sai do app. Tres niveis, do mais ao menos
 * conferido: o anuncio que a IA citou e a busca abriu; o anuncio direto das
 * paginas de loja citadas; e, por ultimo - salvo `aceitarNaoConferidas: false` -, a
 * busca na loja pelo nome do que a IA viu.
 *
 * Lanca o erro da busca (tempo, chave recusada): quem chama decide o que dizer.
 */
export interface BuscaDeOfertas {
  offers: Offer[];
  costUsd: number;
  model: string | null;
  details: Record<string, unknown>;
}

export async function buscarOfertas(
  produto: string,
  tetoCents: Cents | null,
  options: { apiKey: string; timeoutMs: number; aceitarNaoConferidas?: boolean },
): Promise<BuscaDeOfertas> {
  const r = await webSearch([{ role: "user", content: offersPrompt(produto, tetoCents) }], {
    apiKey: options.apiKey,
    model: DEFAULT_CHAT_PAID_MODEL,
    timeoutMs: options.timeoutMs,
    searchPrompt: SEARCH_PROMPT,
  });
  const conferidas = checkOffers(r.content, r.citations, tetoCents);
  const planoB = conferidas.offers.length > 0 ? [] : offersFromCitations(r.citations, tetoCents);
  const planoC =
    options.aceitarNaoConferidas === false || conferidas.offers.length > 0 || planoB.length > 0
      ? []
      : unverifiedOffers(r.content, tetoCents);
  const offers = conferidas.offers.length > 0 ? conferidas.offers : planoB.length > 0 ? planoB : planoC;
  return {
    offers,
    costUsd: r.costUsd,
    model: r.servedBy ?? DEFAULT_CHAT_PAID_MODEL,
    details: searchDiagnostics(produto, r.content, r.citations, {
      conferidas: conferidas.offers.length,
      descartadas: conferidas.dropped,
      planoB: planoB.length,
      planoC: planoC.length,
    }),
  };
}
