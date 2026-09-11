"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Link2, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import {
  addCalendarSource,
  removeCalendarSource,
  syncCalendars,
} from "@/actions/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import type { CalendarSource } from "@/domain/types";
import type { MemberSummary } from "@/lib/houses";

/**
 * Agendas conectadas (camada 1).
 *
 * O texto de instrucao e parte da funcionalidade, nao enfeite: ninguem sabe
 * de cor onde fica o "endereco secreto no formato iCal" do Google, e sem o
 * caminho escrito o campo vazio nao tem resposta.
 */

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function quando(iso: string | null): string {
  if (!iso) return "nunca sincronizada";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "nunca sincronizada" : `lida em ${QUANDO.format(date)}`;
}

export function CalendarsManager({
  sources,
  members,
  canManage,
}: {
  sources: CalendarSource[];
  members: MemberSummary[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [removing, setRemoving] = useState<CalendarSource | undefined>();
  const [pending, startTransition] = useTransition();

  const ownerName = (id: string | null) =>
    members.find((m) => m.userId === id)?.fullName ?? null;

  function connect() {
    setError(undefined);
    startTransition(async () => {
      const result = await addCalendarSource({ name, url, ownerId });
      if (!result.ok) {
        setError(result.error ?? "Não foi possível conectar a agenda.");
        return;
      }
      setOpen(false);
      setName("");
      setUrl("");
      setOwnerId("");
      // `ok` com `error` é o caso do cadastro que deu certo e da leitura que
      // falhou: a agenda existe, mas ainda não trouxe evento nenhum.
      if (result.error) toast.warning(`Agenda conectada, mas: ${result.error}`);
      else toast.success(`Agenda conectada — ${result.events ?? 0} compromissos lidos.`);
    });
  }

  function sync() {
    startTransition(async () => {
      const result = await syncCalendars();
      if (result.error && !result.ok) {
        toast.error(result.error);
        return;
      }
      const partes = [`${result.events ?? 0} compromissos`];
      if (result.costly) partes.push(`${result.costly} que costumam custar`);
      if (result.failed?.length) {
        toast.warning(
          `${partes.join(" · ")}. Falhou: ${result.failed.map((f) => f.name).join(", ")}.`,
        );
      } else {
        toast.success(`Agendas relidas — ${partes.join(" · ")}.`);
      }
    });
  }

  function confirmRemove() {
    if (!removing) return;
    startTransition(async () => {
      const result = await removeCalendarSource(removing.id);
      if (result.error) toast.error(result.error);
      else toast.success("Agenda desconectada.");
      setRemoving(undefined);
    });
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Agendas"
          description="Compromissos do calendário viram previsão de gasto."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus aria-hidden /> Conectar
              </Button>
            ) : undefined
          }
        />

        {sources.length === 0 ? (
          <EmptyState
            title="Nenhuma agenda conectada"
            description="Com o calendário ligado, o app vê a viagem marcada antes de ela virar fatura."
            action={
              canManage ? (
                <Button size="sm" onClick={() => setOpen(true)}>
                  <Plus aria-hidden /> Conectar agenda
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {sources.map((source) => (
              <li
                key={source.id}
                className="rounded-[--radius-control] bg-surface-2 px-3 py-3"
              >
                {/* Empilhado: no celular, nome e botões na mesma linha
                    espremeriam o nome até virar reticências. */}
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-muted">
                    <CalendarDays className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* Nada de `truncate` aqui: a 360px "lida em 10/09 14:32"
                        é justamente o que some, e é o dado que responde "a
                        sincronização entrou?". Quebrar em duas linhas custa
                        altura; cortar custa a informação. */}
                    <p className="break-words text-sm font-medium leading-tight text-ink">
                      {source.name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-faint">
                      {ownerName(source.ownerId) ? (
                        <span>{ownerName(source.ownerId)}</span>
                      ) : null}
                      <span>{source.eventCount} compromissos</span>
                      <span>{quando(source.lastSyncedAt)}</span>
                      {source.host ? (
                        <span className="break-all text-[12px]">{source.host}</span>
                      ) : null}
                    </p>
                  </div>
                </div>

                {source.lastError ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-[--radius-control] bg-danger-soft/40 px-2.5 py-2 text-[12px] text-ink-muted">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
                    {source.lastError}
                  </p>
                ) : null}

                {canManage ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => setRemoving(source)}
                    >
                      <Trash2 aria-hidden /> Desconectar
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {sources.length > 0 && canManage ? (
          <div className="mt-3 border-t border-line pt-3">
            <Button variant="outline" size="sm" disabled={pending} onClick={sync}>
              <RefreshCw aria-hidden /> Reler agendas
            </Button>
            <p className="mt-2 text-[12px] text-ink-faint">
              O app relê sozinho quando alguém de vocês abre o Fluxo, no máximo
              uma vez a cada 12 horas. Enquanto ninguém está usando, nada é
              lido. Este botão força a leitura agora.
            </p>
          </div>
        ) : null}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Conectar agenda"
          description="Só leitura: o endereço não dá acesso a criar nem alterar nada."
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={connect} disabled={pending}>
                <Link2 aria-hidden /> Conectar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <ol className="space-y-1 rounded-[--radius-control] bg-surface-2 px-3 py-3 text-[13px] text-ink-muted">
              <li>1. No Google Agenda, abra Configurações.</li>
              <li>2. Escolha o calendário na lista da esquerda.</li>
              <li>
                3. Em <span className="text-ink">Integrar agenda</span>, copie o{" "}
                <span className="text-ink">endereço secreto no formato iCal</span>.
              </li>
            </ol>

            <Field label="Nome" htmlFor="agenda-nome" hint="Como vocês chamam esse calendário.">
              <Input
                id="agenda-nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agenda do Vinicius"
                maxLength={60}
              />
            </Field>

            <Field
              label="Endereço secreto (iCal)"
              htmlFor="agenda-url"
              hint="Começa com https:// e termina em .ics"
              error={error}
            >
              <Input
                id="agenda-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                inputMode="url"
                autoComplete="off"
              />
            </Field>

            <Field label="De quem é" htmlFor="agenda-dono">
              <Select
                id="agenda-dono"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                placeholder="Sem dono definido"
                options={members.map((m) => ({ value: m.userId, label: m.fullName }))}
              />
            </Field>

            <p className="text-[12px] text-ink-faint">
              Esse endereço é uma chave: quem o tem lê a agenda inteira. Ele fica
              guardado de forma que nem o resto da casa consegue vê-lo de volta, e
              some junto quando a agenda é desconectada. Para revogar do lado do
              Google, basta redefinir o endereço secreto lá.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== undefined}
        onOpenChange={(o) => {
          if (!o) setRemoving(undefined);
        }}
        title="Desconectar agenda"
        itemLabel={removing?.name ?? ""}
        confirmLabel="Desconectar"
        description="Os compromissos lidos dela saem junto. Nada dos seus lançamentos é afetado."
        pending={pending}
        onConfirm={confirmRemove}
      />
    </>
  );
}
