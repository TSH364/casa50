"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MailOpen } from "lucide-react";
import { acceptInvite } from "@/actions/members";
import { Button } from "@/components/ui/button";
import { Card as Panel, CardHeader } from "@/components/ui/card";

/**
 * Convites esperando por quem está logado (secao 4).
 *
 * Sem esta tela o convite não teria saída: a pessoa criaria a conta, não seria
 * membro de casa nenhuma e não haveria por onde aceitar.
 */
export function PendingInvites({
  invites,
  /**
   * Para onde ir depois de aceitar. A tela de "nova casa" precisa mandar para
   * dentro do app: quem acabou de entrar numa casa não pode continuar na
   * página que existe justamente para quem não tem nenhuma.
   */
  redirectTo,
}: {
  invites: { houseId: string; houseName: string }[];
  redirectTo?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (invites.length === 0) return null;

  function accept(houseId: string, houseName: string) {
    startTransition(async () => {
      const result = await acceptInvite(houseId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Você entrou em ${houseName}.`);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <Panel>
      <CardHeader
        title={invites.length === 1 ? "Você foi convidado" : "Convites para você"}
        description="Aceitar dá acesso aos lançamentos, cartões e orçamentos da casa."
      />
      <ul className="space-y-2">
        {invites.map((invite) => (
          <li
            key={invite.houseId}
            className="flex items-center gap-3 rounded-[--radius-control] bg-brand-soft px-3 py-3"
          >
            <MailOpen className="size-4 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {invite.houseName}
            </span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => accept(invite.houseId, invite.houseName)}
            >
              {pending ? "Entrando…" : "Aceitar"}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
