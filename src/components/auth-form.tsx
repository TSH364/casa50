"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { AuthFormState } from "@/app/entrar/actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? "Aguarde…" : label}
    </Button>
  );
}

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "signIn" | "signUp";
  action: (prev: AuthFormState, data: FormData) => Promise<AuthFormState>;
  next?: string;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const isSignUp = mode === "signUp";

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="proximo" value={next} /> : null}

      {isSignUp ? (
        <Field label="Seu nome" htmlFor="fullName" hint="É como você aparece para a casa.">
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            placeholder="Nome e sobrenome"
          />
        </Field>
      ) : null}

      <Field label="E-mail" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="voce@exemplo.com"
        />
      </Field>

      <Field
        label="Senha"
        htmlFor="password"
        hint={isSignUp ? "Pelo menos 8 caracteres." : undefined}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={8}
        />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-[--radius-control] bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}

      {state.message ? (
        <p role="status" className="rounded-[--radius-control] bg-positive-soft px-3 py-2 text-[13px] text-positive">
          {state.message}
        </p>
      ) : null}

      <SubmitButton label={isSignUp ? "Criar conta" : "Entrar"} />

      <p className="pt-1 text-center text-[13px] text-ink-faint">
        {isSignUp ? "Já tem conta? " : "Ainda não tem conta? "}
        <Link
          href={isSignUp ? "/entrar" : "/criar-conta"}
          className="text-brand hover:underline"
        >
          {isSignUp ? "Entrar" : "Criar conta"}
        </Link>
      </p>
    </form>
  );
}
