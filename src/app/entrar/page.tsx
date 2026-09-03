import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { signIn } from "./actions";

export const metadata: Metadata = { title: "Entrar · Fluxo" };

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string }>;
}) {
  const { proximo } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="rise">
        <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-brand">
          Fluxo
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Finanças do casal
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Entre para ver o mês, o comprometido e o previsto.
        </p>
      </div>

      <div className="mt-8">
        <AuthForm mode="signIn" action={signIn} next={proximo} />
      </div>
    </main>
  );
}
