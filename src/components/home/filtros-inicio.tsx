"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Os filtros do Inicio num botao so.
 *
 * Pessoa, cartao e "so o gasto da casa" ocupavam tres faixas no topo e
 * empurravam a barra da Dori para baixo da dobra - quem abre o app quer o
 * numero, e os filtros se trocam pouco. Agora cabem numa pilula que diz o
 * recorte em uso ("Todos · sem TSH"), e o toque abre a folha com os mesmos
 * controles de antes. O resumo continua a vista: um total nao aparece sem
 * dizer do que e feito (secao 20).
 */
export function FiltrosInicio({
  resumo,
  ativo,
  children,
}: {
  /** O recorte em uso, curto: "Todos · sem TSH", "Vini · Cartão 0162". */
  resumo: string;
  /** Algum filtro fora do padrao. */
  ativo: boolean;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const params = useSearchParams();
  const busca = params.toString();
  const anterior = useRef(busca);

  // Escolheu um filtro (a URL mudou): a folha fecha e o Inicio ja mostra o recorte.
  useEffect(() => {
    if (anterior.current !== busca) setAberto(false);
    anterior.current = busca;
  }, [busca]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        aria-label={`Filtros: ${resumo}. Tocar para mudar.`}
        className={cn(
          "flex min-h-9 max-w-[60%] items-center gap-1.5 rounded-full border px-3 text-legenda font-medium transition-colors",
          ativo ? "border-brand bg-brand-soft text-ink" : "border-line bg-surface text-ink-muted hover:text-ink",
        )}
      >
        <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{resumo}</span>
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent title="Filtros" description="O recorte vale para o Início inteiro.">
          <div className="space-y-4">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
