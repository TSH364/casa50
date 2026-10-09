"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Check, ExternalLink, FileCheck2, ListTodo, ReceiptText, RefreshCw, X } from "lucide-react";
import { criarTarefaDoEmail, lerEmailsAgora, marcarEmail } from "@/actions/secretario";
import { ORDEM_NA_TELA, ROTULO_DO_TIPO, linkDoGmail, prazo } from "@/domain/secretario";
import type { ItemDoSecretario } from "@/data/secretario";
import { monthOf } from "@/domain/month";
import { formatCents, fromCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TransactionFormDialog } from "@/components/transactions/transaction-form";
import type { Card as CardType, Category } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

const ICONE = { conta: ReceiptText, acao: ListTodo, compromisso: CalendarClock, comprovante: FileCheck2 } as const;

const DIA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });

/**
 * Os e-mails que o secretario separou, por tipo: contas primeiro (custam
 * dinheiro e tem prazo), depois o que pede uma acao, compromissos e
 * comprovantes. Cada item tem o que fazer com ele num toque - lancar, virar
 * tarefa, abrir no Gmail, dar por feito ou ignorar. Nada acontece sozinho.
 */
export function SecretarioLista({
  itens,
  hoje,
  categories,
  cards,
  members,
}: {
  itens: ItemDoSecretario[];
  hoje: string;
  categories: Category[];
  cards: CardType[];
  members: MemberSummary[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lancando, setLancando] = useState<ItemDoSecretario | null>(null);
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());

  const visiveis = itens.filter((i) => !ocultos.has(i.id));
  const nome = (id: string) => members.find((m) => m.userId === id)?.fullName.split(" ")[0] ?? null;

  function tirar(id: string, status: "feito" | "ignorado") {
    setOcultos((s) => new Set(s).add(id));
    start(async () => {
      const r = await marcarEmail({ id, status });
      if (r.error) {
        toast.error(r.error);
        setOcultos((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    });
  }

  function tarefa(id: string) {
    start(async () => {
      const r = await criarTarefaDoEmail({ id });
      if (r.error) toast.error(r.error);
      else {
        setOcultos((s) => new Set(s).add(id));
        toast.success("Virou tarefa em Tarefas.");
      }
    });
  }

  function lerAgora() {
    start(async () => {
      const r = await lerEmailsAgora();
      if (r.error) toast.error(r.error);
      else if (r.erros.length > 0) toast.error(r.erros[0]);
      else toast.success(r.novos > 0 ? `${r.novos} e-mail(s) novo(s) separado(s).` : "Nada novo que peça algo.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-corpo text-ink-muted">
          {visiveis.length === 0
            ? "Nada pendente."
            : `${visiveis.length} ${visiveis.length === 1 ? "e-mail pede" : "e-mails pedem"} algo de vocês.`}
        </p>
        <Button variant="outline" size="sm" onClick={lerAgora} disabled={pending}>
          <RefreshCw aria-hidden className={cn(pending && "animate-spin")} /> Ler agora
        </Button>
      </div>

      {ORDEM_NA_TELA.map((tipo) => {
        const doTipo = visiveis.filter((i) => i.tipo === tipo);
        if (doTipo.length === 0) return null;
        const Icone = ICONE[tipo];
        return (
          <section key={tipo} aria-labelledby={`sec-${tipo}`}>
            <h2 id={`sec-${tipo}`} className="mb-2 flex items-center gap-2 text-corpo font-medium text-ink">
              <Icone className="size-4 text-ink-muted" aria-hidden />
              {ROTULO_DO_TIPO[tipo]}
              <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-legenda font-normal text-ink-muted">
                {doTipo.length}
              </span>
            </h2>
            <ul className="space-y-2">
              {doTipo.map((i) => {
                const quando = i.dueDate
                  ? prazo(i.dueDate, hoje, { futuro: "vence", passado: "venceu", hoje: "vence hoje" })
                  : i.eventDate
                    ? prazo(i.eventDate, hoje, { futuro: "é", passado: "foi", hoje: "é hoje" })
                    : null;
                const atrasado = i.dueDate !== null && i.dueDate < hoje;
                return (
                  <li key={i.id} className="rounded-(--radius-control) bg-surface-2 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm font-medium text-ink">{i.resumo}</p>
                      {i.amountCents !== null ? (
                        <p className="tabular shrink-0 text-sm font-semibold text-ink">{formatCents(i.amountCents)}</p>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-legenda text-ink-faint">
                      {[i.fromName ?? i.fromAddress, DIA.format(new Date(i.receivedAt)), nome(i.memberId)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {quando ? (
                      <p className={cn("mt-1 text-legenda font-medium", atrasado ? "text-danger" : "text-attention")}>
                        {quando}
                        {i.dueDate ?? i.eventDate ? ` · ${DIA.format(new Date(`${i.dueDate ?? i.eventDate}T12:00:00Z`))}` : ""}
                      </p>
                    ) : null}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {tipo === "conta" ? (
                        <Button size="sm" onClick={() => setLancando(i)} disabled={pending}>
                          Lançar
                        </Button>
                      ) : null}
                      {tipo === "acao" ? (
                        <Button size="sm" onClick={() => tarefa(i.id)} disabled={pending}>
                          Criar tarefa
                        </Button>
                      ) : null}
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={linkDoGmail(i.gmailId, i.conta)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Abrir no Gmail"
                          title="Abrir no Gmail"
                        >
                          {/* No celular, so o icone: com o texto, os botoes quebravam em duas linhas. */}
                          <ExternalLink aria-hidden /> <span className="hidden sm:inline">Abrir no Gmail</span>
                        </a>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => tirar(i.id, "feito")} disabled={pending}>
                        <Check aria-hidden /> Feito
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Ignorar: ${i.resumo}`}
                        title="Ignorar"
                        onClick={() => tirar(i.id, "ignorado")}
                        disabled={pending}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {lancando ? (
        <TransactionFormDialog
          key={lancando.id}
          open
          onOpenChange={(open) => {
            if (!open) setLancando(null);
          }}
          categories={categories}
          cards={cards}
          members={members}
          defaultMonth={monthOf(lancando.dueDate ?? hoje)}
          rascunho={{
            type: "expense",
            description: (lancando.fromName ?? lancando.subject).slice(0, 200),
            amount: lancando.amountCents !== null ? fromCents(lancando.amountCents) : undefined,
            date: lancando.dueDate ?? hoje,
            memberId: lancando.memberId,
          }}
          onSaved={() => tirar(lancando.id, "feito")}
        />
      ) : null}
    </div>
  );
}
