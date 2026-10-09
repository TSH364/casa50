import "server-only";
import { createClient } from "@/lib/supabase/server";
import { tabelaAusente } from "./radar";
import type { TipoDeEmail } from "@/domain/secretario";
import type { IsoDate } from "@/domain/types";

/**
 * O secretario como a tela o le: as conexoes de Gmail da casa e os e-mails
 * separados que ainda estao pendentes.
 *
 * `disponivel: false` quando as tabelas ainda nao existem - o codigo pode
 * subir antes da migracao (ver CLAUDE.md), e a tela explica em vez de cair.
 */

export interface ConexaoGmail {
  id: string;
  memberId: string;
  email: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface ItemDoSecretario {
  id: string;
  gmailId: string;
  memberId: string;
  /** O Gmail de onde veio, para abrir na conta certa. */
  conta: string | null;
  fromName: string | null;
  fromAddress: string | null;
  subject: string;
  receivedAt: string;
  tipo: TipoDeEmail;
  resumo: string;
  amountCents: number | null;
  dueDate: IsoDate | null;
  eventDate: IsoDate | null;
}

export interface SecretarioDados {
  disponivel: boolean;
  conexoes: ConexaoGmail[];
  pendentes: ItemDoSecretario[];
}

export async function carregarSecretario(houseId: string, limite = 60): Promise<SecretarioDados> {
  const supabase = await createClient();
  const { data: cx, error: cxError } = await supabase
    .from("email_connections")
    .select("id, member_id, email_address, last_sync_at, last_error")
    .eq("house_id", houseId);
  if (cxError) {
    if (!tabelaAusente(cxError.code)) console.error("[secretario] falha ao ler conexoes", { code: cxError.code });
    return { disponivel: !tabelaAusente(cxError.code), conexoes: [], pendentes: [] };
  }
  const conexoes: ConexaoGmail[] = (cx ?? []).map((c) => ({
    id: c.id as string,
    memberId: c.member_id as string,
    email: c.email_address as string,
    lastSyncAt: (c.last_sync_at as string | null) ?? null,
    lastError: (c.last_error as string | null) ?? null,
  }));
  if (conexoes.length === 0 || limite === 0) return { disponivel: true, conexoes, pendentes: [] };

  const { data, error } = await supabase
    .from("email_items")
    .select("id, gmail_id, connection_id, member_id, from_name, from_address, subject, received_at, kind, summary, amount, due_date, event_date")
    .eq("house_id", houseId)
    .eq("status", "pendente")
    .neq("kind", "informativo")
    .order("received_at", { ascending: false })
    .limit(limite);
  if (error) {
    console.error("[secretario] falha ao ler itens", { code: error.code });
    return { disponivel: true, conexoes, pendentes: [] };
  }
  const contaDe = new Map(conexoes.map((c) => [c.id, c.email]));
  return {
    disponivel: true,
    conexoes,
    pendentes: (data ?? []).map((r) => ({
      id: r.id as string,
      gmailId: r.gmail_id as string,
      memberId: r.member_id as string,
      conta: contaDe.get(r.connection_id as string) ?? null,
      fromName: (r.from_name as string | null) ?? null,
      fromAddress: (r.from_address as string | null) ?? null,
      subject: (r.subject as string | null) ?? "(sem assunto)",
      receivedAt: r.received_at as string,
      tipo: r.kind as TipoDeEmail,
      resumo: (r.summary as string | null) ?? "",
      amountCents: r.amount === null || r.amount === undefined ? null : Math.round(Number(r.amount) * 100),
      dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
      eventDate: r.event_date ? String(r.event_date).slice(0, 10) : null,
    })),
  };
}
