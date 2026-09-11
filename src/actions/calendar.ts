"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireHouseId } from "./shared";
import type { FormState } from "./shared";
import { parseIcs } from "@/importers/ics";
import { classifyEvent } from "@/domain/calendar";
import { addMonths, currentMonth, daysInMonth } from "@/domain/month";
import type { IsoDate } from "@/domain/types";
import { isBlockedHost } from "@/lib/net";

/**
 * Agendas conectadas e sincronizacao (camada 1 da agenda).
 *
 * O que entra aqui e o "endereco secreto no formato iCal" do Google Agenda -
 * Configuracoes > Integrar agenda > Endereco secreto no formato iCal. Uma URL
 * somente-leitura, sem OAuth e sem token para renovar. Quem quiser desligar
 * apaga a agenda daqui ou reseta o endereco no Google, e o acesso morre.
 *
 * A sincronizacao e SEMPRE explicita, por botao. Nao ha job de fundo: o
 * servidor so busca a agenda quando alguem da casa pede, e isso mantem obvia
 * a resposta para "quando esse app leu meu calendario?".
 */

/** Quanto do passado e do futuro cada sincronizacao traz. */
const WINDOW_MONTHS_BACK = 12;
const WINDOW_MONTHS_AHEAD = 12;

/** Teto do arquivo baixado. Uma agenda pessoal cabe muito abaixo disso. */
const MAX_BYTES = 5_000_000;

/**
 * Quanto esperar pela agenda.
 *
 * A leitura manual pode demorar: tem gente olhando a tela, e a alternativa e
 * dizer "nao deu" para quem acabou de pedir. A automatica roda depois da
 * resposta da pagina, dentro do tempo que a funcao serverless ainda tem - e
 * la desistir cedo e melhor do que ser interrompida no meio.
 */
const FETCH_TIMEOUT_MS = 20_000;
const BACKGROUND_TIMEOUT_MS = 8_000;

/** Idade a partir da qual a agenda e relida sozinha. */
const STALE_HOURS = 12;

const addSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para a agenda.").max(60),
  url: z
    .string()
    .trim()
    .min(1, "Cole o endereço da agenda.")
    .url("Endereço inválido.")
    .refine((v) => v.startsWith("https://"), "O endereço precisa começar com https://"),
  ownerId: z.string().uuid().optional().or(z.literal("")),
});

/**
 * Busca o arquivo seguindo redirecionamentos a mao.
 *
 * `redirect: "manual"` existe para que cada salto passe pela mesma checagem
 * do primeiro: um servidor que responde 302 para `http://127.0.0.1` furaria
 * a barreira se o fetch seguisse sozinho.
 */
async function fetchIcs(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  let target = url;

  for (let hop = 0; hop < 4; hop += 1) {
    const parsed = new URL(target);
    if (parsed.protocol !== "https:") {
      throw new Error("O endereço da agenda precisa ser https.");
    }
    if (isBlockedHost(parsed.hostname)) {
      throw new Error("Esse endereço aponta para a rede interna e não será acessado.");
    }

    const response = await fetch(target, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("A agenda respondeu com um redirecionamento vazio.");
      target = new URL(location, target).toString();
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "A agenda recusou o acesso. Confira se o endereço é o secreto, no formato iCal.",
      );
    }
    if (response.status === 404) {
      throw new Error("Endereço não encontrado. O link pode ter sido redefinido no Google.");
    }
    if (!response.ok) {
      throw new Error(`A agenda respondeu com erro ${response.status}.`);
    }

    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new Error("O arquivo da agenda é grande demais.");

    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("O arquivo da agenda é grande demais.");
    if (!text.includes("BEGIN:VCALENDAR")) {
      throw new Error(
        "O endereço não devolveu um calendário. Confira se copiou o link no formato iCal.",
      );
    }
    return text;
  }

  throw new Error("A agenda redirecionou vezes demais.");
}

function syncWindow(): { from: IsoDate; to: IsoDate } {
  const now = currentMonth();
  const first = addMonths(now, -WINDOW_MONTHS_BACK);
  const last = addMonths(now, WINDOW_MONTHS_AHEAD);
  return {
    from: `${first}-01`,
    to: `${last}-${String(daysInMonth(last)).padStart(2, "0")}`,
  };
}

export interface SyncResult extends FormState {
  /** Ocorrencias gravadas. */
  events?: number;
  /** Quantas delas costumam custar dinheiro. */
  costly?: number;
  /** Agendas que falharam, com o motivo. */
  failed?: { name: string; message: string }[];
}

/** Sincroniza uma agenda. Devolve quantos eventos ficaram gravados. */
async function syncOne(
  sourceId: string,
  houseId: string,
  options: { timeoutMs?: number } = {},
): Promise<{ events: number; costly: number } | { error: string }> {
  const supabase = await createClient();

  // A URL nao e legivel pelo SELECT; so por este RPC, que confere permissao.
  const { data: url, error: urlError } = await supabase.rpc("calendar_source_url", {
    p_source_id: sourceId,
  });

  if (urlError || typeof url !== "string" || url === "") {
    console.error("[agenda] endereço indisponível", { code: urlError?.code });
    return { error: "Não foi possível ler o endereço desta agenda." };
  }

  const window = syncWindow();
  let occurrences;
  try {
    const text = await fetchIcs(url, options.timeoutMs);
    occurrences = parseIcs(text, window).occurrences;
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "A agenda demorou demais para responder."
        : error instanceof Error
          ? error.message
          : "Não foi possível ler a agenda.";
    // O motivo fica gravado para a tela poder explicar sem nova tentativa.
    await supabase
      .from("calendar_sources")
      .update({ last_error: message, last_synced_at: new Date().toISOString() })
      .eq("id", sourceId);
    return { error: message };
  }

  // Carimbo desta rodada. E ele que separa o que acabou de ser lido do que
  // sobrou da leitura anterior.
  const stamp = new Date().toISOString();

  const rows = occurrences.map((o) => ({
    house_id: houseId,
    source_id: sourceId,
    uid: o.uid,
    title: o.title.slice(0, 300),
    location: o.location?.slice(0, 300) ?? null,
    starts_on: o.startsOn,
    ends_on: o.endsOn,
    all_day: o.allDay,
    kind: classifyEvent(o.title, o.location),
    synced_at: stamp,
  }));

  // Duas ocorrencias com o mesmo (uid, dia de inicio) violariam o indice
  // unico; acontece quando o arquivo repete uma excecao. Fica a primeira.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.uid}|${r.starts_on}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Grava por cima ANTES de limpar, e nao o contrario. A agenda de fora e a
  // verdade, entao a leitura substitui tudo; mas apagar primeiro abriria uma
  // janela em que a casa nao tem compromisso nenhum - e, rodando sozinha no
  // fim de uma resposta, uma interrupcao nessa janela deixaria a agenda vazia
  // sem ninguem para notar. Nesta ordem, uma interrupcao deixa evento velho
  // sobrando, que a proxima leitura limpa.
  for (let i = 0; i < unique.length; i += 500) {
    const { error } = await supabase
      .from("calendar_events")
      .upsert(unique.slice(i, i + 500), { onConflict: "source_id,uid,starts_on" });
    if (error) {
      console.error("[agenda] falha ao gravar eventos", { code: error.code });
      return { error: "Não foi possível gravar os eventos desta agenda." };
    }
  }

  // O que ficou com carimbo antigo saiu da agenda la fora.
  const { error: pruneError } = await supabase
    .from("calendar_events")
    .delete()
    .eq("source_id", sourceId)
    .lt("synced_at", stamp);

  if (pruneError) {
    console.error("[agenda] falha ao limpar sobras", { code: pruneError.code });
    return { error: "Não foi possível atualizar os eventos desta agenda." };
  }

  await supabase
    .from("calendar_sources")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: null,
      event_count: unique.length,
    })
    .eq("id", sourceId);

  const costly = unique.filter((r) =>
    ["trip", "celebration", "health", "home"].includes(r.kind),
  ).length;

  return { events: unique.length, costly };
}

/** Cadastra a agenda e ja faz a primeira leitura. */
export async function addCalendarSource(input: unknown): Promise<SyncResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { name, url, ownerId } = parsed.data;

  const [houseId, user] = await Promise.all([requireHouseId(), getCurrentUser()]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("calendar_sources")
    .insert({
      house_id: houseId,
      name,
      url,
      kind: "ics",
      owner_id: ownerId || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Essa agenda já está conectada." };
    if (error.code === "23514") {
      return { error: "O endereço precisa começar com https://" };
    }
    console.error("[agenda] falha ao cadastrar", { code: error.code });
    return { error: "Não foi possível conectar a agenda." };
  }

  const result = await syncOne(data.id as string, houseId);
  revalidatePath("/casa");
  revalidatePath("/previsao");
  revalidatePath("/orcamentos");

  if ("error" in result) return { ok: true, error: result.error };
  return { ok: true, ...result };
}

/** Relê todas as agendas ativas da casa. */
export async function syncCalendars(): Promise<SyncResult> {
  const houseId = await requireHouseId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("calendar_sources")
    .select("id, name")
    .eq("house_id", houseId)
    .eq("is_active", true);

  if (error) {
    console.error("[agenda] falha ao listar", { code: error.code });
    return { error: "Não foi possível ler as agendas conectadas." };
  }
  if ((data ?? []).length === 0) {
    return { error: "Nenhuma agenda conectada ainda." };
  }

  let events = 0;
  let costly = 0;
  const failed: { name: string; message: string }[] = [];

  // Em serie, e nao em paralelo: sao duas ou tres agendas, e uma falha de
  // rede fica atribuida a agenda certa.
  for (const source of data ?? []) {
    const result = await syncOne(source.id as string, houseId);
    if ("error" in result) {
      failed.push({ name: source.name as string, message: result.error });
    } else {
      events += result.events;
      costly += result.costly;
    }
  }

  revalidatePath("/casa");
  revalidatePath("/previsao");
  revalidatePath("/orcamentos");
  revalidatePath("/insights");

  return { ok: true, events, costly, failed: failed.length > 0 ? failed : undefined };
}

export async function removeCalendarSource(sourceId: string): Promise<FormState> {
  if (!z.string().uuid().safeParse(sourceId).success) {
    return { error: "Agenda inválida." };
  }
  const supabase = await createClient();

  // Os eventos saem junto pelo `on delete cascade`.
  const { error } = await supabase.from("calendar_sources").delete().eq("id", sourceId);
  if (error) {
    console.error("[agenda] falha ao remover", { code: error.code });
    return { error: "Não foi possível desconectar a agenda." };
  }

  revalidatePath("/casa");
  revalidatePath("/previsao");
  revalidatePath("/orcamentos");
  return { ok: true };
}

/**
 * Rele as agendas vencidas, sozinha (camada 1).
 *
 * Chamada pelo `after()` do layout: roda DEPOIS que a pagina ja foi enviada,
 * entao nunca atrasa uma tela. Como consequencia, o que aparece na hora ainda
 * e a leitura anterior - a nova aparece na proxima visita. Para uma agenda que
 * muda com semanas de antecedencia, essa defasagem nao custa nada, e evitou
 * botar um segundo de espera em toda navegacao.
 *
 * Por que ligada ao uso, e nao a um horario fixo: assim nao ha nada rodando
 * quando ninguem esta usando o app, e nenhuma infraestrutura nova para manter.
 * A agenda so e lida quando alguem da casa abriu o Fluxo.
 *
 * Falha em silencio de proposito. Isto acontece fora do ciclo de vida da tela:
 * nao ha onde mostrar um erro, e derrubar a resposta ja enviada por causa de
 * uma agenda fora do ar seria trocar um problema pequeno por um grande. O
 * motivo fica gravado em `last_error`, visivel na tela Casa.
 */
export async function syncStaleCalendars(): Promise<void> {
  try {
    const houseId = await requireHouseId();
    const supabase = await createClient();
    const cutoff = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString();

    // Marcar antes de ler e o que impede duas abas (ou duas pessoas) de
    // dispararem a mesma leitura ao mesmo tempo: o UPDATE com filtro de idade
    // e atomico, e quem nao pegar a linha nao recebe nada de volta.
    //
    // O preco e que uma leitura interrompida so sera tentada de novo daqui a
    // `STALE_HOURS`. E o lado certo de errar: insistir a cada carregamento de
    // pagina numa agenda fora do ar bateria nela dezenas de vezes por hora. O
    // botao "Reler agendas" continua disponivel para forcar na hora.
    //
    // Duas consultas em vez de um `or(...)`: "nunca lida" e "lida ha muito"
    // sao conjuntos disjuntos (`NULL < x` nunca e verdadeiro), entao o
    // resultado e o mesmo - e nao depende de como o PostgREST interpreta um
    // timestamp dentro do texto de um filtro composto. Se essa leitura
    // falhasse em silencio, a sincronizacao automatica simplesmente nunca
    // aconteceria, e parecia com "o recurso nao funciona".
    const claimedAt = new Date().toISOString();
    const claim = (marcar: "vencida" | "nunca") => {
      const query = supabase
        .from("calendar_sources")
        .update({ last_synced_at: claimedAt })
        .eq("house_id", houseId)
        .eq("is_active", true);
      return (
        marcar === "nunca"
          ? query.is("last_synced_at", null)
          : query.lt("last_synced_at", cutoff)
      ).select("id");
    };

    const [vencidas, nunca] = await Promise.all([claim("vencida"), claim("nunca")]);
    const claimed = [...(vencidas.data ?? []), ...(nunca.data ?? [])];
    if (claimed.length === 0) return;

    let changed = false;
    for (const source of claimed) {
      const result = await syncOne(source.id as string, houseId, {
        timeoutMs: BACKGROUND_TIMEOUT_MS,
      });
      if (!("error" in result)) changed = true;
    }

    if (changed) {
      revalidatePath("/previsao");
      revalidatePath("/orcamentos");
      revalidatePath("/insights");
      revalidatePath("/casa");
    }
  } catch {
    // Sem casa ativa, sem sessao, agenda fora do ar: nada disso e motivo para
    // quebrar uma resposta que ja saiu.
  }
}
