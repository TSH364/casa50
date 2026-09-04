"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fieldErrorsFrom, formToObject, requireHouseId } from "./shared";
import { selectHouse } from "@/app/casa-actions";
import type { FormState } from "./shared";

/**
 * Membros da casa (secao 4).
 *
 * O convite é por e-mail e fica pendente até a pessoa entrar com aquele
 * mesmo e-mail e aceitar. Enquanto pendente não existe `user_id`, e a linha
 * serve só para o `accept_house_invite` reconhecer quem chegou.
 *
 * Nada aqui envia e-mail: o app não tem serviço de envio, e prometer um
 * e-mail que não sai seria pior do que dizer que o convite precisa ser
 * repassado à mão.
 */

const ROLES = ["admin", "member", "viewer"] as const;

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("E-mail inválido.")
    .max(255),
  role: z.enum(ROLES, { message: "Escolha um papel." }),
});

export async function inviteMember(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = inviteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const houseId = await requireHouseId();
  const supabase = await createClient();
  const me = await getCurrentUser();

  if (me?.email?.toLowerCase() === parsed.data.email) {
    return { fieldErrors: { email: "Esse é o seu próprio e-mail." } };
  }

  // Já convidado ou já dentro: repetir o convite criaria uma segunda linha
  // pendente e o aceite pegaria uma delas ao acaso.
  const { data: existing } = await supabase
    .from("house_members")
    .select("id, status, invite_email, user_id, profiles(email)")
    .eq("house_id", houseId);

  const already = (existing ?? []).find((m) => {
    const inviteEmail = (m.invite_email as string | null)?.toLowerCase();
    const profile = m.profiles as unknown as { email?: string } | null;
    return (
      inviteEmail === parsed.data.email ||
      profile?.email?.toLowerCase() === parsed.data.email
    );
  });

  if (already) {
    return {
      fieldErrors: {
        email:
          already.status === "active"
            ? "Essa pessoa já faz parte da casa."
            : "Já existe um convite pendente para esse e-mail.",
      },
    };
  }

  const { error } = await supabase.from("house_members").insert({
    house_id: houseId,
    invite_email: parsed.data.email,
    role: parsed.data.role,
    status: "invited",
  });

  if (error) {
    console.error("[membros] falha ao convidar", { code: error.code });
    return { error: "Não foi possível criar o convite." };
  }

  revalidatePath("/casa");
  return { ok: true };
}

/** Cancela um convite ainda não aceito. */
export async function cancelInvite(memberId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("house_members")
    .delete()
    .eq("id", memberId)
    .eq("status", "invited");

  if (error) {
    console.error("[membros] falha ao cancelar convite", { code: error.code });
    return { error: "Não foi possível cancelar o convite." };
  }

  revalidatePath("/casa");
  return { ok: true };
}

/**
 * Aceita um convite pendente para a casa indicada.
 *
 * A conferência de e-mail acontece dentro do banco, em `accept_house_invite`:
 * validar aqui seria só cortesia, já que a função é a fronteira real.
 */
export async function acceptInvite(houseId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_house_invite", {
    p_house_id: houseId,
  });

  if (error) {
    console.error("[membros] falha ao aceitar convite", { code: error.code });
    return {
      error:
        error.code === "P0002"
          ? "Não há convite pendente para o seu e-mail nesta casa."
          : "Não foi possível aceitar o convite.",
    };
  }

  // Entra já na casa aceita. Sem isto, quem tinha criado uma casa antes de
  // ver o convite cairia de volta na própria: `getActiveHouse` escolhe a
  // primeira da lista quando não há cookie, e a primeira é a mais antiga.
  await selectHouse(houseId);

  revalidatePath("/casa");
  revalidatePath("/inicio");
  return { ok: true };
}

const roleSchema = z.enum(ROLES);

export async function changeMemberRole(
  memberId: string,
  role: string,
): Promise<FormState> {
  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) return { error: "Papel inválido." };

  const supabase = await createClient();
  // O dono não pode ser rebaixado: sem dono a casa fica sem quem administre.
  const { error } = await supabase
    .from("house_members")
    .update({ role: parsed.data })
    .eq("id", memberId)
    .neq("role", "owner");

  if (error) {
    console.error("[membros] falha ao mudar papel", { code: error.code });
    return { error: "Não foi possível alterar o papel." };
  }

  revalidatePath("/casa");
  return { ok: true };
}

export async function removeMember(memberId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("house_members")
    .delete()
    .eq("id", memberId)
    .neq("role", "owner");

  if (error) {
    console.error("[membros] falha ao remover", { code: error.code });
    return { error: "Não foi possível remover a pessoa." };
  }

  revalidatePath("/casa");
  return { ok: true };
}
