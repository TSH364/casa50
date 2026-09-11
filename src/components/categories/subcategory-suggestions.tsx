import { listSubcategoryDismissals, listTransactions } from "@/data/queries";
import { suggestSubcategories } from "@/domain/subcategories";
import { addMonths, currentMonth } from "@/domain/month";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { SuggestionCard, RestoreDismissed } from "./suggestion-card";
import type { Category } from "@/domain/types";

/**
 * O que o Fluxo notou no jeito de gastar (secao 14).
 *
 * A pergunta que originou a tela: "meu gasto com alimentacao de segunda a
 * sexta e almoco no trabalho, no fim de semana e outra coisa - da para o app
 * separar?". Da, e o painel mostra a proposta COM a evidencia ao lado: quantas
 * vezes, em quantos meses, quanto por vez, e quanto disso cai em dia util.
 *
 * Nada e criado sozinho. O nome vem editavel, a lista de estabelecimentos fica
 * a vista, e "agora nao" e uma resposta que o app respeita - e lembra.
 */

/** Janela de historico. Menos que isto nao distingue habito de coincidencia. */
const MESES = 12;
/** Teto de propostas na tela. Vinte sugestoes nao sao ajuda, sao uma lista. */
const MAX_PROPOSTAS = 6;

export async function SubcategorySuggestions({
  houseId,
  categories,
}: {
  houseId: string;
  categories: Category[];
}) {
  const month = currentMonth();

  const [transactions, dismissed] = await Promise.all([
    listTransactions(houseId, {
      fromMonth: addMonths(month, -MESES),
      toMonth: month,
      limit: 3000,
    }),
    listSubcategoryDismissals(houseId),
  ]);

  // So categorias-mae, e so as que contam nos totais da casa: uma categoria
  // marcada como "isto nao e gasto da casa" foi tirada da conversa de
  // proposito, e trazer proposta dela de volta seria desfazer essa decisao
  // pela porta dos fundos.
  const parents = categories.filter(
    (c) => c.parentId === null && !c.excludedFromTotals,
  );

  const porCategoria = new Map<string, typeof transactions>();
  for (const t of transactions) {
    if (t.categoryId === null) continue;
    const lista = porCategoria.get(t.categoryId) ?? [];
    lista.push(t);
    porCategoria.set(t.categoryId, lista);
  }

  const propostas = parents
    .flatMap((category) =>
      suggestSubcategories(porCategoria.get(category.id) ?? []).map(
        (suggestion) => ({ category, suggestion }),
      ),
    )
    .sort((a, b) => b.suggestion.totalCents - a.suggestion.totalCents);

  const visiveis = propostas
    .filter((p) => !dismissed.has(`${p.category.id}|${p.suggestion.key}`))
    .slice(0, MAX_PROPOSTAS);
  const recusadas = propostas.filter((p) =>
    dismissed.has(`${p.category.id}|${p.suggestion.key}`),
  );

  if (visiveis.length === 0 && recusadas.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Padrões que o Fluxo notou"
        description="Propostas de subcategoria tiradas do próprio extrato. Nenhuma é criada sem você mandar."
      />

      {visiveis.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          Nenhuma proposta nova por enquanto.
        </p>
      ) : (
        <ul className="space-y-3">
          {visiveis.map((p) => (
            <li key={`${p.category.id}-${p.suggestion.key}`}>
              <SuggestionCard
                categoryId={p.category.id}
                categoryName={p.category.name}
                color={p.category.color}
                suggestion={p.suggestion}
              />
            </li>
          ))}
        </ul>
      )}

      {recusadas.length > 0 ? (
        <details className="mt-3 border-t border-line pt-2.5">
          <summary className="cursor-pointer text-[12px] text-ink-faint">
            {recusadas.length} proposta(s) recusada(s)
          </summary>
          <ul className="mt-2 space-y-1.5">
            {recusadas.map((p) => (
              <li
                key={`${p.category.id}-${p.suggestion.key}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
              >
                <span className="text-ink-muted">
                  {p.category.name} · {p.suggestion.suggestedName}
                </span>
                <span className="tabular text-ink-faint">
                  {formatCents(p.suggestion.totalCents)}
                </span>
                <RestoreDismissed
                  categoryId={p.category.id}
                  suggestionKey={p.suggestion.key}
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
