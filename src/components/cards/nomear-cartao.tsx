"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { renameCard } from "@/actions/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/**
 * "Que cartão é esse?" - o nome do cartao num campo so, onde ele ainda tem o
 * nome automatico da importacao. Pelo final ninguem sabe qual e qual, e o
 * formulario completo ficava escondido em Editar.
 */
export function NomearCartao({
  cardId,
  lastFour,
  onNomeado,
}: {
  cardId: string;
  lastFour: string | null;
  /** Depois de salvar (a tela de importacao esconde o campo). */
  onNomeado?: (nome: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [pending, startTransition] = useTransition();

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (limpo.length < 2) return;
    startTransition(async () => {
      const r = await renameCard({ cardId, name: limpo });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Nome salvo.");
      onNomeado?.(limpo);
    });
  }

  const id = `nome-${cardId}`;
  return (
    <form onSubmit={salvar} className="mt-1.5 space-y-1">
      <label htmlFor={id} className="block text-legenda font-medium text-ink-muted">
        Que cartão é esse?<span className="sr-only">{lastFour ? ` Nome do cartão final ${lastFour}` : " Nome do cartão"}</span>
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={60}
          placeholder="Ex.: Nubank da Lari"
          className="min-h-9 min-w-0 flex-1 text-corpo"
        />
        <Button type="submit" size="sm" disabled={pending || nome.trim().length < 2}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
