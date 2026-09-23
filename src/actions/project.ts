"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { listCards, listTransactions } from "@/data/queries";
import { addMonths, currentMonth } from "@/domain/month";
import {
  needsLedgerEntry,
  rankCandidates,
  type LinkableTransaction,
} from "@/domain/purchase";
import { toCents } from "@/lib/money";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";

/**
 * Projetos: itens, cotações e compras (secao 15).
 *
 * "Projeto" e não "obra" porque a forma serve a qualquer coisa que se compre
 * por partes depois de juntar propostas — a reforma de agora, e o que vier
 * depois. O schema já dizia isso (`projects`); a tela é que dizia obra.
 *
 * Nada aqui grava resumo. Quantidade comprada, valor gasto e status saem da
 * soma das compras a cada leitura — ver `domain/project.ts`.
 */

const novoProjetoSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao projeto.").max(120),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function createProject(input: unknown): Promise<FormState & { id?: string }> {
  const parsed = novoProjetoSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .insert({
      house_id: houseId,
      name: parsed.data.name,
      started_on: parsed.data.startedOn ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[projetos] falha ao criar", { code: error.code });
    return { error: "Não foi possível criar o projeto." };
  }
  revalidatePath("/projetos");
  return { ok: true, id: data.id as string };
}

const itemSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, "Dê um nome ao item.").max(160),
  stage: z.string().trim().max(60).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  plannedQuantity: z.number().positive().max(9_999_999).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function addProjectItem(input: unknown): Promise<FormState> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { error } = await supabase.from("project_items").insert({
    house_id: houseId,
    project_id: parsed.data.projectId,
    name: parsed.data.name,
    stage: parsed.data.stage || null,
    unit: parsed.data.unit || null,
    planned_quantity: parsed.data.plannedQuantity ?? null,
    note: parsed.data.note || null,
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[projetos] falha ao criar item", { code: error.code });
    return { error: "Não foi possível adicionar o item." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

const itemDaPlanilhaSchema = z.object({
  name: z.string().trim().min(1).max(160),
  stage: z.string().trim().max(60).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  plannedQuantity: z.number().positive().max(9_999_999).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Fornecedor e valor viram UMA cotação, quando os dois vêm juntos. */
  supplier: z.string().trim().max(120).nullable().optional(),
  amountCents: z.number().int().min(0).max(9_999_999_999).nullable().optional(),
});

const importarItensSchema = z.object({
  projectId: z.string().uuid(),
  // O teto é do tamanho de uma planilha de obra, não de um banco de dados: mais
  // que isso é engano de arquivo, e o limite diz isso antes de gravar.
  items: z.array(itemDaPlanilhaSchema).min(1).max(500),
});

export interface ImportResult extends FormState {
  created?: number;
  quotes?: number;
  /** Itens que o projeto já tinha, com o mesmo nome e a mesma etapa. */
  duplicates?: string[];
}

/**
 * Grava de uma vez os itens que vieram de uma planilha (secao 15).
 *
 * O QUE CHEGA AQUI JÁ FOI CONFERIDO NA TELA: o arquivo é aberto no navegador e
 * a pessoa vê linha por linha antes de mandar. O servidor não lê planilha.
 *
 * NÃO REGRAVA O QUE JÁ EXISTE. Subir a mesma planilha duas vezes — porque a
 * primeira falhou no meio, porque a aba estava errada, porque o celular
 * recarregou — é o caminho mais provável até aqui, e duplicar quinze itens de
 * obra é o tipo de estrago que só se descobre na hora de somar. A comparação é
 * por nome e etapa, sem acento e sem caixa, que é como a pessoa lê "Piso
 * Vinilico" e "piso vinílico": o mesmo item.
 *
 * O preço da planilha vira COTAÇÃO, e não campo do item: previsto sai de
 * proposta, e uma proposta tem sempre de quem ela é. Linha sem fornecedor ou
 * sem valor entra como item sem cotação — que é a verdade sobre um item que
 * ainda não foi cotado.
 */
export async function importProjectItems(input: unknown): Promise<ImportResult> {
  const parsed = importarItensSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { data: existentes, error: erroExistentes } = await supabase
    .from("project_items")
    .select("name, stage, sort_order")
    .eq("house_id", houseId)
    .eq("project_id", parsed.data.projectId);

  if (erroExistentes) {
    console.error("[projetos] falha ao conferir itens", { code: erroExistentes.code });
    return { error: "Não foi possível conferir o que o projeto já tem." };
  }

  const chave = (name: string, stage?: string | null) =>
    `${name}|${stage ?? ""}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const jaTem = new Set(
    (existentes ?? []).map((r) => chave(r.name as string, r.stage as string | null)),
  );
  // Continua de onde a lista parou, para a ordem da planilha sobreviver a uma
  // segunda importação.
  let ordem = Math.max(0, ...(existentes ?? []).map((r) => Number(r.sort_order) || 0));

  const duplicates: string[] = [];
  const novos: typeof parsed.data.items = [];
  for (const item of parsed.data.items) {
    const k = chave(item.name, item.stage);
    if (jaTem.has(k)) {
      duplicates.push(item.name);
      continue;
    }
    // Contra duplicata DENTRO do próprio arquivo, e não só contra o banco: uma
    // aba de resumo repete o mesmo material em dois blocos.
    jaTem.add(k);
    novos.push(item);
  }

  if (novos.length === 0) {
    return { ok: true, created: 0, quotes: 0, duplicates };
  }

  const { data: gravados, error } = await supabase
    .from("project_items")
    .insert(
      novos.map((item) => ({
        house_id: houseId,
        project_id: parsed.data.projectId,
        name: item.name,
        stage: item.stage || null,
        unit: item.unit || null,
        planned_quantity: item.plannedQuantity ?? null,
        note: item.note || null,
        sort_order: (ordem += 1),
        created_by: user?.id ?? null,
      })),
    )
    .select("id, name, stage");

  if (error || !gravados) {
    console.error("[projetos] falha ao importar itens", { code: error?.code });
    return { error: "Não foi possível gravar os itens da planilha." };
  }

  // Casa cada cotação ao seu item PELO NOME, e não pela posição na lista: a
  // ordem das linhas devolvidas por um insert em lote é detalhe do banco, e
  // apostar nela erraria de um jeito que ninguém veria — o preço do porcelanato
  // no item da tinta, com o fornecedor errado junto.
  const idPorChave = new Map(
    gravados.map((row) => [chave(row.name as string, row.stage as string | null), row.id as string]),
  );

  const cotacoes = novos
    .map((item) => ({ id: idPorChave.get(chave(item.name, item.stage)), item }))
    .filter((p) => p.id && p.item.supplier && (p.item.amountCents ?? 0) > 0)
    .map((p) => ({
      house_id: houseId,
      item_id: p.id as string,
      supplier: p.item.supplier as string,
      amount: (p.item.amountCents as number) / 100,
      quantity: p.item.plannedQuantity ?? null,
      note: "Preço de referência da planilha",
      created_by: user?.id ?? null,
    }));

  let quotes = 0;
  if (cotacoes.length > 0) {
    const { error: erroCotacoes } = await supabase
      .from("project_quotes")
      .insert(cotacoes);
    if (erroCotacoes) {
      // Os itens já entraram, e dizer "não foi possível" apagaria isso da tela
      // sem apagar do banco. O número que volta é o que de fato aconteceu.
      console.error("[projetos] falha ao importar cotações", {
        code: erroCotacoes.code,
      });
    } else {
      quotes = cotacoes.length;
    }
  }

  revalidatePath("/projetos");
  return { ok: true, created: gravados.length, quotes, duplicates };
}

const cotacaoSchema = z.object({
  itemId: z.string().uuid(),
  supplier: z.string().trim().min(1, "Diga de quem é a proposta.").max(120),
  amountCents: z.number().int().min(0).max(9_999_999_999),
  quantity: z.number().positive().max(9_999_999).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  quotedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function addQuote(input: unknown): Promise<FormState> {
  const parsed = cotacaoSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { error } = await supabase.from("project_quotes").insert({
    house_id: houseId,
    item_id: parsed.data.itemId,
    supplier: parsed.data.supplier,
    amount: parsed.data.amountCents / 100,
    quantity: parsed.data.quantity ?? null,
    note: parsed.data.note || null,
    quoted_on: parsed.data.quotedOn ?? null,
    created_by: user?.id ?? null,
  });

  if (error) {
    console.error("[projetos] falha ao gravar cotacao", { code: error.code });
    return { error: "Não foi possível guardar a cotação." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

/**
 * Escolhe uma proposta, desmarcando a anterior do MESMO item.
 *
 * As duas escritas em ordem, e a limpeza primeiro: o banco tem índice único
 * de "uma escolhida por item", e marcar antes de desmarcar bateria nele.
 * Passar `null` em `quoteId` só desfaz a escolha.
 */
export async function chooseQuote(input: {
  itemId: string;
  quoteId: string | null;
}): Promise<FormState> {
  const schema = z.object({
    itemId: z.string().uuid(),
    quoteId: z.string().uuid().nullable(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { error: limpar } = await supabase
    .from("project_quotes")
    .update({ is_chosen: false })
    .eq("house_id", houseId)
    .eq("item_id", parsed.data.itemId)
    .eq("is_chosen", true);

  if (limpar) {
    console.error("[projetos] falha ao desmarcar cotacao", { code: limpar.code });
    return { error: "Não foi possível trocar a escolha." };
  }

  if (parsed.data.quoteId !== null) {
    const { error } = await supabase
      .from("project_quotes")
      .update({ is_chosen: true })
      .eq("house_id", houseId)
      .eq("id", parsed.data.quoteId)
      .eq("item_id", parsed.data.itemId);

    if (error) {
      console.error("[projetos] falha ao escolher cotacao", { code: error.code });
      return { error: "Não foi possível escolher esta proposta." };
    }
  }

  revalidatePath("/projetos");
  return { ok: true };
}

const compraSchema = z.object({
  itemId: z.string().uuid(),
  amountCents: z.number().int().min(0).max(9_999_999_999),
  quantity: z.number().positive().max(9_999_999).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplier: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Lançamento do cartão, quando a compra passou por ele. */
  transactionId: z.string().uuid().nullable().optional(),
  paymentMethod: z.enum(["card", "boleto", "pix", "cash"]).nullable().optional(),
  /** Mês em que a despesa cai; sem ele, o mês da data da compra. */
  invoiceMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
  installmentTotal: z.number().int().min(2).max(120).nullable().optional(),
  /** Nome do item, para a descrição do lançamento que nascer daqui. */
  itemName: z.string().trim().max(160).optional(),
  /**
   * Lançar a despesa nos totais do mês.
   *
   * Vem da tela, e não é deduzido da forma de pagamento: a casa confirma antes
   * de o app escrever dinheiro no extrato. Cartão ignora este campo — a fatura
   * já trouxe a despesa, e lançar de novo contaria duas vezes.
   */
  postToLedger: z.boolean().optional(),
});

export interface PurchaseResult extends FormState {
  /** O lançamento criado, quando a compra não passou no cartão. */
  postedTransactionId?: string;
}

/**
 * Registra a compra e, quando ela não passa no cartão, lança a despesa.
 *
 * POR QUE O LANÇAMENTO NASCE AQUI, e não numa segunda tela: uma obra se paga
 * muito por boleto e pix, e nada disso chega por fatura. Sem este lançamento,
 * os totais do mês contariam a parte da obra que caiu no cartão e ignorariam a
 * outra — metade da obra visível e metade invisível é pior que nenhuma das
 * duas, porque parece completo.
 *
 * O CARTÃO NÃO GERA LANÇAMENTO NENHUM. A fatura já traz, e a compra apenas
 * aponta para o lançamento que a casa escolheu. Criar um aqui contaria a mesma
 * despesa duas vezes.
 *
 * Se a compra grava e o lançamento falha, a compra FICA: ela é o registro da
 * obra, e desfazê-la por causa do extrato perderia o dado que mais custou a
 * digitar. O retorno diz o que de fato aconteceu.
 */
export async function addPurchase(input: unknown): Promise<PurchaseResult> {
  const parsed = compraSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  // O lançamento vinculado precisa ser DA CASA - o id vem do navegador, e a
  // chave estrangeira só confere que ele existe, não de quem é.
  if (parsed.data.transactionId) {
    const { data: lancamentoVinculado } = await supabase
      .from("transactions")
      .select("id")
      .eq("house_id", houseId)
      .eq("id", parsed.data.transactionId)
      .maybeSingle();
    if (!lancamentoVinculado) return { error: "Lançamento não encontrado." };
  }

  const method = parsed.data.paymentMethod ?? null;
  const mes = parsed.data.invoiceMonth ?? parsed.data.date.slice(0, 7);

  const { data: compra, error } = await supabase
    .from("project_purchases")
    .insert({
      house_id: houseId,
      item_id: parsed.data.itemId,
      transaction_id: parsed.data.transactionId ?? null,
      amount: parsed.data.amountCents / 100,
      quantity: parsed.data.quantity ?? null,
      date: parsed.data.date,
      supplier: parsed.data.supplier || null,
      note: parsed.data.note || null,
      payment_method: method,
      invoice_month: `${mes}-01`,
      installment_total: parsed.data.installmentTotal ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !compra) {
    console.error("[projetos] falha ao gravar compra", { code: error?.code });
    return { error: "Não foi possível registrar a compra." };
  }

  const lancar =
    parsed.data.postToLedger === true &&
    method !== null &&
    needsLedgerEntry(method) &&
    parsed.data.amountCents > 0;

  if (!lancar) {
    revalidatePath("/projetos");
    return { ok: true };
  }

  // A categoria vem do PROJETO: uma obra inteira cai na mesma, e perguntar a
  // cada compra seria mais um campo para responder sempre igual. Sem
  // categoria definida, entra sem - e a tela avisa isso antes de gravar.
  const { data: dono } = await supabase
    .from("project_items")
    .select("projects(category_id)")
    .eq("house_id", houseId)
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  // Relação muitos-para-um volta como objeto; o `Array.isArray` cobre a
  // tipagem do cliente, que não sabe disso.
  const relacao = dono?.projects as unknown;
  const projeto = (Array.isArray(relacao) ? relacao[0] : relacao) as
    | { category_id?: string | null }
    | null
    | undefined;
  const categoriaDoProjeto = projeto?.category_id ?? null;

  const { data: lancamento, error: erroLancamento } = await supabase
    .from("transactions")
    .insert({
      house_id: houseId,
      project_purchase_id: compra.id,
      category_id: categoriaDoProjeto,
      card_id: null,
      date: parsed.data.date,
      invoice_month: `${mes}-01`,
      description: parsed.data.itemName
        ? `Obra · ${parsed.data.itemName}`
        : "Obra · compra de projeto",
      merchant_original: parsed.data.supplier || null,
      amount: parsed.data.amountCents / 100,
      type: "expense",
      origin: "manual",
      status: "confirmed",
      member_id: user?.id ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (erroLancamento) {
    // 23505 é a trava de "um lançamento por compra": dois toques no botão, ou
    // duas abas. Não é erro para mostrar — o lançamento já existe.
    if (erroLancamento.code !== "23505") {
      console.error("[projetos] falha ao lançar a compra", {
        code: erroLancamento.code,
      });
      revalidatePath("/projetos");
      return {
        ok: true,
        error:
          "Compra registrada, mas não consegui lançar a despesa no mês. Lance à mão em Extratos.",
      };
    }
  }

  revalidatePath("/projetos");
  revalidatePath("/extratos");
  revalidatePath("/inicio");
  return { ok: true, postedTransactionId: lancamento?.id as string | undefined };
}

/**
 * Os lançamentos que podem ser esta compra, os mais parecidos primeiro.
 *
 * A BASE TEM CENTENAS DE LANÇAMENTOS. Pedir que alguém ache "o do porcelanato"
 * rolando a lista é pedir que desista, e um vínculo que dá trabalho não é
 * feito — e aí o item fica eternamente "a comprar" mesmo já pago. Por isso a
 * ordem vem pronta: fornecedor da proposta escolhida e valor previsto, que são
 * os dois sinais que a pessoa usaria de qualquer jeito (ver `domain/purchase`).
 *
 * Só despesa, e só o último ano: receita e estorno não compram material, e uma
 * obra não se paga com fatura de dois anos atrás.
 */
export async function findTransactionsForItem(input: {
  supplier?: string | null;
  expectedCents?: number | null;
  search?: string;
}): Promise<{ error?: string; candidates?: LinkableTransaction[] }> {
  const schema = z.object({
    supplier: z.string().trim().max(120).nullable().optional(),
    expectedCents: z.number().int().min(0).nullable().optional(),
    search: z.string().trim().max(80).optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Busca inválida." };

  const houseId = await requireHouseId();

  const transactions = await listTransactions(houseId, {
    fromMonth: addMonths(currentMonth(), -12),
    search: parsed.data.search || undefined,
  });

  const cards = await listCards(houseId);
  const rotuloPorCartao = new Map(
    cards.map((c) => [c.id, c.lastFour ? `${c.name} ·${c.lastFour}` : c.name]),
  );

  const linkable: LinkableTransaction[] = transactions
    .filter((t) => t.type === "expense" && !t.isHidden)
    .map((t) => ({
      id: t.id,
      date: t.date,
      invoiceMonth: t.invoiceMonth,
      description: t.description,
      merchant: t.merchantAlias ?? t.merchantNormalized ?? t.merchantOriginal,
      amountCents: toCents(t.amount),
      installmentCurrent: t.installment?.current ?? null,
      installmentTotal: t.installment?.total ?? null,
      installmentValueCents:
        t.installment?.value === null || t.installment?.value === undefined
          ? null
          : toCents(t.installment.value),
      cardLabel: t.cardId ? (rotuloPorCartao.get(t.cardId) ?? null) : null,
    }));

  const ranked = rankCandidates(linkable, {
    supplier: parsed.data.supplier,
    expectedCents: parsed.data.expectedCents,
  });

  // Vinte é o que cabe numa tela de celular sem virar outra lista para rolar.
  // Quando o certo não está entre eles, a busca por nome é o caminho.
  return { candidates: ranked.slice(0, 20).map((c) => c.transaction) };
}

/**
 * A categoria em que entram as despesas que o projeto lança.
 *
 * Vale para o que vier DEPOIS: trocar aqui não reclassifica o que já foi
 * lançado. Mexer em lançamento antigo a partir de uma tela que não o mostra
 * mudaria o orçamento de meses fechados sem que ninguém visse — e o extrato é
 * o lugar de reclassificar, onde o lançamento aparece.
 */
export async function setProjectCategory(input: {
  projectId: string;
  categoryId: string | null;
}): Promise<FormState> {
  const schema = z.object({
    projectId: z.string().uuid(),
    categoryId: z.string().uuid().nullable(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const houseId = await requireHouseId();
  const supabase = await createClient();

  // A categoria precisa ser DA CASA e de PRIMEIRO NÍVEL - o id vem do
  // navegador. A chave estrangeira só confere que ela existe, não de quem é:
  // sem isto, um id de categoria de outra casa passaria, e os lançamentos da
  // obra apontariam para dado alheio. E subcategoria não serve porque o
  // lançamento guarda categoria e subcategoria em colunas separadas - uma
  // filha em `category_id` desmontaria o orçamento por categoria.
  if (parsed.data.categoryId !== null) {
    const { data: categoria, error: erroCategoria } = await supabase
      .from("categories")
      .select("id, parent_id")
      .eq("house_id", houseId)
      .eq("id", parsed.data.categoryId)
      .maybeSingle();

    if (erroCategoria || !categoria) return { error: "Categoria não encontrada." };
    if (categoria.parent_id !== null) {
      return { error: "Escolha uma categoria, e não uma subcategoria." };
    }
  }

  const { error } = await supabase
    .from("projects")
    .update({ category_id: parsed.data.categoryId })
    .eq("house_id", houseId)
    .eq("id", parsed.data.projectId);

  if (error) {
    console.error("[projetos] falha ao definir categoria", { code: error.code });
    return { error: "Não foi possível guardar a categoria." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

/**
 * O que comprar primeiro.
 *
 * Três níveis e não cinco: com cinco, quem usa marca tudo como 2 ou 4 e o
 * campo deixa de separar o que importa. `null` desmarca.
 */
export async function setItemPriority(input: {
  itemId: string;
  priority: 1 | 2 | 3 | null;
}): Promise<FormState> {
  const schema = z.object({
    itemId: z.string().uuid(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_items")
    .update({ priority: parsed.data.priority })
    .eq("house_id", houseId)
    .eq("id", parsed.data.itemId);

  if (error) {
    console.error("[projetos] falha ao marcar prioridade", { code: error.code });
    return { error: "Não foi possível mudar a prioridade." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

export async function removePurchase(id: string): Promise<FormState> {
  if (!z.string().uuid().safeParse(id).success) return { error: "Dados inválidos." };
  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_purchases")
    .delete()
    .eq("house_id", houseId)
    .eq("id", id);

  if (error) {
    console.error("[projetos] falha ao remover compra", { code: error.code });
    return { error: "Não foi possível remover a compra." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

/**
 * Dá o item por encerrado, ou reabre.
 *
 * Existe porque sobra de material, troca de escopo e desconto no fim da obra
 * são normais: sem esta saída, um item que comprou 55 dos 60 ficaria parcial
 * até o fim da obra e viraria ruído permanente na lista.
 */
export async function setItemClosed(input: {
  itemId: string;
  closed: boolean;
}): Promise<FormState> {
  const schema = z.object({ itemId: z.string().uuid(), closed: z.boolean() });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_items")
    .update({ closed_at: parsed.data.closed ? new Date().toISOString() : null })
    .eq("house_id", houseId)
    .eq("id", parsed.data.itemId);

  if (error) {
    console.error("[projetos] falha ao encerrar item", { code: error.code });
    return { error: "Não foi possível encerrar o item." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}

export async function removeProjectItem(id: string): Promise<FormState> {
  if (!z.string().uuid().safeParse(id).success) return { error: "Dados inválidos." };
  const houseId = await requireHouseId();
  const supabase = await createClient();

  // As cotações e compras vão junto por `on delete cascade`: um item sem
  // dono deixaria histórico órfão que nenhuma tela alcança.
  const { error } = await supabase
    .from("project_items")
    .delete()
    .eq("house_id", houseId)
    .eq("id", id);

  if (error) {
    console.error("[projetos] falha ao remover item", { code: error.code });
    return { error: "Não foi possível remover o item." };
  }
  revalidatePath("/projetos");
  return { ok: true };
}
