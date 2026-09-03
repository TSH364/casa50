import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { NewHouseForm } from "@/components/new-house-form";

export const metadata: Metadata = { title: "Nova casa · Fluxo" };

/**
 * Fica fora do grupo (app) de proposito: o layout daquele grupo redireciona
 * para ca quando nao ha casa, e ter esta pagina dentro dele criaria um laco
 * de redirecionamento.
 */
export default async function NovaCasaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="rise">
        <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-brand">
          Fluxo
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Crie sua casa
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          A casa é o que separa suas finanças das de qualquer outra pessoa.
          Depois de criada, você convida quem divide as contas com você.
        </p>
      </div>

      <div className="mt-8">
        <NewHouseForm />
      </div>
    </main>
  );
}
