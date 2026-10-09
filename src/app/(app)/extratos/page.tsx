import { Suspense } from "react";
import type { Metadata } from "next";
import { PersonFilterNote } from "@/components/person-filter-note";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listCards, listCategories, listTransactions } from "@/data/queries";
import { ladoNoExtrato, summarizeMonth, tipoDoExtrato } from "@/domain/finance";
import { currentMonth, isMonthKey } from "@/domain/month";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/states";
import { MonthSwitcher } from "@/components/month-switcher";
import { FilterChips } from "@/components/filter-chips";
import { FiltrosCompactos } from "@/components/filtros-compactos";
import { rotuloDoCartao } from "@/domain/cartoes";
import { SearchBox } from "@/components/search-box";
import { TransactionList } from "@/components/transactions/transaction-list";
import { TotaisSeparados } from "@/components/transactions/totais-separados";
import { FiltroTipo } from "@/components/transactions/filtro-tipo";
import { NewTransactionButton } from "@/components/transactions/new-transaction-button";
import { Statements, StatementsSkeleton } from "@/components/statements/card-totals";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import type { Card as CardType, Category, MonthKey } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

export const metadata: Metadata = { title: "Extratos · Fluxo" };

/**
 * "Reanalisar" uma fatura pode perguntar ao Jev sobre dezenas de lojas (ate
 * 25 s, ver `jevDecisions`). O padrao da Vercel cortaria antes.
 */
export const maxDuration = 60;

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
  tipo,
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
  tipo: "saida" | "entrada" | null;
  categories: Category[];
  cards: CardType[];
  members: MemberSummary[];
}) {
  const todas = await listTransactions(houseId, {
    month,
    memberId,
    cardId,
    categoryId,
    search,
  });
  const contagem = {
    tudo: todas.length,
    saidas: todas.filter((t) => ladoNoExtrato(t) === "saida").length,
    entradas: todas.filter((t) => ladoNoExtrato(t) === "entrada").length,
  };
  const transactions = tipo ? todas.filter((t) => ladoNoExtrato(t) === tipo) : todas;
  // Total do recorte visível, para o número bater com a lista abaixo dele.
  const summary = summarizeMonth(transactions, month, { memberId, cardId });

  return (
    <Card>
      <CardHeader
        title="Lançamentos"
        description={`${transactions.length} no recorte atual`}
        action={
          <TotaisSeparados
            gastoCents={summary.spentCents}
            recebidoCents={summary.incomeCents}
            mostrar={tipo ?? "tudo"}
          />
        }
      />
      <div className="mb-3">
        <FiltroTipo ativo={tipo} contagem={contagem} />
      </div>
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
    tipo?: string;
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
  const tipo = tipoDoExtrato(params.tipo);

  const key = `${month}:${memberId ?? "t"}:${cardId ?? "t"}:${categoryId ?? "t"}:${search ?? ""}:${tipo ?? "t"}`;

  // O recorte em uso, numa linha - o mesmo desenho do Inicio: a pilula diz o
  // que esta valendo e o toque abre os chips.
  const cartoesAtivos = cards.filter((c) => c.isActive);
  const cartao = cardId ? cards.find((c) => c.id === cardId) : undefined;
  const categoria =
    categoryId === "sem" ? "Sem categoria" : categoryId ? categories.find((c) => c.id === categoryId)?.name : undefined;
  const resumoFiltros =
    [
      memberId ? (members.find((m) => m.userId === memberId)?.fullName.split(" ")[0] ?? "Uma pessoa") : null,
      cartao ? rotuloDoCartao(cartao) : null,
      categoria ?? null,
    ]
      .filter(Boolean)
      .join(" · ") || "Filtros";
  const filtroAtivo = memberId !== null || cardId !== null || categoryId !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="-ml-3 flex items-center justify-between gap-2">
        <MonthSwitcher month={month} />
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/importar" aria-label="Importar fatura">
              {/* No celular, so o icone: com o texto, o "+" saia da tela. */}
              <Upload aria-hidden /> <span className="hidden sm:inline">Importar</span>
            </Link>
          </Button>
          <NewTransactionButton
            categories={categories}
            cards={cards}
            members={members}
            defaultMonth={month}
            label="Lançar"
            iconOnly
          />
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchBox placeholder="Buscar" />
        </div>
        <FiltrosCompactos
          resumo={resumoFiltros}
          ativo={filtroAtivo}
          descricao="O recorte vale para as faturas e os lançamentos."
          className="min-h-11 max-w-[45%]"
        >
          {members.length > 1 ? (
            <FilterChips
              param="membro"
              label="Filtrar por pessoa"
              active={memberId}
              options={members.map((m) => ({ value: m.userId, label: m.fullName }))}
            />
          ) : null}

          {memberId ? <PersonFilterNote cards={cards} houseWidePanels={false} /> : null}

          {cartoesAtivos.length > 0 ? (
            <FilterChips
              param="cartao"
              label="Filtrar por cartão"
              active={cardId}
              allLabel="Todos os cartões"
              options={cartoesAtivos.map((c) => ({ value: c.id, label: rotuloDoCartao(c) }))}
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
        </FiltrosCompactos>
      </div>

      <Suspense key={key} fallback={<ListSkeleton />}>
        <Listing
          houseId={active.id}
          month={month}
          memberId={memberId}
          cardId={cardId}
          categoryId={categoryId}
          search={search}
          tipo={tipo}
          categories={categories}
          cards={cards}
          members={members}
        />
      </Suspense>

      {/* Depois da lista, e nao antes: o que a casa abre Extratos para ver sao
          os lancamentos. Os totais por cartao e as faturas importadas ficam
          embaixo, a uma rolagem. */}
      <Suspense key={`faturas:${month}:${cardId ?? "t"}`} fallback={<StatementsSkeleton />}>
        <Statements
          houseId={active.id}
          month={month}
          cards={cards}
          members={members}
          activeCardId={cardId}
        />
      </Suspense>
    </div>
  );
}
