"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { applyJevSubcategories, suggestSubcategoriesWithJev } from "@/actions/jev";
import type { JevSuggestion } from "@/actions/jev";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { JEV_MIN_SUBCATEGORIA, probabilityLabel } from "@/domain/jev";
import { formatCents } from "@/lib/money";

/**
 * O Jev separando em subcategorias o que ja foi importado (secao 15).
 *
 * Um botao por categoria que tem subcategorias, com a contagem do que esta
 * sem nenhuma. O Jev PROPOE; a lista aparece com a certeza de cada palpite,
 * ja marcada onde ele tem 80% ou mais, e so o que a casa deixar marcado e
 * gravado. O resto fica como estava.
 */

export interface JevCategoryRow {
  id: string;
  name: string;
  color: string;
  pending: number;
}

export function JevSubcategories({ rows }: { rows: JevCategoryRow[] }) {
  const comPendencia = rows.filter((r) => r.pending > 0);
  if (comPendencia.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Separar com o Jev"
        description="A IA olha cada estabelecimento e propõe a subcategoria. Nada muda antes de você confirmar."
      />
      <div className="space-y-2">
        {comPendencia.map((r) => (
          <JevCategory key={r.id} row={r} />
        ))}
      </div>
      <p className="mt-3 text-[12px] text-ink-faint">
        Vão ao OpenRouter só o nome da loja, o valor típico e os dias da semana — e a conta é a
        da chave da casa (centavos de milésimo por loja).
      </p>
    </Card>
  );
}

function JevCategory({ row }: { row: JevCategoryRow }) {
  const [pending, startTransition] = useTransition();
  const [sugestoes, setSugestoes] = useState<JevSuggestion[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  // Qual das duas acoes esta em curso: o botao de aplicar nao pode dizer
  // "Aplicando..." enquanto quem trabalha e o Jev.
  const [aplicando, setAplicando] = useState(false);

  function perguntar() {
    startTransition(async () => {
      const r = await suggestSubcategoriesWithJev({ categoryId: row.id });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      const lista = r.suggestions ?? [];
      setSugestoes(lista);
      setAviso(r.note ?? null);
      // Pre-marcado so o que o Jev tem certeza; o resto fica a um toque.
      setMarcadas(
        new Set(lista.filter((s) => s.probability >= JEV_MIN_SUBCATEGORIA).map((s) => s.merchant)),
      );
    });
  }

  function alternar(merchant: string) {
    setMarcadas((prev) => {
      const nova = new Set(prev);
      if (nova.has(merchant)) nova.delete(merchant);
      else nova.add(merchant);
      return nova;
    });
  }

  function aplicar() {
    if (!sugestoes) return;
    const items = sugestoes
      .filter((s) => marcadas.has(s.merchant))
      .map((s) => ({ merchant: s.merchant, subcategoryId: s.subcategoryId }));
    setAplicando(true);
    startTransition(async () => {
      const r = await applyJevSubcategories({ categoryId: row.id, items });
      setAplicando(false);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(`${r.count ?? 0} lançamento(s) separados em ${row.name}.`);
      // Sai da lista o que foi aplicado; o que ficou desmarcado continua a
      // vista, para quem quiser rever.
      setSugestoes((prev) => (prev ?? []).filter((s) => !marcadas.has(s.merchant)));
      setMarcadas(new Set());
    });
  }

  const nMarcadas = sugestoes?.filter((s) => marcadas.has(s.merchant)).length ?? 0;

  return (
    <div className="rounded-[--radius-control] bg-surface-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
        <span className="min-w-0 flex-1 text-[13px] text-ink">
          {row.name}
          <span className="tabular block text-[12px] text-ink-faint">
            {row.pending} lançamento(s) sem subcategoria
          </span>
        </span>
        {sugestoes === null ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={perguntar}>
            <Sparkles aria-hidden /> {pending ? "Perguntando ao Jev…" : "Sugerir"}
          </Button>
        ) : null}
      </div>

      {sugestoes !== null ? (
        <div className="mt-3">
          {sugestoes.length === 0 ? (
            <p className="text-[12px] text-ink-muted">
              O Jev não viu nada que se encaixe com segurança nas subcategorias de {row.name}.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {sugestoes.map((s) => (
                <li key={s.merchant}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
                      checked={marcadas.has(s.merchant)}
                      onChange={() => alternar(s.merchant)}
                      disabled={pending}
                    />
                    <span className="min-w-0 flex-1 text-[13px]">
                      <span className="block break-words text-ink">{s.label}</span>
                      <span className="tabular block text-[12px] text-ink-faint">
                        {s.count}× · {formatCents(s.medianCents)} · {Math.round(s.weekdayShare * 100)}% em dia{"\u00a0"}útil
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[12px]">
                      <span className="block text-ink">{s.subcategoryName}</span>
                      <span
                        className={
                          s.probability >= JEV_MIN_SUBCATEGORIA ? "tabular text-positive" : "tabular text-attention"
                        }
                      >
                        {probabilityLabel(s.probability)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {aviso ? <p className="mt-2 text-[12px] text-attention">{aviso}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {sugestoes.length > 0 ? (
              <Button size="sm" disabled={pending || nMarcadas === 0} onClick={aplicar}>
                {aplicando ? "Aplicando…" : `Aplicar ${nMarcadas}`}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setSugestoes(null)}>
              Fechar
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-ink-faint">
            O que você aplicar vira regra: a próxima fatura já chega separada.
          </p>
        </div>
      ) : null}
    </div>
  );
}
