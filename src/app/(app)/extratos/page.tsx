import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listCards, listCategories, listTransactions } from "@/data/queries";
import { summarizeMonth } from "@/domain/finance";
import { currentMonth, isMonthKey } from "@/domain/month";
import { formatCents } from "@/lib/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { MonthSwitcher } from "@/components/month-switcher";
import { FilterChips } from "@/components/filter-chips";
import { SearchBox } from "@/components/search-box";
import { TransactionList } from "@/components/transactions/transaction-list";
import { NewTransactionButton } from "@/components/transactions/new-transaction-button";
import { Statements, StatementsSkeleton } from "@/components/statements/card-totals";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import type { Card as CardType, Category, MonthKey } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

export const metadata: Metadata = { title: "Extratos · Fluxo" };

function ListSkeleton() {
  return (
    <Card>
      <CardHeader title="Lançamentos" />
      <div className="space-y-3">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </Card>
  );
}

async function Listing({
  houseId,
  month,
  memberId,
  cardId,
  categoryId,
  search,
  categories,
  cards,
  members,
}: {
  houseId: string;
  month: MonthKey;
  memberId: string | null;
  cardId: string | null;
  categoryId: string | null;
  search: string | undefined;
  categories: Category[];
  cards: CardType[];
  members: MemberSummary[];
}) {
  const transactions = await listTransactions(houseId, {
    month,
    memberId,
    cardId,
    categoryId,
    search,
  });
  // Total do recorte visível, para o número bater com a lista abaixo dele.
  const summary = summarizeMonth(transactions, month, { memberId, cardId });

  return (
    <Card>
      <CardHeader
        title="Lançamentos"
        description={`${transactions.length} no recorte atual`}
        action={
          <span className="tabular text-sm font-semibold text-ink">
            {formatCents(summary.spentCents)}
          </span>
        }
      />
      <TransactionList
        transactions={transactions}
        categories={categories}
        cards={cards}
        members={members}
        defaultMonth={month}
      />
    </Card>
  );
}

export default async function ExtratosPage({
  searchParams,
}: {
  searchParams: Promise<{
    mes?: string;
    membro?: string;
    cartao?: string;
    categoria?: string;
    busca?: string;
  }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const [members, cards, categories] = await Promise.all([
    listMembers(active.id),
    listCards(active.id),
    listCategories(active.id),
  ]);

  const month =
    params.mes && isMonthKey(params.mes) ? params.mes : currentMonth();
  const memberId = params.membro ?? null;
  const cardId = params.cartao ?? null;
  const categoryId = params.categoria ?? null;
  const search = params.busca;

  const key = `${month}:${memberId ?? "t"}:${cardId ?? "t"}:${categoryId ?? "t"}:${search ?? ""}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher month={month} />
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/importar">
              <Upload aria-hidden /> Importar
            </Link>
          </Button>
          <NewTransactionButton
            categories={categories}
            cards={cards}
            members={members}
            defaultMonth={month}
          />
        </div>
      </header>

      <SearchBox placeholder="Buscar por descrição, estabelecimento ou apelido" />

      {members.length > 1 ? (
        <FilterChips
          param="membro"
          label="Filtrar por pessoa"
          active={memberId}
          options={members.map((m) => ({ value: m.userId, label: m.fullName }))}
        />
      ) : null}

      {cards.filter((c) => c.isActive).length > 0 ? (
        <FilterChips
          param="cartao"
          label="Filtrar por cartão"
          active={cardId}
          allLabel="Todos os cartões"
          options={cards
            .filter((c) => c.isActive)
            .map((c) => ({
              value: c.id,
              label: c.lastFour ? `${c.name} ···· ${c.lastFour}` : c.name,
            }))}
        />
      ) : null}

      <FilterChips
        param="categoria"
        label="Filtrar por categoria"
        active={categoryId}
        allLabel="Todas as categorias"
        options={[
          // Primeiro da lista: é o recorte que resolve o trabalho pendente
          // depois de importar uma fatura.
          { value: "sem", label: "Sem categoria" },
          ...categories
            .filter((c) => c.parentId === null && c.isActive)
            .map((c) => ({ value: c.id, label: c.name })),
        ]}
      />

      <Suspense key={`faturas:${month}:${cardId ?? "t"}`} fallback={<StatementsSkeleton />}>
        <Statements
          houseId={active.id}
          month={month}
          cards={cards}
          members={members}
          activeCardId={cardId}
        />
      </Suspense>

      <Suspense key={key} fallback={<ListSkeleton />}>
        <Listing
          houseId={active.id}
          month={month}
          memberId={memberId}
          cardId={cardId}
          categoryId={categoryId}
          search={search}
          categories={categories}
          cards={cards}
          members={members}
        />
      </Suspense>
    </div>
  );
}
