"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransactionFormDialog } from "./transaction-form";
import type { Card, Category } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

export function NewTransactionButton({
  categories,
  cards,
  members,
  defaultMonth,
  size = "sm",
  label = "Novo lançamento",
}: {
  categories: Category[];
  cards: Card[];
  members: MemberSummary[];
  defaultMonth: string;
  size?: "sm" | "default";
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {label}
      </Button>
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
        />
      ) : null}
    </>
  );
}
