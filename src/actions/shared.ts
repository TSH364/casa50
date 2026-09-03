import "server-only";
import { z } from "zod";
import { getActiveHouse } from "@/lib/houses";

/**
 * Estado devolvido por toda Server Action de formulario.
 *
 * `fieldErrors` mapeia campo -> mensagem, para o erro aparecer ao lado do
 * campo errado em vez de num aviso generico no topo.
 */
export interface FormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export function fieldErrorsFrom(error: z.ZodError): FormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }
  return { error: "Confira os campos destacados.", fieldErrors };
}

/**
 * Casa ativa do usuario. Toda action escreve com este id.
 *
 * Nao e uma checagem de seguranca - o RLS ja recusaria uma gravacao em casa
 * alheia. Serve para saber em qual casa gravar quando ha mais de uma.
 */
export async function requireHouseId(): Promise<string> {
  const { active } = await getActiveHouse();
  if (!active) throw new Error("Nenhuma casa ativa.");
  return active.id;
}

/** Converte um FormData em objeto de strings, para o Zod validar. */
export function formToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
