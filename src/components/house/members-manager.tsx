"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Clock, Copy, Trash2, UserPlus } from "lucide-react";
import {
  cancelInvite,
  changeMemberRole,
  inviteMember,
  removeMember,
} from "@/actions/members";
import type { FormState } from "@/actions/shared";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { RosterEntry } from "@/lib/houses";

const ROLE_LABEL: Record<string, string> = {
  owner: "Dona da casa",
  admin: "Administra",
  member: "Participa",
  viewer: "Só visualiza",
};

const ROLE_OPTIONS = [
  { value: "admin", label: "Administra" },
  { value: "member", label: "Participa" },
  { value: "viewer", label: "Só visualiza" },
];

function InviteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      <UserPlus aria-hidden /> {pending ? "Convidando…" : "Convidar"}
    </Button>
  );
}

export function MembersManager({
  roster,
  currentUserId,
  canManage,
}: {
  roster: RosterEntry[];
  currentUserId: string | null;
  /** Só dono e administrador convidam ou removem. */
  canManage: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    inviteMember,
    {},
  );
  const [removing, setRemoving] = useState<RosterEntry | undefined>();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (state.ok) toast.success("Convite criado.");
  }, [state.ok]);

  const active = roster.filter((r) => r.status === "active");
  const invited = roster.filter((r) => r.status === "invited");

  function run(action: () => Promise<FormState>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else toast.success(success);
    });
  }

  function confirmRemove() {
    if (!removing) return;
    startTransition(async () => {
      const result =
        removing.status === "invited"
          ? await cancelInvite(removing.memberId)
          : await removeMember(removing.memberId);
      if (result.error) toast.error(result.error);
      else
        toast.success(
          removing.status === "invited" ? "Convite cancelado." : "Pessoa removida.",
        );
      setRemoving(undefined);
    });
  }

  return (
    <>
      <Panel>
        <CardHeader
          title="Membros"
          description="Quem enxerga os dados desta casa."
        />
        <ul className="space-y-2">
          {active.map((member) => {
            const isOwner = member.role === "owner";
            const isMe = member.userId === currentUserId;
            return (
              <li
                key={member.memberId}
                className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    {member.name}
                    {isMe ? (
                      <span className="ml-1.5 text-[12px] text-ink-faint">
                        (você)
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-[13px] text-ink-faint">
                    {member.email}
                  </p>
                </div>

                {canManage && !isOwner ? (
                  // O invólucro carrega a largura: o `className` do Select vai
                  // para o <select>, não para o wrapper que ele já renderiza.
                  <div className="w-36 shrink-0">
                    <Select
                      aria-label={`Papel de ${member.name}`}
                      value={member.role}
                      disabled={pending}
                      options={ROLE_OPTIONS}
                      onChange={(e) =>
                        run(
                          () => changeMemberRole(member.memberId, e.target.value),
                          "Papel atualizado.",
                        )
                      }
                    />
                  </div>
                ) : (
                  <span className="shrink-0 text-[13px] text-ink-muted">
                    {ROLE_LABEL[member.role] ?? member.role}
                  </span>
                )}

                {canManage && !isOwner && !isMe ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${member.name}`}
                    onClick={() => setRemoving(member)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>

      {invited.length > 0 ? (
        <Panel>
          <CardHeader
            title="Convites pendentes"
            description="Valem até a pessoa entrar com esse mesmo e-mail e aceitar."
          />
          <ul className="space-y-2">
            {invited.map((invite) => (
              <li
                key={invite.memberId}
                className="flex items-center gap-3 rounded-[--radius-control] bg-surface-2 px-3 py-2.5"
              >
                <Clock className="size-4 shrink-0 text-attention" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                  {invite.email}
                </span>
                <span className="shrink-0 text-[12px] text-ink-faint">
                  {ROLE_LABEL[invite.role] ?? invite.role}
                </span>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Cancelar convite de ${invite.email}`}
                    onClick={() => setRemoving(invite)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {canManage ? (
        <Panel>
          <CardHeader
            title="Convidar alguém"
            description="O convite é aceito com o mesmo e-mail que você informar aqui."
          />

          <form action={formAction} className="space-y-3">
            {state.error ? (
              <p
                role="alert"
                className="rounded-[--radius-control] bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
              >
                {state.error}
              </p>
            ) : null}

            <Field
              label="E-mail"
              htmlFor="invite-email"
              error={state.fieldErrors?.email}
            >
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="pessoa@exemplo.com"
              />
            </Field>

            <Field label="Papel" htmlFor="invite-role">
              <Select
                id="invite-role"
                name="role"
                defaultValue="member"
                options={ROLE_OPTIONS}
              />
            </Field>

            <InviteSubmit />
          </form>

          <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-faint">
            <Copy className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              O app não envia e-mail. Avise a pessoa por fora: ela cria a conta
              com esse mesmo endereço e o convite aparece para aceitar.
            </span>
          </p>
        </Panel>
      ) : null}

      <ConfirmDialog
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
        title={
          removing?.status === "invited" ? "Cancelar convite" : "Remover da casa"
        }
        confirmLabel={removing?.status === "invited" ? "Cancelar convite" : "Remover"}
        itemLabel={removing?.email ?? ""}
        description={
          removing?.status === "invited"
            ? "O convite deixa de valer. Dá para convidar de novo depois."
            : "A pessoa perde acesso aos dados desta casa. Os lançamentos que ela criou continuam onde estão, com o nome dela no histórico."
        }
        pending={pending}
        onConfirm={confirmRemove}
      />
    </>
  );
}
