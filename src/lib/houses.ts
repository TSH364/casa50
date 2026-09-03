import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole, MemberStatus } from "@/domain/types";

export const HOUSE_COOKIE = "fluxo_casa";

export interface HouseSummary {
  id: string;
  name: string;
  role: MemberRole;
}

export interface MemberSummary {
  userId: string;
  fullName: string;
  email: string;
  role: MemberRole;
}

/**
 * Casas em que o usuario e membro ativo.
 *
 * Nao ha filtro por usuario na consulta de proposito: a policy
 * `houses_select` ja restringe as linhas. Repetir o filtro aqui daria a
 * impressao de que a seguranca depende deste arquivo, e ela nao depende.
 */
export async function listHouses(): Promise<HouseSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("house_members")
    .select("role, houses!inner(id, name)")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[casas] falha ao listar", { code: error.code });
    return [];
  }

  return (data ?? []).flatMap((row) => {
    const house = row.houses as unknown as { id: string; name: string } | null;
    return house ? [{ id: house.id, name: house.name, role: row.role as MemberRole }] : [];
  });
}

/**
 * Casa ativa: a do cookie, se o usuario ainda for membro dela; senao a
 * primeira da lista. Validar a pertinencia aqui evita que um cookie editado
 * a mao selecione uma casa alheia - ainda que o RLS ja fosse barrar as
 * consultas seguintes.
 */
export async function getActiveHouse(): Promise<{
  active: HouseSummary | null;
  houses: HouseSummary[];
}> {
  const houses = await listHouses();
  if (houses.length === 0) return { active: null, houses };

  const preferred = (await cookies()).get(HOUSE_COOKIE)?.value;
  const active = houses.find((h) => h.id === preferred) ?? houses[0] ?? null;
  return { active, houses };
}

/** Membros da casa, com nomes reais vindos de `profiles`. */
export async function listMembers(houseId: string): Promise<MemberSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("house_members")
    .select("role, user_id, profiles!inner(id, full_name, email)")
    .eq("house_id", houseId)
    .eq("status", "active");

  if (error) {
    console.error("[casas] falha ao listar membros", { code: error.code });
    return [];
  }

  return (data ?? []).flatMap((row) => {
    const p = row.profiles as unknown as
      | { id: string; full_name: string; email: string }
      | null;
    if (!p || !row.user_id) return [];
    return [
      {
        userId: p.id,
        fullName: p.full_name || p.email.split("@")[0] || "Membro",
        email: p.email,
        role: row.role as MemberRole,
      },
    ];
  });
}

/**
 * Todos os vínculos da casa, incluindo convites ainda não aceitos.
 *
 * `listMembers` devolve só quem já entrou, porque é isso que os seletores de
 * "quem gastou" precisam. A tela da casa precisa de mais: o id da linha, para
 * poder remover, e os convites pendentes, que ainda não têm perfil.
 */
export interface RosterEntry {
  /** Id da linha em `house_members` - é por ele que se remove ou cancela. */
  memberId: string;
  userId: string | null;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  invitedAt: string;
}

export async function listRoster(houseId: string): Promise<RosterEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("house_members")
    .select(
      "id, role, status, user_id, invite_email, invited_at, profiles(id, full_name, email)",
    )
    .eq("house_id", houseId)
    .in("status", ["active", "invited"])
    .order("status")
    .order("invited_at");

  if (error) {
    console.error("[casas] falha ao listar vínculos", { code: error.code });
    return [];
  }

  return (data ?? []).map((row) => {
    const p = row.profiles as unknown as
      | { id: string; full_name: string; email: string }
      | null;
    const email = p?.email ?? (row.invite_email as string) ?? "";
    return {
      memberId: row.id as string,
      userId: (row.user_id as string | null) ?? null,
      name: p?.full_name || email.split("@")[0] || "Convidado",
      email,
      role: row.role as MemberRole,
      status: row.status as MemberStatus,
      invitedAt: row.invited_at as string,
    };
  });
}

/**
 * Convites pendentes para o e-mail de quem está logado, em qualquer casa.
 *
 * Sem isto o convite seria intransitável: a pessoa entra no app, não é membro
 * de casa nenhuma e não teria por onde aceitar.
 */
export async function listPendingInvitesForMe(): Promise<
  { houseId: string; houseName: string }[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return [];

  const { data, error } = await supabase
    .from("house_members")
    .select("house_id, houses(name)")
    .eq("status", "invited")
    .ilike("invite_email", user.email);

  if (error) {
    console.error("[casas] falha ao listar convites", { code: error.code });
    return [];
  }

  return (data ?? []).map((row) => {
    const house = row.houses as unknown as { name: string } | null;
    return {
      houseId: row.house_id as string,
      houseName: house?.name ?? "Casa",
    };
  });
}
