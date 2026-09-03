import { listTransactions } from "@/data/queries";
import { summarizeMonth } from "@/domain/finance";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { cn } from "@/lib/utils";
import type { MonthKey } from "@/domain/types";

interface Props {
  houseId: string;
  month: MonthKey;
  memberId: string | null;
  cardId: string | null;
}

function Kpi({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative" | "muted";
  hint?: string;
}) {
  return (
    <div className="rounded-[--radius-control] bg-surface-2 px-3.5 py-3">
      <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-[19px] font-semibold",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-danger",
          tone === "muted" && "text-ink-muted",
          tone === "neutral" && "text-ink",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[12px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/** Esqueleto com a mesma grade do conteúdo, para o layout não pular. */
export function SummarySkeleton() {
  return (
    <Card>
      <CardHeader title="Resumo do mês" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-[--radius-control] bg-surface-2 px-3.5 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-24" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export async function Summary({ houseId, month, memberId, cardId }: Props) {
  const transactions = await listTransactions(houseId, { month });
  const s = summarizeMonth(transactions, month, { memberId, cardId });

  return (
    <Card>
      <CardHeader
        title="Resumo do mês"
        description="Gasto já líquido de estornos. Pagamento de fatura não entra como despesa."
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Kpi label="Gasto" value={formatCents(s.spentCents)} />
        <Kpi label="Receitas" value={formatCents(s.incomeCents)} tone="positive" />
        <Kpi
          label="Saldo"
          value={formatCents(s.balanceCents)}
          tone={s.balanceCents < 0 ? "negative" : "positive"}
        />
        <Kpi
          label="Lançamentos"
          value={String(s.count)}
          tone="muted"
        />
        <Kpi
          label="Previsto"
          value={formatCents(s.forecastCents)}
          tone="muted"
          hint={s.forecastCents === 0 ? "nada previsto" : "ainda não confirmado"}
        />
        <Kpi
          label="Em parcelas"
          value={formatCents(s.installmentCents)}
          tone="muted"
        />
      </div>
    </Card>
  );
}
