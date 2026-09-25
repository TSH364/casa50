import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Verificacao de permissao em funcao PL/pgSQL.
 *
 * O DEFEITO QUE ESTE TESTE IMPEDE DE VOLTAR: `app.can_write` e `app.can_admin`
 * devolvem NULL para quem nao e da casa, e em PL/pgSQL `if not NULL` NAO ENTRA
 * no if. A verificacao `if not app.can_write(casa) then raise ...` era pulada
 * justamente para quem ela devia barrar.
 *
 * MEDIDO no banco real, em 25/09/2026: um usuario de fora da casa chamou
 * `calendar_source_url` e recebeu o endereco privado da agenda. E a chave de
 * IA, recem-criada com o mesmo padrao, seria lida por qualquer usuario logado.
 * O certo e `is not true`, que trata NULL como recusa.
 *
 * O teste olha a versao EM VIGOR de cada funcao - a ultima migracao que a
 * define -, e nao o historico: migracao antiga nao se reescreve, se corrige
 * com uma nova.
 */

const PASTA = join(__dirname, "../../supabase/migrations");

const INSEGURO = /\bif\s+not\s+app\.(can_write|can_admin|is_member)\s*\(/i;

function definicoesEmVigor(): Map<string, { arquivo: string; corpo: string }> {
  const arquivos = readdirSync(PASTA)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const vigentes = new Map<string, { arquivo: string; corpo: string }>();

  for (const arquivo of arquivos) {
    const sql = readFileSync(join(PASTA, arquivo), "utf8");
    const re = /create\s+or\s+replace\s+function\s+([a-z_.]+)\s*\(([\s\S]*?)\$fn\$([\s\S]*?)\$fn\$/gi;
    for (const m of sql.matchAll(re)) {
      vigentes.set(m[1]!.toLowerCase(), { arquivo, corpo: m[3]! });
    }
  }
  return vigentes;
}

describe("permissão em função PL/pgSQL", () => {
  const vigentes = definicoesEmVigor();

  it("encontra as funções que guardam segredo", () => {
    // Se o parser parar de achar as funcoes, o teste abaixo passaria sem
    // olhar nada. Esta linha garante que ele esta olhando.
    for (const nome of [
      "public.calendar_source_url",
      "public.ai_key_for_house",
      "public.set_ai_key",
      "public.clear_ai_key",
    ]) {
      expect(vigentes.has(nome), nome).toBe(true);
    }
  });

  it("nenhuma função em vigor usa `if not app.can_*(...)`", () => {
    const inseguras = [...vigentes.entries()]
      .filter(([, d]) => INSEGURO.test(d.corpo))
      .map(([nome, d]) => `${nome} (${d.arquivo})`);
    expect(inseguras).toEqual([]);
  });

  it("o padrão antigo existia de fato — o teste pegaria a regressão", () => {
    // A migracao da agenda, de antes da correcao, ainda tem o padrao: e a
    // prova de que a expressao acha o que diz achar.
    const antiga = readFileSync(join(PASTA, "20260910000003_agenda.sql"), "utf8");
    expect(INSEGURO.test(antiga)).toBe(true);
  });
});
