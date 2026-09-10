import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, History, Tags } from "lucide-react";
import {
  getActiveHouse,
  listMembers,
  listPendingInvitesForMe,
  listRoster,
} from "@/lib/houses";
import { listCalendarSources } from "@/data/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { MembersManager } from "@/components/house/members-manager";
import { CalendarsManager } from "@/components/calendar/calendars-manager";
import { PendingInvites } from "@/components/house/pending-invites";
import { buildInfo, buildLabel } from "@/lib/version";

export const metadata: Metadata = { title: "Casa · Fluxo" };

export default async function CasaPage() {
  const { active } = await getActiveHouse();
  const [roster, invites, user, members, calendars] = await Promise.all([
    active ? listRoster(active.id) : Promise.resolve([]),
    listPendingInvitesForMe(),
    getCurrentUser(),
    active ? listMembers(active.id) : Promise.resolve([]),
    active ? listCalendarSources(active.id) : Promise.resolve([]),
  ]);

  // Só dono e administrador convidam, mudam papel ou removem. O RLS recusaria
  // de qualquer forma; esconder os controles evita oferecer o que vai falhar.
  const canManage =
    active?.role === "owner" || active?.role === "admin";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {active?.name ?? "Casa"}
      </h1>

      <PendingInvites invites={invites} />

      {active ? (
        <MembersManager
          roster={roster}
          currentUserId={user?.id ?? null}
          canManage={canManage}
        />
      ) : null}

      {active ? (
        <CalendarsManager
          sources={calendars}
          members={members}
          canManage={active.role !== "viewer"}
        />
      ) : null}

      <Card>
        <CardHeader
          title="Cartões"
          description="Cadastro, dono, fechamento e vencimento."
        />
        <Link
          href="/cartoes"
          className="flex min-h-11 items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 text-sm text-ink transition-colors hover:bg-surface-3"
        >
          <CreditCard className="size-4 text-ink-muted" aria-hidden />
          Gerenciar cartões
        </Link>
      </Card>

      <Card>
        <CardHeader
          title="Categorias"
          description="Renomeie, recolora ou remova — inclusive as iniciais."
        />
        <Link
          href="/categorias"
          className="flex min-h-11 items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 text-sm text-ink transition-colors hover:bg-surface-3"
        >
          <Tags className="size-4 text-ink-muted" aria-hidden />
          Gerenciar categorias
        </Link>
      </Card>

      <Card>
        <CardHeader
          title="Histórico"
          description="Quem lançou, editou ou excluiu cada informação."
        />
        <Link
          href="/historico"
          className="flex min-h-11 items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 text-sm text-ink transition-colors hover:bg-surface-3"
        >
          <History className="size-4 text-ink-muted" aria-hidden />
          Ver histórico da casa
        </Link>
      </Card>

      {/*
        Versão por extenso. O cabeçalho mostra só o commit, e `title` não abre
        no toque - num app usado no celular, o detalhe precisa estar escrito.
      */}
      <p className="pb-2 text-center text-[12px] text-ink-faint">
        {buildLabel(buildInfo())}
      </p>
    </div>
  );
}
