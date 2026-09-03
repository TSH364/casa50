"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";

export interface AuthFormState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail valido."),
  password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres."),
});

const signUpSchema = credentials.extend({
  fullName: z.string().trim().min(2, "Informe seu nome."),
});

/** Caminho interno seguro para redirecionar apos o login. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Sem isso, `?proximo=https://site-malicioso` viraria um open redirect.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/inicio";
}

/**
 * Mensagens de erro sao deliberadamente genericas: dizer "e-mail nao
 * cadastrado" permite enumerar quem tem conta no sistema.
 */
export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados invalidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Nao logamos o e-mail nem a resposta bruta: sao dados pessoais.
    console.warn("[auth] falha de login", { code: error.code });
    return { error: "E-mail ou senha incorretos." };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("proximo")));
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados invalidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Lido pelo trigger app.handle_new_user() para criar o perfil com o
      // nome real - por isso nunca ha nome fixo em codigo.
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${siteUrl()}/auth/confirmar`,
    },
  });

  if (error) {
    console.warn("[auth] falha de cadastro", { code: error.code });
    return { error: "Nao foi possivel criar a conta. Tente novamente." };
  }

  // Com confirmacao de e-mail ligada, nao ha sessao ainda.
  if (data.session === null) {
    return {
      message:
        "Conta criada. Confirme o e-mail que enviamos para ativar o acesso.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/inicio");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/entrar");
}
