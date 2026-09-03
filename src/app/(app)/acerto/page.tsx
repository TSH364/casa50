import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listSettlements, listTransactions } from "@/data/queries";
import { monthSettlement } from "@/domain/settlement";
import { currentMonth, isMonthKey } from "@/domain/month";
import { MonthSwitcher } from "@/components/month-switcher";
import { EmptyState } from "@/components/states";
import { Card } from "@/components/ui/card";
import { SettlementPanel } from "@/components/settlement/settlement-panel";

export const metadata: Metadata = { title: "Acerto · Fluxo" };

export default async function AcertoPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const month =
    params.mes && isMonthKey(params.mes) ? params.mes : currentMonth();

  const [transactions, members, records] = await Promise.all([
    listTransactions(active.id, { month }),
    listMembers(active.id),
    listSettlements(active.id, month),
  ]);

  const settlement = monthSettlement(
    transactions,
    members.map((m) => m.userId),
    month,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} />
      </header>

      {members.length < 2 ? (
        <Card>
          <EmptyState
            title="O acerto precisa de duas pessoas"
            description="Convide alguém para a casa em Casa → Convidar alguém. Enquanto a casa tiver um membro só, não há o que dividir."
          />
        </Card>
      ) : (
        <SettlementPanel
          settlement={settlement}
          records={records}
          members={members}
          month={month}
        />
      )}
    </div>
  );
}
