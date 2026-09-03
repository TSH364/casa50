"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";
import { fromMonthKey } from "@/data/mappers";
import { isMonthKey } from "@/domain/month";

/**
 * Acerto do mes (secao 15).
 *
 * O acerto e um registro do que foi combinado e pago entre as pessoas da
 * casa. Ele NAO cria lancamento: transferir dinheiro entre o casal nao e
 * despesa nova, e lancar isso dobraria o gasto do mes.
 */

const settlementSchema = z.object({
  month: z.string().refine(isMonthKey, "Mes invalido."),
  fromMemberId: z.string().uuid(),
  toMemberId: z.string().uuid(),
  amountCents: z.number().int().positive().max(9_999_999_999),
  note: z.string().trim().max(300).nullable().optional(),
});

export async function recordSettlement(input: unknown): Promise<FormState> {
  const parsed = settlementSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados invalidos." };
  }
  const d = parsed.data;

  if (d.fromMemberId === d.toMemberId) {
    return { error: "Nao da para acertar consigo mesmo." };
  }

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { error } = await supabase.from("settlements").insert({
    house_id: houseId,
    month: fromMonthKey(d.month),
    from_member: d.fromMemberId,
    to_member: d.toMemberId,
    amount: d.amountCents / 100,
    note: d.note ?? null,
    // Registrado ja como pago: o gesto na tela e "marcamos que isso foi
    // acertado", nao "prometemos acertar".
    paid_at: new Date().toISOString(),
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[acerto] falha ao registrar", { code: error.code });
    return { error: "Nao foi possivel registrar o acerto." };
  }

  revalidatePath("/acerto");
  revalidatePath("/inicio");
  return { ok: true };
}

export async function deleteSettlement(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("settlements").delete().eq("id", id);

  if (error) {
    console.error("[acerto] falha ao excluir", { code: error.code });
    return { error: "Nao foi possivel excluir o acerto." };
  }

  revalidatePath("/acerto");
  revalidatePath("/inicio");
  return { ok: true };
}
