import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { listPendingInvitesForMe } from "@/lib/houses";
import { NewHouseForm } from "@/components/new-house-form";
import { PendingInvites } from "@/components/house/pending-invites";

export const metadata: Metadata = { title: "Nova casa · Fluxo" };

/**
 * Fica fora do grupo (app) de proposito: o layout daquele grupo redireciona
 * para ca quando nao ha casa, e ter esta pagina dentro dele criaria um laco
 * de redirecionamento.
 *
 * E justamente por ser a tela de quem ainda nao tem casa que o convite
 * pendente precisa aparecer AQUI, antes do formulario. Sem isso, quem era
 * convidada chegava numa tela que so oferecia "crie sua casa", criava a
 * propria e ficava sozinha nela - o convite existia no banco e nunca era
 * visto.
 */
export default async function NovaCasaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const invites = await listPendingInvitesForMe();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="rise">
        <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-brand">
          Fluxo
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          {invites.length > 0 ? "Entre na casa" : "Crie sua casa"}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {invites.length > 0
            ? "Você foi convidado para uma casa que já existe. Aceite para dividir as contas com quem te convidou — criar outra deixaria vocês em casas separadas."
            : "A casa é o que separa suas finanças das de qualquer outra pessoa. Depois de criada, você convida quem divide as contas com você."}
        </p>
      </div>

      {invites.length > 0 ? (
        <div className="mt-6">
          <PendingInvites invites={invites} redirectTo="/inicio" />
        </div>
      ) : null}

      <div className="mt-8">
        {invites.length > 0 ? (
          <p className="mb-3 text-[13px] text-ink-faint">
            Ou crie uma casa separada:
          </p>
        ) : null}
        <NewHouseForm />
      </div>
    </main>
  );
}
