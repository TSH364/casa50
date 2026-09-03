import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listAuditLog } from "@/data/queries";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/states";
import { FilterChips } from "@/components/filter-chips";
import type { MemberSummary } from "@/lib/houses";

export const metadata: Metadata = { title: "Histórico · Fluxo" };

/**
 * Rótulos legíveis das entidades e ações.
 *
 * A secao 19 proíbe exibir JSON cru como interface. O trigger de auditoria já
 * monta a frase ("alterou Starlink: categoria de Serviços para Assinaturas");
 * aqui só a completamos com quem fez e quando.
 */
const ENTITY_LABEL: Record<string, string> = {
  lancamento: "Lançamento",
  cartao: "Cartão",
  categoria: "Categoria",
  orcamento: "Orçamento",
  meta: "Meta",
  recorrencia: "Recorrência",
  regra: "Regra",
  fatura: "Fatura",
  acerto: "Acerto",
};

const ACTION_LABEL: Record<string, string> = {
  create: "Criação",
  update: "Edição",
  delete: "Exclusão",
  categorize: "Recategorização",
  import: "Importação",
  revert_import: "Importação desfeita",
  reconcile: "Conciliação",
};

const ACTION_TONE: Record<string, string> = {
  create: "text-positive",
  delete: "text-danger",
  categorize: "text-brand",
};

const stamp = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function HistorySkeleton() {
  return (
    <Card>
      <CardHeader title="Histórico" />
      <div className="space-y-3">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Card>
  );
}

async function History({
  houseId,
  members,
  userId,
  entity,
  action,
}: {
  houseId: string;
  members: MemberSummary[];
  userId: string | null;
  entity: string | null;
  action: string | null;
}) {
  const entries = await listAuditLog(houseId, { userId, entity, action });
  const nameOf = (id: string | null) =>
    members.find((m) => m.userId === id)?.fullName ?? "O sistema";

  return (
    <Card>
      <CardHeader
        title="Histórico"
        description={`${entries.length} registro(s)`}
      />
      {entries.length === 0 ? (
        <EmptyState
          title="Nada registrado ainda"
          description="Criar, editar, excluir, categorizar e importar aparecem aqui automaticamente."
        />
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2.5">
              <p className="text-sm text-ink">
                <span className="font-medium">{nameOf(entry.userId)}</span>{" "}
                {entry.summary ??
                  `${ACTION_LABEL[entry.action]?.toLowerCase() ?? entry.action} um registro`}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-faint">
                <span className={ACTION_TONE[entry.action] ?? "text-ink-faint"}>
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </span>
                {" · "}
                {ENTITY_LABEL[entry.entity] ?? entry.entity}
                {" · "}
                {stamp.format(new Date(entry.createdAt))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<{ pessoa?: string; entidade?: string; acao?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();

  const params = await searchParams;
  const members = await listMembers(active.id);

  const userId = params.pessoa ?? null;
  const entity = params.entidade ?? null;
  const action = params.acao ?? null;
  const key = `${userId ?? "t"}:${entity ?? "t"}:${action ?? "t"}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Histórico
        </h1>
        <p className="mt-1 text-[13px] text-ink-faint">
          Quem lançou, editou ou excluiu cada informação. O registro é feito
          pelo banco, então pega até alteração feita fora do app.
        </p>
      </header>

      {members.length > 1 ? (
        <FilterChips
          param="pessoa"
          label="Filtrar por pessoa"
          active={userId}
          options={members.map((m) => ({ value: m.userId, label: m.fullName }))}
        />
      ) : null}

      <FilterChips
        param="acao"
        label="Filtrar por ação"
        active={action}
        allLabel="Todas as ações"
        options={Object.entries(ACTION_LABEL).map(([value, label]) => ({
          value,
          label,
        }))}
      />

      <FilterChips
        param="entidade"
        label="Filtrar por tipo"
        active={entity}
        allLabel="Tudo"
        options={Object.entries(ENTITY_LABEL).map(([value, label]) => ({
          value,
          label,
        }))}
      />

      <Suspense key={key} fallback={<HistorySkeleton />}>
        <History
          houseId={active.id}
          members={members}
          userId={userId}
          entity={entity}
          action={action}
        />
      </Suspense>
    </div>
  );
}
