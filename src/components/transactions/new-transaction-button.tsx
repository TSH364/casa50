"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransactionFormDialog } from "./transaction-form";
import type { ModeloDeReceita } from "@/domain/receitas-do-mes";
import type { Card, Category } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

export function NewTransactionButton({
  categories,
  cards,
  members,
  defaultMonth,
  size = "sm",
  label = "Novo lançamento",
  iconOnly = false,
  modelos = [],
}: {
  categories: Category[];
  cards: Card[];
  members: MemberSummary[];
  defaultMonth: string;
  size?: "sm" | "default";
  label?: string;
  /** So o "+", redondo; o rotulo vai para o leitor de tela. */
  iconOnly?: boolean;
  /** Receitas de todo mes, para o "Preencher com" do formulario. */
  modelos?: ModeloDeReceita[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {iconOnly ? (
        <Button
          size="icon"
          onClick={() => setOpen(true)}
          aria-label={label}
          title={label}
          className="rounded-full shadow-[0_6px_16px_rgba(61,69,189,0.28)] [&_svg]:size-5"
        >
          <Plus aria-hidden />
        </Button>
      ) : (
        <Button size={size} onClick={() => setOpen(true)}>
          <Plus aria-hidden /> {label}
        </Button>
      )}
      {/* `key` remonta o formulário a cada abertura, limpando os campos de
          uma edição anterior sem precisar resetá-los um a um. */}
      {open ? (
        <TransactionFormDialog
          key={String(open)}
          open={open}
          onOpenChange={setOpen}
          categories={categories}
          cards={cards}
          members={members}
          defaultMonth={defaultMonth}
          modelos={modelos}
        />
      ) : null}
    </>
  );
}
