import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveHouse } from "@/lib/houses";
import { getAiStatus } from "@/lib/ai-config";
import { ChatPanel } from "@/components/chat/chat-panel";
import { parseModo } from "@/lib/doria-mode";

export const metadata: Metadata = { title: "Dor.IA · Fluxo" };

/**
 * Uma pergunta pode levar algumas rodadas de ferramenta, e modelo gratuito
 * e lento. A acao desiste aos 50 s (ver `actions/chat.ts`), abaixo deste teto.
 */
export const maxDuration = 60;

export default async function ConversaPage({
  searchParams,
}: {
  searchParams: Promise<{ modo?: string }>;
}) {
  const { modo } = await searchParams;
  const { active } = await getActiveHouse();
  if (!active) notFound();
  const ai = await getAiStatus(active.id);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Dor<span className="text-brand">.</span>IA
        </h1>
        <p className="mt-1 text-corpo text-ink-faint">
          Pergunte ou peça por escrito ou por voz: gastos, metas, orçamentos, contas fixas, tarefas,
          pesquisa de compra. A IA consulta os dados e propõe; nada muda sem o seu toque em Confirmar.
        </p>
      </header>

      {ai.source === null ? (
        <p className="rounded-(--radius-control) bg-surface-2 px-3.5 py-3 text-corpo text-ink-muted">
          A conversa usa a chave do OpenRouter da casa.{" "}
          <Link href="/casa" className="text-brand underline underline-offset-2">
            Guardar a chave na tela Casa
          </Link>
          .
        </p>
      ) : (
        <ChatPanel houseId={active.id} modo={parseModo(modo)} />
      )}
    </div>
  );
}
