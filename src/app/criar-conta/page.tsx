import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { signUp } from "@/app/entrar/actions";

export const metadata: Metadata = { title: "Criar conta · Fluxo" };

export default function CriarContaPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="rise">
        <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-brand">
          Fluxo
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Criar sua conta
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Depois você cria a casa e convida quem divide as contas com você.
        </p>
      </div>

      <div className="mt-8">
        <AuthForm mode="signUp" action={signUp} />
      </div>
    </main>
  );
}
