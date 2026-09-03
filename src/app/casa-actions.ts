"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { HOUSE_COOKIE, listHouses } from "@/lib/houses";

export interface HouseFormState {
  error?: string;
}

const nameSchema = z
  .string()
  .trim()
  .min(2, "Dê um nome com pelo menos 2 caracteres.")
  .max(60, "Nome muito longo.");

/**
 * Troca a casa ativa.
 * Grava o cookie apenas se o usuario for mesmo membro da casa pedida.
 */
export async function selectHouse(houseId: string) {
  const houses = await listHouses();
  if (!houses.some((h) => h.id === houseId)) {
    // Nao revelamos se a casa existe: so recusamos.
    return;
  }

  (await cookies()).set(HOUSE_COOKIE, houseId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}

/**
 * Cria a casa. O trigger `houses_bootstrap` cuida de tornar o criador owner
 * e de semear as categorias iniciais, numa unica transacao com o insert.
 */
export async function createHouse(
  _prev: HouseFormState,
  formData: FormData,
): Promise<HouseFormState> {
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nome inválido." };
  }

  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("houses")
    .insert({ name: parsed.data, owner_id: user.id })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[casas] falha ao criar", { code: error?.code });
    return { error: "Não foi possível criar a casa. Tente novamente." };
  }

  await selectHouse(data.id);
  redirect("/inicio");
}
