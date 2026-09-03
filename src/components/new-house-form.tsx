"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createHouse, type HouseFormState } from "@/app/casa-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? "Criando…" : "Criar casa"}
    </Button>
  );
}

export function NewHouseForm() {
  const [state, formAction] = useActionState<HouseFormState, FormData>(
    createHouse,
    {},
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field
        label="Nome da casa"
        htmlFor="name"
        hint="Como vocês chamam a vida financeira de vocês."
        error={state.error}
      >
        <Input
          id="name"
          name="name"
          required
          maxLength={60}
          placeholder="Casa 50"
          aria-invalid={state.error ? true : undefined}
        />
      </Field>
      <Submit />
    </form>
  );
}
