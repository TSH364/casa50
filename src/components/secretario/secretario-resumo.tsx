import Link from "next/link";
import { ChevronRight, Inbox } from "lucide-react";
import { carregarSecretario } from "@/data/secretario";
import { formatCents } from "@/lib/money";

/**
 * O aviso do secretario no Inicio: quantos e-mails pedem algo, e os tres
 * primeiros. Sem Gmail conectado, ou sem nada pendente, nao aparece - o
 * Inicio nao ganha um cartao vazio.
 */
export async function SecretarioResumo({ houseId }: { houseId: string }) {
  const dados = await carregarSecretario(houseId, 20);
  if (!dados.disponivel || dados.pendentes.length === 0) return null;
  const n = dados.pendentes.length;
  // Contas primeiro: custam dinheiro e tem prazo.
  const primeiros = [...dados.pendentes]
    .sort((a, b) => Number(b.tipo === "conta") - Number(a.tipo === "conta"))
    .slice(0, 3);

  return (
    <Link
      href="/secretario"
      className="block rounded-(--radius-card) border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-center gap-2">
        <Inbox className="size-4 text-brand" aria-hidden />
        <p className="flex-1 text-sm font-medium text-ink">
          {n === 1 ? "1 e-mail pede algo de vocês" : `${n} e-mails pedem algo de vocês`}
        </p>
        <ChevronRight className="size-4 text-ink-faint" aria-hidden />
      </div>
      <ul className="mt-1.5 space-y-0.5 pl-6">
        {primeiros.map((i) => (
          <li key={i.id} className="flex items-baseline justify-between gap-3 text-corpo">
            <span className="min-w-0 truncate text-ink-muted">{i.resumo}</span>
            {i.amountCents !== null ? (
              <span className="tabular shrink-0 text-ink">{formatCents(i.amountCents)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Link>
  );
}
