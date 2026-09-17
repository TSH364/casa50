"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fieldErrorsFrom, formToObject, requireHouseId } from "./shared";
import type { FormState } from "./shared";
import { parseAmount } from "@/lib/money";
import { isMonthKey } from "@/domain/month";
import { fromMonthKey } from "@/data/mappers";

/**
 * Recorrências (secao 10).
 *
 * Uma recorrência é uma expectativa, não um lançamento: ela diz o que deve
 * aparecer todo mês, e a conciliação confere se apareceu. Nada aqui cria
 * lançamento sozinho — inventar movimento que o banco não registrou seria
 * exatamente o tipo de dado falso que a secao 20 proíbe.
 */

const amountField = z
  .string()
  .transform((v) => parseAmount(v))
  .refine((v): v is number => v !== null, "Valor inválido.")
  .refine((v) => v >= 0, "O valor não pode ser negativo.")
  .refine((v) => v <= 99_999_999, "Valor alto demais.");

const recurrenceSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Descreva a recorrência.")
    .max(120, "No máximo 120 caracteres."),
  merchant: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : null)),
  amount: amountField,
  interval: z.enum(["weekly", "monthly", "yearly"]),
  expectedDay: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? Number(v) : null))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 31),
      "Dia entre 1 e 31.",
    ),
  categoryId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
  cardId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
  ownerId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
});

/** Próxima ocorrência a partir de hoje, respeitando o dia esperado. */
function nextDateFrom(
  expectedDay: number | null,
  interval: "weekly" | "monthly" | "yearly",
  now = new Date(),
): string {
  if (interval !== "monthly" || expectedDay === null) {
    const d = new Date(now);
    d.setDate(d.getDate() + (interval === "weekly" ? 7 : 30));
    return d.toISOString().slice(0, 10);
  }

  const year = now.getFullYear();
  const month = now.getMonth();
  // Dia 31 num mês de 30: cai no último dia, em vez de virar o mês seguinte.
  const clampTo = (y: number, m: number) =>
    Math.min(expectedDay, new Date(y, m + 1, 0).getDate());

  const thisMonth = new Date(year, month, clampTo(year, month));
  if (thisMonth >= now) return thisMonth.toISOString().slice(0, 10);

  const next = new Date(year, month + 1, clampTo(year, month + 1));
  return next.toISOString().slice(0, 10);
}

export async function createRecurrence(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = recurrenceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase.from("recurrences").insert({
    house_id: houseId,
    description: d.description,
    merchant: d.merchant,
    amount: d.amount,
    category_id: d.categoryId,
    card_id: d.cardId,
    owner_id: d.ownerId,
    interval: d.interval,
    expected_day: d.expectedDay,
    next_date: nextDateFrom(d.expectedDay, d.interval),
    source: "manual",
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[recorrencias] falha ao criar", { code: error.code });
    return { error: "Não foi possível criar a recorrência." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  return { ok: true };
}

export async function updateRecurrence(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = recurrenceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase
    .from("recurrences")
    .update({
      description: d.description,
      merchant: d.merchant,
      amount: d.amount,
      category_id: d.categoryId,
      card_id: d.cardId,
      owner_id: d.ownerId,
      interval: d.interval,
      expected_day: d.expectedDay,
      next_date: nextDateFrom(d.expectedDay, d.interval),
    })
    .eq("id", id);

  if (error) {
    console.error("[recorrencias] falha ao editar", { code: error.code });
    return { error: "Não foi possível salvar a recorrência." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Aceita uma recorrência que o sistema detectou no histórico (secao 10).
 *
 * A detecção sugere; quem decide é o casal. Ela entra com `source` marcado
 * como `detected`, para a tela poder dizer que aquela linha começou como
 * palpite do sistema e não como cadastro deliberado.
 */
const candidateSchema = z.object({
  description: z.string().trim().min(1).max(120),
  merchant: z.string().trim().max(120).nullable(),
  amountCents: z.number().int().min(0).max(9_999_999_999),
  expectedDay: z.number().int().min(1).max(31).nullable(),
  categoryId: z.string().uuid().nullable(),
  cardId: z.string().uuid().nullable(),
});

export async function acceptDetectedRecurrence(
  input: unknown,
): Promise<FormState> {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) return { error: "Sugestão inválida." };

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();
  const d = parsed.data;

  const { error } = await supabase.from("recurrences").insert({
    house_id: houseId,
    description: d.description,
    merchant: d.merchant ?? d.description,
    amount: d.amountCents / 100,
    category_id: d.categoryId,
    card_id: d.cardId,
    owner_id: null,
    interval: "monthly",
    expected_day: d.expectedDay,
    next_date: nextDateFrom(d.expectedDay, "monthly"),
    source: "detected",
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[recorrencias] falha ao aceitar sugestao", {
      code: error.code,
    });
    return { error: "Não foi possível cadastrar a recorrência." };
  }

  revalidatePath("/previsao");
  return { ok: true };
}

export async function setRecurrenceActive(
  id: string,
  isActive: boolean,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("recurrences")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    console.error("[recorrencias] falha ao pausar", { code: error.code });
    return { error: "Não foi possível alterar a recorrência." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  return { ok: true };
}

export async function deleteRecurrence(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("recurrences").delete().eq("id", id);

  if (error) {
    console.error("[recorrencias] falha ao excluir", { code: error.code });
    return { error: "Não foi possível excluir a recorrência." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  return { ok: true };
}

const confirmarSchema = z.object({
  recurrenceId: z.string().uuid(),
  month: z.string().refine(isMonthKey, "Mês inválido."),
  /** O valor REALMENTE pago, que pode diferir do combinado. */
  amountCents: z.number().int().min(0).max(9_999_999_999),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/**
 * Lança a conta que não passa no cartão, já confirmada (secao 10).
 *
 * POR QUE ISTO EXISTE: a base tinha ZERO lançamentos manuais — tudo que o app
 * conhecia vinha de fatura. A parcela do financiamento, R$ 2.200 por mês e a
 * maior despesa fixa da casa, não entrava em total nenhum, e ainda ia marcar
 * "ausente" todo mês porque nenhuma fatura jamais traria um boleto.
 *
 * O APP COMPÕE, A CASA CONFIRMA. Tudo que dá para saber sozinho — data,
 * categoria, mês, estabelecimento, o vínculo com a recorrência — sai daqui
 * pronto. O que só a casa sabe é QUANTO foi pago, e por isso o valor chega
 * como parâmetro em vez de ser copiado do cadastro: parcela de financiamento
 * muda com juros, seguro e TR, e gravar o valor combinado como se fosse o
 * pago registraria errado em silêncio.
 *
 * Gravada como `confirmed`, e não `forecast`: quem toca no botão está dizendo
 * que pagou. Previsão é o que o app acha que vai acontecer; isto é fato.
 *
 * SEGURO DE REPETIR: o índice único (house_id, recurring_id, invoice_month)
 * para `origin = 'recurrence'` impede a segunda linha do mesmo mês. Dois
 * toques, ou duas abas, não viram duas parcelas — e dinheiro duplicado num
 * histórico é pior que dinheiro faltando: o que falta se percebe, o que sobra
 * parece gasto.
 */
export async function confirmRecurrencePayment(
  input: unknown,
): Promise<FormState> {
  const parsed = confirmarSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { recurrenceId, month, amountCents } = parsed.data;

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { data: recorrencia, error: leitura } = await supabase
    .from("recurrences")
    .select("id, description, merchant, category_id, owner_id, expected_day, off_card")
    .eq("house_id", houseId)
    .eq("id", recurrenceId)
    .maybeSingle();

  if (leitura) {
    console.error("[recorrencias] falha ao ler para confirmar", { code: leitura.code });
    return { error: "Não foi possível ler a recorrência." };
  }
  if (!recorrencia) return { error: "Recorrência não encontrada." };
  if (!recorrencia.off_card) {
    // A que passa no cartão chega pela fatura; lançá-la à mão criaria a mesma
    // despesa duas vezes quando a fatura for importada.
    return { error: "Esta conta chega pela fatura do cartão — não precisa ser lançada aqui." };
  }

  // A data do pagamento: a informada, ou o dia esperado dentro do mês. O
  // `Math.min` existe porque dia 31 não cabe em fevereiro.
  const diasNoMes = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const dia = Math.min(
    (recorrencia.expected_day as number | null) ?? diasNoMes,
    diasNoMes,
  );
  const data =
    parsed.data.date ?? `${month}-${String(dia).padStart(2, "0")}`;

  const { error } = await supabase.from("transactions").insert({
    house_id: houseId,
    recurring_id: recurrenceId,
    card_id: null,
    member_id: (recorrencia.owner_id as string | null) ?? null,
    date: data,
    invoice_month: fromMonthKey(month),
    description: recorrencia.description as string,
    merchant_original: (recorrencia.merchant as string | null) ?? null,
    amount: amountCents / 100,
    type: "expense" as const,
    origin: "recurrence" as const,
    status: "confirmed" as const,
    category_id: (recorrencia.category_id as string | null) ?? null,
    visibility: "shared" as const,
    created_by: user?.id ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "Esta conta já foi lançada neste mês." };
    }
    console.error("[recorrencias] falha ao lancar pagamento", { code: error.code });
    return { error: "Não foi possível lançar o pagamento." };
  }

  revalidatePath("/previsao");
  revalidatePath("/inicio");
  revalidatePath("/extratos");
  return { ok: true };
}
