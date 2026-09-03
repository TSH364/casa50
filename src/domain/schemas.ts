import { z } from "zod";
import { parseAmount } from "@/lib/money";
import { isMonthKey } from "./month";

/**
 * Schemas de validacao.
 *
 * O mesmo schema valida o formulario no cliente e a Server Action no
 * servidor. A validacao do servidor e a que vale: a do cliente existe para
 * dar retorno rapido, e um formulario pode ser burlado.
 */

/** Campo de texto opcional: string vazia vira `null`, nunca `""`. */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

/**
 * Valor monetario digitado pelo usuario ("1.234,56", "R$ 89,90", "-32,90").
 * Sempre positivo no resultado: o sinal contabil vem do tipo do lancamento.
 */
const money = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const parsed = parseAmount(v);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um valor válido." });
      return z.NEVER;
    }
    return Math.abs(parsed);
  })
  .pipe(z.number().max(99_999_999.99, "Valor alto demais."));

const optionalMoney = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const parsed = parseAmount(v);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um valor válido." });
      return z.NEVER;
    }
    return Math.abs(parsed);
  });

const uuid = z.string().uuid("Seleção inválida.");
const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" || v === "none" ? null : v))
  .nullable()
  .refine((v) => v === null || z.string().uuid().safeParse(v).success, {
    message: "Seleção inválida.",
  });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida.");

const monthKey = z.string().refine(isMonthKey, "Mês inválido.");

const day = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 31), {
    message: "Informe um dia entre 1 e 31.",
  });

// --------------------------------------------------------------------------
// Cartao
// --------------------------------------------------------------------------
export const cardSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome ao cartão.").max(60),
  institution: optionalText,
  lastFour: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^\d{4}$/.test(v), {
      message: "Informe os 4 últimos dígitos.",
    }),
  brand: optionalText,
  ownerId: optionalUuid,
  closingDay: day,
  dueDay: day,
  creditLimit: optionalMoney,
});

export type CardInput = z.infer<typeof cardSchema>;

// --------------------------------------------------------------------------
// Lancamento
// --------------------------------------------------------------------------
export const TRANSACTION_TYPES = [
  "expense",
  "income",
  "payment",
  "refund",
  "fee",
  "adjustment",
] as const;

export const transactionSchema = z
  .object({
    description: z.string().trim().min(2, "Descreva o lançamento.").max(200),
    date: isoDate,
    /** Mês da fatura. Pode diferir do mês da compra por causa do fechamento. */
    invoiceMonth: monthKey,
    amount: money,
    type: z.enum(TRANSACTION_TYPES),
    categoryId: optionalUuid,
    subcategoryId: optionalUuid,
    memberId: optionalUuid,
    cardId: optionalUuid,
    visibility: z.enum(["individual", "shared"]),
    splitType: z.enum(["none", "equal", "income_proportional", "custom"]),
    note: optionalText,
    merchantAlias: optionalText,
    installmentCurrent: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .refine((v) => v === null || (Number.isInteger(v) && v >= 1), "Parcela inválida."),
    installmentTotal: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .refine((v) => v === null || (Number.isInteger(v) && v >= 1), "Total inválido."),
  })
  .refine(
    (v) =>
      (v.installmentCurrent === null) === (v.installmentTotal === null) &&
      (v.installmentCurrent === null ||
        v.installmentTotal === null ||
        v.installmentCurrent <= v.installmentTotal),
    {
      message: "Preencha parcela e total juntos, com a parcela menor ou igual ao total.",
      path: ["installmentCurrent"],
    },
  )
  .refine((v) => v.splitType === "none" || v.visibility === "shared", {
    message: "Só faz sentido dividir uma despesa marcada como compartilhada.",
    path: ["splitType"],
  })
  .refine((v) => v.subcategoryId === null || v.categoryId !== null, {
    message: "Escolha a categoria antes da subcategoria.",
    path: ["subcategoryId"],
  });

export type TransactionInput = z.infer<typeof transactionSchema>;

export { uuid, isoDate, monthKey };
