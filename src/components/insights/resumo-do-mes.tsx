import { addMonths, monthLabel, monthRange } from "@/domain/month";
import { summarizeMonth } from "@/domain/finance";
import type { InsightTone } from "@/domain/insights";
import type { MonthKey, Transaction } from "@/domain/types";
import { formatCentsCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { MedidaBar } from "./insight-card";

/** Quantos meses antes entram na media. */
const JANELA = 6;

/**
 * O mes em quatro numeros, no topo da Analise.
 *
 * A tela abria na Leitura da IA - vazia ate alguem tocar em "Analisar" - e
 * em lugar nenhum dizia quanto saiu e quanto entrou. Aqui: gasto, recebido,
 * saldo e o gasto contra a media dos meses anteriores (so os que tem dado:
 * mes vazio no comeco do uso nao e mes sem gasto), com a mesma barra das
 * observacoes.
 */
export function ResumoDoMes({
  transactions,
  month,
  emAndamento,
}: {
  transactions: readonly Transaction[];
  month: MonthKey;
  /** Mes atual: os numeros sao "ate agora". */
  emAndamento: boolean;
}) {
  const s = summarizeMonth(transactions, month);
  const anteriores = monthRange(addMonths(month, -JANELA), addMonths(month, -1)).filter((m) =>
    transactions.some((t) => t.invoiceMonth === m),
  );
  const media =
    anteriores.length > 0
      ? Math.round(anteriores.reduce((soma, m) => soma + summarizeMonth(transactions, m).spentCents, 0) / anteriores.length)
      : null;
  const variacao = media && media > 0 ? (s.spentCents - media) / media : null;
  // Ate 10% para cada lado e "na media": nao vale cor.
  const tom: InsightTone =
    variacao === null || Math.abs(variacao) <= 0.1 ? "neutral" : variacao > 0 ? "attention" : "positive";

  return (
    <Card>
      <h2 className="text-corpo text-ink-muted">
        {monthLabel(month)} em quatro números{emAndamento ? <span className="text-ink-faint"> · até agora</span> : null}
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-legenda text-ink-faint">Gasto</dt>
          <dd className="tabular text-xl font-semibold text-danger">{formatCentsCompact(s.spentCents)}</dd>
        </div>
        <div>
          <dt className="text-legenda text-ink-faint">Recebido</dt>
          <dd className="tabular text-xl font-semibold text-info">
            {s.incomeCents > 0 ? `+${formatCentsCompact(s.incomeCents)}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-legenda text-ink-faint">Saldo</dt>
          <dd className={cn("tabular text-xl font-semibold", s.balanceCents >= 0 ? "text-ink" : "text-danger")}>
            {s.balanceCents < 0 ? "−" : ""}
            {formatCentsCompact(Math.abs(s.balanceCents))}
          </dd>
        </div>
        <div>
          <dt className="text-legenda text-ink-faint">Contra a média</dt>
          <dd
            className={cn(
              "tabular text-xl font-semibold",
              tom === "attention" ? "text-attention" : tom === "positive" ? "text-positive" : "text-ink",
            )}
          >
            {variacao === null ? "—" : `${variacao > 0 ? "+" : variacao < 0 ? "−" : ""}${Math.round(Math.abs(variacao) * 100)}%`}
          </dd>
        </div>
      </dl>
      {media !== null ? (
        <MedidaBar
          tone={tom}
          medida={{
            atualCents: s.spentCents,
            atualRotulo: "Gasto",
            referenciaCents: media,
            referenciaRotulo: `média de ${anteriores.length} ${anteriores.length === 1 ? "mês" : "meses"}`,
          }}
        />
      ) : (
        <p className="mt-3 text-legenda text-ink-faint">Sem meses anteriores para comparar ainda.</p>
      )}
    </Card>
  );
}
