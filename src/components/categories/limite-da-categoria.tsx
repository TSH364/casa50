"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Gauge } from "lucide-react";
import { setBudget } from "@/actions/budgets";
import { monthLabel } from "@/domain/month";
import { formatCents, parseAmountCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";

/**
 * O limite de gasto da categoria, na propria lista de Categorias: era so na
 * tela de Orcamentos, que quase ninguem achava.
 *
 * O limite vale do mes atual em diante, ate ser mudado (ver `limitesDoMes`).
 * Vazio ou zero tira o limite daqui em diante.
 */
export function LimiteDaCategoria({
  categoryId,
  nome,
  limiteCents,
  mes,
}: {
  categoryId: string;
  nome: string;
  /** O limite que vale no mes; 0 = sem limite. */
  limiteCents: number;
  mes: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(limiteCents > 0 ? String(limiteCents / 100).replace(".", ",") : "");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    const cents = valor.trim() === "" ? 0 : parseAmountCents(valor);
    if (cents === null || cents < 0) {
      setErro("Use um valor em reais, como 800 ou 1.250,00.");
      return;
    }
    setErro(null);
    start(async () => {
      const r = await setBudget({ categoryId, month: mes, limitCents: cents });
      if (r.error) {
        setErro(r.error);
        return;
      }
      toast.success(cents === 0 ? `${nome} ficou sem limite.` : `Limite de ${nome}: ${formatCents(cents)} por mês.`);
      setAberto(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValor(limiteCents > 0 ? String(limiteCents / 100).replace(".", ",") : "");
          setErro(null);
          setAberto(true);
        }}
        className="-my-1 inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap text-left text-legenda text-ink-faint hover:text-brand"
        aria-label={limiteCents > 0 ? `Limite de ${nome}: ${formatCents(limiteCents)} por mês. Mudar` : `Definir um limite de gasto para ${nome}`}
      >
        <Gauge className="size-3.5" aria-hidden />
        {limiteCents > 0 ? (
          <span className="tabular">Limite {formatCents(limiteCents)} por mês</span>
        ) : (
          <span>Definir limite de gasto</span>
        )}
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          title={`Limite de ${nome}`}
          description={`Vale de ${monthLabel(mes)} em diante, até você mudar. O Início avisa quando o gasto chega perto.`}
        >
          <form onSubmit={salvar} className="space-y-4">
            <Field label="Limite por mês (R$)" htmlFor={`limite-${categoryId}`} error={erro ?? undefined} hint="Deixe vazio para tirar o limite.">
              <Input
                id={`limite-${categoryId}`}
                inputMode="decimal"
                placeholder="800,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                autoFocus
              />
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setAberto(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={pending}>
                Salvar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
