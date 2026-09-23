"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setProjectCategory } from "@/actions/project";
import { Select } from "@/components/ui/select";
import type { Category } from "@/domain/types";

/**
 * Em que categoria entram as despesas que este projeto lança (secao 15).
 *
 * Só as de boleto, pix e dinheiro: o que passa no cartão chega pela fatura e é
 * classificado lá, como qualquer outro lançamento.
 *
 * As categorias fora dos totais aparecem MARCADAS, e não escondidas: pode ser
 * exatamente o que a casa quer (a obra à parte do mês), mas escolher uma sem
 * saber faria as despesas sumirem do total — o contrário do que lançá-las
 * pretendia.
 */
export function ProjectCategory({
  projectId,
  categoryId,
  categories,
}: {
  projectId: string;
  categoryId: string | null;
  categories: readonly Category[];
}) {
  const [pending, startTransition] = useTransition();

  // Só as de primeiro nível: subcategoria é refinamento que a casa faz no
  // extrato, e a lista inteira num select de celular seria longa demais.
  const opcoes = categories
    .filter((c) => c.isActive && c.parentId === null)
    .map((c) => ({
      value: c.id,
      label: c.excludedFromTotals ? `${c.name} (fora dos totais)` : c.name,
    }));

  return (
    // Empilhado: o `Select` embrulha o campo numa div própria, e lado a lado
    // com o rótulo ele ficaria da largura da opção mais longa — estreito ou
    // estourando, conforme a categoria.
    <div className="space-y-1">
      <p className="text-[12px] text-ink-faint">
        Despesas de boleto, Pix e dinheiro deste projeto entram em
      </p>
      <Select
        value={categoryId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const valor = e.target.value || null;
          startTransition(async () => {
            const r = await setProjectCategory({ projectId, categoryId: valor });
            if (r.error) toast.error(r.error);
            else toast.success(valor ? "Categoria guardada." : "Sem categoria.");
          });
        }}
        options={[{ value: "", label: "Sem categoria" }, ...opcoes]}
        aria-label="Categoria das despesas do projeto"
      />
    </div>
  );
}
