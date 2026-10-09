"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { desconectarGmail } from "@/actions/secretario";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";

export interface GmailResumo {
  memberId: string;
  nome: string;
  email: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

/** O que o retorno do Google quis dizer (`/casa?gmail=...`). */
const AVISO: Record<string, string> = {
  recusado: "O Google não autorizou a leitura. Tente de novo e aceite o acesso ao Gmail.",
  expirou: "O pedido ao Google expirou. Toque em Conectar de novo.",
  falhou: "Não foi possível concluir a conexão com o Google. Tente de novo.",
  "sem-banco": "Falta aplicar a atualização do banco de dados do secretário.",
  "sem-configuracao": "O acesso ao Gmail ainda não foi configurado no servidor do app.",
  "sem-casa": "Abra uma casa antes de conectar o Gmail.",
};

function haQuanto(iso: string | null): string {
  if (!iso) return "ainda não leu";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "leu agora há pouco";
  if (min < 60) return `leu há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `leu há ${h} h` : `leu há ${Math.round(h / 24)} dia(s)`;
}

/**
 * O Gmail de cada pessoa, na tela da Casa. Cada um conecta e desconecta o
 * PROPRIO Gmail (o Google pede a autorizacao de quem e dono da conta); o que
 * o secretario separa fica visivel para a casa.
 */
export function GmailConexao({
  minha,
  outras,
  podeConectar,
  configurado,
  disponivel,
  aviso,
}: {
  minha: GmailResumo | null;
  outras: GmailResumo[];
  podeConectar: boolean;
  configurado: boolean;
  disponivel: boolean;
  aviso: string | undefined;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pending, start] = useTransition();

  function desconectar() {
    start(async () => {
      const r = await desconectarGmail();
      if (r.error) toast.error(r.error);
      else toast.success("Gmail desconectado.");
      setConfirmando(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <div id="gmail" className="scroll-mt-20" />
      <CardHeader
        title="Gmail · Secretário"
        description="O app lê o Gmail e separa o que pede algo: contas, pedidos, compromissos e comprovantes. Só lê: não manda, não apaga, não marca como lido."
      />
      {aviso && AVISO[aviso] ? (
        <p role="alert" className="mb-3 rounded-(--radius-control) bg-danger-soft px-3 py-2 text-corpo text-danger">
          {AVISO[aviso]}
        </p>
      ) : null}

      <ul className="space-y-2">
        {[...(minha ? [minha] : []), ...outras].map((c) => (
          <li key={c.memberId} className="flex items-start gap-3 rounded-(--radius-control) bg-surface-2 px-3 py-2.5">
            <Mail className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                {c.email} <span className="text-ink-faint">· {c.nome}</span>
              </p>
              <p className={c.lastError ? "text-legenda text-danger" : "text-legenda text-ink-faint"}>
                {c.lastError ?? haQuanto(c.lastSyncAt)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {!disponivel ? (
        <p className="mt-3 text-corpo text-ink-muted">Falta aplicar a atualização do banco de dados do secretário.</p>
      ) : !configurado ? (
        <p className="mt-3 text-corpo text-ink-muted">O acesso ao Gmail ainda não foi configurado no servidor do app.</p>
      ) : podeConectar ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant={minha ? "outline" : "default"}>
            {/* Link comum, e nao fetch: o Google precisa da pagina inteira. */}
            <a href="/api/gmail/conectar">{minha ? (minha.lastError ? "Conectar de novo" : "Trocar de conta") : "Conectar meu Gmail"}</a>
          </Button>
          {minha ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(true)} disabled={pending}>
              Desconectar
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 text-legenda text-ink-faint">
        Fica guardado de cada e-mail importante só o remetente, o assunto, um resumo, o valor e as datas, visíveis para a
        casa. O texto do e-mail vai à IA para ser separado e não é guardado.
      </p>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="Desconectar o Gmail"
        itemLabel={minha?.email ?? ""}
        description="O app para de ler este Gmail, e os e-mails que ele separou saem da lista. A autorização no Google pode ser revogada em myaccount.google.com."
        confirmLabel="Desconectar"
        pending={pending}
        onConfirm={desconectar}
      />
    </Card>
  );
}
