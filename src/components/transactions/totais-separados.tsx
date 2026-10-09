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
  mostrar = "tudo",
}: {
  gastoCents: Cents;
  recebidoCents: Cents;
  /** Com o filtro de Extratos em "Saidas" ou "Entradas", so o lado escolhido. */
  mostrar?: "tudo" | "saida" | "entrada";
}) {
  return (
    <dl className="tabular text-right">
      {mostrar !== "entrada" ? (
        <div className="flex items-baseline justify-end gap-1.5">
          <dt className="text-legenda text-ink-faint">Gastos</dt>
          <dd className="text-sm font-semibold text-danger">{formatCents(gastoCents)}</dd>
        </div>
      ) : null}
      {mostrar === "entrada" || (mostrar === "tudo" && recebidoCents > 0) ? (
        <div className="flex items-baseline justify-end gap-1.5">
          <dt className="text-legenda text-ink-faint">Recebido</dt>
          <dd className="text-sm font-semibold text-info">+{formatCents(recebidoCents)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
