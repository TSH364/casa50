import { formatCents, type Cents } from "@/lib/money";

/**
 * O total do recorte, com o que saiu e o que entrou SEPARADOS.
 *
 * A receita nunca entra no total gasto (`spendingCents` a conta como zero),
 * mas um numero so, ao lado de uma lista que mistura compras do cartao e o
 * salario, parecia somar tudo. Dois numeros, duas cores: gasto em vermelho,
 * recebido em azul.
 */
export function TotaisSeparados({
  gastoCents,
  recebidoCents,
}: {
  gastoCents: Cents;
  recebidoCents: Cents;
}) {
  return (
    <dl className="tabular text-right">
      <div className="flex items-baseline justify-end gap-1.5">
        <dt className="text-legenda text-ink-faint">Gastos</dt>
        <dd className="text-sm font-semibold text-danger">{formatCents(gastoCents)}</dd>
      </div>
      {recebidoCents > 0 ? (
        <div className="flex items-baseline justify-end gap-1.5">
          <dt className="text-legenda text-ink-faint">Recebido</dt>
          <dd className="text-sm font-semibold text-info">+{formatCents(recebidoCents)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
