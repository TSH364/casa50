import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, History, Tags } from "lucide-react";
import {
  getActiveHouse,
  listPendingInvitesForMe,
  listRoster,
} from "@/lib/houses";
import { getCurrentUser } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { MembersManager } from "@/components/house/members-manager";
import { PendingInvites } from "@/components/house/pending-invites";

export const metadata: Metadata = { title: "Casa · Fluxo" };

export default async function CasaPage() {
  const { active } = await getActiveHouse();
  const [roster, invites, user] = await Promise.all([
    active ? listRoster(active.id) : Promise.resolve([]),
    listPendingInvitesForMe(),
    getCurrentUser(),
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
    </div>
  );
}
