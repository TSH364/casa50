import Link from "next/link";
import { ChevronDown, CreditCard } from "lucide-react";
import { listInvoices, listTransactions } from "@/data/queries";
import { incomeCents, spendingCents } from "@/domain/finance";
import { formatCents } from "@/lib/money";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { InvoiceList } from "./invoice-list";
import { TotaisSeparados } from "@/components/transactions/totais-separados";
import type { Card, MonthKey } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

export function StatementsSkeleton() {
  return (
    <Panel>
      <CardHeader title="Faturas do mês" />
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </Panel>
  );
}

/**
 * Visão por cartão e por fatura do mês (secao 8).
 *
 * Os totais por cartão são calculados a partir dos mesmos lançamentos que a
 * lista abaixo mostra, com a mesma função de sinal - assim o número do cartão
 * e o total do mês não podem divergir.
 */
export async function Statements({
  houseId,
  month,
  cards,
  members,
  activeCardId,
}: {
  houseId: string;
  month: MonthKey;
  cards: Card[];
  members: MemberSummary[];
  activeCardId: string | null;
}) {
  const [transactions, invoices] = await Promise.all([
    listTransactions(houseId, { month }),
    listInvoices(houseId, month),
  ]);

  // Gasto e recebido em contas separadas: a receita (sem cartao, quase
  // sempre) nao entra no total gasto, e aparece ao lado, em azul.
  const totals = new Map<
    string | null,
    { cents: number; incomeCents: number; count: number }
  >();
  for (const t of transactions) {
    const key = t.cardId;
    const bucket = totals.get(key) ?? { cents: 0, incomeCents: 0, count: 0 };
    bucket.cents += spendingCents(t);
    bucket.incomeCents += incomeCents(t);
    bucket.count += 1;
    totals.set(key, bucket);
  }

  const withCard = cards.filter(
    (c) => c.isActive || totals.has(c.id),
  );
  const noCard = totals.get(null);

  return (
    <>
      {withCard.length > 0 || noCard ? (
        <Panel>
          <CardHeader
            title="Por cartão"
            description="Toque num cartão para ver só os lançamentos dele."
          />
          <ul className="space-y-2">
            {withCard.map((card) => {
              const bucket = totals.get(card.id) ?? {
                cents: 0,
                incomeCents: 0,
                count: 0,
              };
              const isActive = activeCardId === card.id;
              return (
                <li key={card.id}>
                  <Link
                    href={
                      isActive
                        ? `/extratos?mes=${month}`
                        : `/extratos?mes=${month}&cartao=${card.id}`
                    }
                    aria-current={isActive ? "true" : undefined}
                    className={`flex min-h-14 items-center gap-3 rounded-(--radius-control) px-3 transition-colors ${
                      isActive
                        ? "bg-brand-soft ring-1 ring-brand/50"
                        : "bg-surface-2 hover:bg-surface-3"
                    }`}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-muted">
                      <CreditCard className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        {card.name}
                        {card.lastFour ? (
                          <span className="ml-1.5 text-ink-faint">
                            ···· {card.lastFour}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-legenda text-ink-faint">
                        {bucket.count} lançamento(s)
                        {card.dueDay ? ` · vence dia ${card.dueDay}` : ""}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm font-medium text-danger">
                      {formatCents(bucket.cents)}
                    </span>
                  </Link>
                </li>
              );
            })}

            {noCard ? (
              <li className="flex min-h-14 items-center gap-3 rounded-(--radius-control) bg-surface-2 px-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-muted">Sem cartão</p>
                  <p className="text-legenda text-ink-faint">
                    {noCard.count} lançamento(s) · PIX, dinheiro ou manual
                  </p>
                </div>
                <div className="shrink-0">
                  <TotaisSeparados
                    gastoCents={noCard.cents}
                    recebidoCents={noCard.incomeCents}
                  />
                </div>
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}

      {/* Recolhido: e o historico das importacoes (com o "desfazer"), que se
          abre de vez em quando - nao a cada visita. */}
      <Panel>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span>
              <span className="text-destaque font-semibold tracking-tight text-ink">Faturas do mês</span>
              <span className="mt-0.5 block text-corpo text-ink-faint">
                {invoices.length === 0
                  ? "Nenhuma importada neste mês."
                  : `${invoices.length} importada${invoices.length > 1 ? "s" : ""} · quem fez, quando, e o desfazer`}
              </span>
            </span>
            <ChevronDown className="size-5 shrink-0 text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-4">
            <InvoiceList invoices={invoices} members={members} />
          </div>
        </details>
      </Panel>
    </>
  );
}
