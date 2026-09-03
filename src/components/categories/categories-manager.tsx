"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { countCategoryUsage, deleteCategory } from "@/actions/categories";
import { CategoryFormDialog } from "./category-form";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states";
import type { Category } from "@/domain/types";

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | undefined>();
  const [parentFor, setParentFor] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<Category | undefined>();
  const [usage, setUsage] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const parents = categories.filter((c) => c.parentId === null);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  function openNew(parentId?: string) {
    setEditing(undefined);
    setParentFor(parentId);
    setFormOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setParentFor(undefined);
    setFormOpen(true);
  }

  /**
   * Antes de confirmar a exclusão, dizer o que ela vai atingir.
   *
   * Excluir uma categoria não apaga lançamento nenhum - eles só ficam sem
   * categoria - mas apaga o orçamento dela e as subcategorias. O casal
   * precisa saber disso antes, não depois.
   */
  function askDelete(category: Category) {
    setUsage(undefined);
    setDeleting(category);
    startTransition(async () => {
      const counts = await countCategoryUsage(category.id);
      const parts = [
        counts.transactions > 0
          ? `${counts.transactions} lançamento(s) ficarão sem categoria`
          : null,
        counts.children > 0
          ? `${counts.children} subcategoria(s) serão excluídas junto`
          : null,
        counts.budgets > 0 ? `${counts.budgets} orçamento(s) serão excluídos` : null,
      ].filter(Boolean);
      setUsage(
        parts.length > 0
          ? `${parts.join("; ")}.`
          : "Nada usa esta categoria hoje.",
      );
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    startTransition(async () => {
      const result = await deleteCategory(deleting.id);
      if (result.error) toast.error(result.error);
      else toast.success("Categoria excluída.");
      setDeleting(undefined);
    });
  }

  return (
    <>
      <Panel>
        <CardHeader
          title="Categorias da casa"
          description="Todas editáveis e removíveis, inclusive as iniciais."
          action={
            <Button size="sm" onClick={() => openNew()}>
              <Plus aria-hidden /> Nova
            </Button>
          }
        />

        {parents.length === 0 ? (
          <EmptyState
            title="Nenhuma categoria"
            description="Crie as categorias que fizerem sentido para vocês."
            action={
              <Button size="sm" onClick={() => openNew()}>
                <Plus aria-hidden /> Criar categoria
              </Button>
            }
          />
        ) : (
          <ul className="space-y-1.5">
            {parents.map((parent) => {
              const children = childrenOf(parent.id);
              return (
                <li key={parent.id}>
                  <div className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: parent.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {parent.name}
                    </span>
                    <div className="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Adicionar subcategoria em ${parent.name}`}
                        onClick={() => openNew(parent.id)}
                      >
                        <Plus aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${parent.name}`}
                        onClick={() => openEdit(parent)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${parent.name}`}
                        onClick={() => askDelete(parent)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </div>

                  {children.length > 0 ? (
                    <ul className="ml-4 mt-1.5 space-y-1.5 border-l border-line pl-3">
                      {children.map((child) => (
                        <li
                          key={child.id}
                          className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2"
                        >
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: child.color }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
                            {child.name}
                          </span>
                          <div className="flex shrink-0 items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Editar ${child.name}`}
                              onClick={() => openEdit(child)}
                            >
                              <Pencil aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Excluir ${child.name}`}
                              onClick={() => askDelete(child)}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <CategoryFormDialog
        key={editing?.id ?? `novo:${parentFor ?? "raiz"}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        category={editing}
        parents={parents}
        defaultParentId={parentFor}
      />

      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Excluir categoria"
        itemLabel={deleting?.name ?? ""}
        description={usage ?? "Verificando o que usa esta categoria…"}
        pending={pending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
