"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";

/** `count` diz quantos lancamentos passados a subcategoria adotou. */
export type AcceptResult = FormState & { count?: number };

/**
 * Aceitar ou recusar uma proposta de subcategoria (secao 14).
 *
 * O motor que PROPOE mora em `src/domain/subcategories.ts` e nao grava nada.
 * Este arquivo e o outro lado: o que acontece quando a casa diz "sim".
 *
 * Um "sim" faz tres coisas, e as tres importam:
 *
 *   1. cria a subcategoria sob a categoria-pai;
 *   2. marca os lancamentos PASSADOS daquele estabelecimento - sem isso, a
 *      subcategoria nasceria vazia e so faria sentido dali para a frente,
 *      justamente quando o valor dela e explicar os oito meses ja importados;
 *   3. guarda a regra em `learned_rules`, para a proxima fatura ja chegar
 *      separada e a casa nao ter de repetir a decisao todo mes.
 *
 * A regra e por ESTABELECIMENTO, nunca por dia da semana. O dia foi a
 * evidencia que levantou a proposta; usa-lo como regra classificaria um
 * almoco de sabado no mesmo lugar como se fosse outro tipo de gasto.
 */

const aceitarSchema = z.object({
  categoryId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome à subcategoria.")
    .max(60, "No máximo 60 caracteres."),
  /** Estabelecimentos, ja normalizados - a mesma chave que o importador usa. */
  merchants: z.array(z.string().trim().min(1)).min(1).max(200),
});

function revalidar() {
  revalidatePath("/categorias");
  revalidatePath("/extratos");
  revalidatePath("/insights");
  revalidatePath("/inicio");
}

export async function acceptSubcategorySuggestion(
  input: z.input<typeof aceitarSchema>,
): Promise<AcceptResult> {
  const parsed = aceitarSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { categoryId, name, merchants } = parsed.data;

  const [houseId, user, supabase] = await Promise.all([
    requireHouseId(),
    getCurrentUser(),
    createClient(),
  ]);

  // A categoria-pai tem de ser mesmo uma categoria-pai desta casa. Sem esta
  // checagem, um id de subcategoria criaria um terceiro nivel de arvore.
  const { data: parent } = await supabase
    .from("categories")
    .select("id, parent_id, color")
    .eq("id", categoryId)
    .eq("house_id", houseId)
    .maybeSingle();

  if (!parent) return { error: "Categoria não encontrada." };
  if (parent.parent_id) {
    return { error: "Uma subcategoria não pode conter outra subcategoria." };
  }

  // A subcategoria herda a cor da mae: nos graficos ela aparece como uma
  // parte de "Alimentacao", e uma cor nova a faria parecer outra despesa.
  const { data: criada, error: erroCriar } = await supabase
    .from("categories")
    .insert({
      house_id: houseId,
      name,
      color: String(parent.color),
      parent_id: categoryId,
    })
    .select("id")
    .single();

  if (erroCriar || !criada) {
    console.error("[subcategorias] falha ao criar", { code: erroCriar?.code });
    return { error: "Não foi possível criar a subcategoria." };
  }

  const subcategoryId = criada.id as string;

  // Só os que ainda não têm subcategoria. Um lançamento já classificado à mão
  // é decisão tomada, e proposta não desfaz decisão.
  const { data: marcados, error: erroAplicar } = await supabase
    .from("transactions")
    .update({ subcategory_id: subcategoryId })
    .eq("house_id", houseId)
    .eq("category_id", categoryId)
    .is("subcategory_id", null)
    .in("merchant_normalized", merchants)
    .select("id");

  if (erroAplicar) {
    console.error("[subcategorias] falha ao aplicar", {
      code: erroAplicar.code,
    });
    // A subcategoria ficou criada e vazia. Dizer isso e melhor que apagar em
    // silencio: apagar poderia levar junto o que outra pessoa ja tivesse
    // movido para ela nesse meio-tempo.
    return {
      error:
        "A subcategoria foi criada, mas os lançamentos antigos não foram marcados. Tente de novo pela tela de Extratos.",
    };
  }

  // `normalized_pattern` sai do trigger `learned_rules_fill`, que aplica a
  // mesma normalizacao de `merchant_normalized` - MEDIDO nas 596 linhas reais:
  // normalizar de novo um valor ja normalizado devolve ele mesmo.
  const { error: erroRegra } = await supabase.from("learned_rules").upsert(
    merchants.map((pattern) => ({
      house_id: houseId,
      pattern,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      created_by: user?.id ?? null,
    })),
    { onConflict: "house_id,normalized_pattern" },
  );

  if (erroRegra) {
    // Falha em silencio para o usuario, como no aprendizado por edicao: o que
    // ele pediu (separar o passado) esta feito; so a proxima fatura e que vai
    // precisar da decisao de novo.
    console.error("[subcategorias] falha ao aprender a regra", {
      code: erroRegra.code,
    });
  }

  revalidar();
  return { ok: true, count: marcados?.length ?? 0 };
}

const recusarSchema = z.object({
  categoryId: z.string().uuid(),
  suggestionKey: z.string().trim().min(1).max(40),
});

export async function dismissSubcategorySuggestion(
  input: z.input<typeof recusarSchema>,
): Promise<FormState> {
  const parsed = recusarSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const [houseId, user, supabase] = await Promise.all([
    requireHouseId(),
    getCurrentUser(),
    createClient(),
  ]);

  // `ignoreDuplicates` nao e detalhe de conveniencia: a tabela so tem politica
  // de INSERT e DELETE, e um upsert comum vira `on conflict do update`, que o
  // RLS recusaria. Recusar duas vezes a mesma proposta tem de ser silencio, e
  // nao erro - a segunda recusa nao diz nada de novo.
  const { error } = await supabase.from("subcategory_dismissals").upsert(
    {
      house_id: houseId,
      category_id: parsed.data.categoryId,
      suggestion_key: parsed.data.suggestionKey,
      dismissed_by: user?.id ?? null,
    },
    { onConflict: "house_id,category_id,suggestion_key", ignoreDuplicates: true },
  );

  if (error) {
    console.error("[subcategorias] falha ao recusar", { code: error.code });
    return { error: "Não foi possível guardar a recusa." };
  }

  revalidatePath("/categorias");
  return { ok: true };
}

export async function restoreSubcategorySuggestion(
  input: z.input<typeof recusarSchema>,
): Promise<FormState> {
  const parsed = recusarSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const [houseId, supabase] = await Promise.all([
    requireHouseId(),
    createClient(),
  ]);

  const { error } = await supabase
    .from("subcategory_dismissals")
    .delete()
    .eq("house_id", houseId)
    .eq("category_id", parsed.data.categoryId)
    .eq("suggestion_key", parsed.data.suggestionKey);

  if (error) {
    console.error("[subcategorias] falha ao desfazer a recusa", {
      code: error.code,
    });
    return { error: "Não foi possível trazer a sugestão de volta." };
  }

  revalidatePath("/categorias");
  return { ok: true };
}
