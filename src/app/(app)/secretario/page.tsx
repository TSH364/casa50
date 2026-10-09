import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";
import { getActiveHouse, listMembers } from "@/lib/houses";
import { listCards, listCategories } from "@/data/queries";
import { carregarSecretario } from "@/data/secretario";
import { credenciaisGoogle } from "@/lib/gmail";
import { Card, CardHeader } from "@/components/ui/card";
import { SecretarioLista } from "@/components/secretario/secretario-lista";

export const metadata: Metadata = { title: "Secretário · Fluxo" };

/** A leitura com IA pode levar alguns segundos por lote de e-mails. */
export const maxDuration = 60;

/**
 * O secretario: os e-mails dos Gmails conectados que pedem algo da casa.
 * A conexao fica em Casa; aqui, so o que fazer com cada e-mail.
 */
export default async function SecretarioPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const { active } = await getActiveHouse();
  if (!active) notFound();
  const params = await searchParams;

  const [dados, members, cards, categories] = await Promise.all([
    carregarSecretario(active.id),
    listMembers(active.id),
    listCards(active.id),
    listCategories(active.id),
  ]);
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const erros = dados.conexoes.filter((c) => c.lastError);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Secretário</h1>
        <p className="mt-1 text-corpo text-ink-muted">
          O que chegou no Gmail e pede algo de vocês: contas, pedidos, compromissos e comprovantes.
        </p>
      </header>

      {params.gmail === "conectado" ? (
        <p className="rounded-(--radius-control) bg-positive-soft px-3.5 py-2.5 text-corpo text-positive">
          Gmail conectado. A primeira leitura olha os últimos 14 dias e leva alguns segundos.
        </p>
      ) : null}

      {!dados.disponivel ? (
        <Card>
          <p className="text-corpo text-ink-muted">
            O secretário está quase pronto: falta aplicar a atualização do banco de dados (migração do secretário).
          </p>
        </Card>
      ) : dados.conexoes.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center py-6 text-center">
            <Inbox className="size-7 text-ink-faint" aria-hidden />
            <p className="mt-3 text-sm text-ink">Nenhum Gmail conectado ainda.</p>
            <p className="mx-auto mt-1 max-w-sm text-corpo text-ink-faint">
              {credenciaisGoogle()
                ? "Cada pessoa conecta o próprio Gmail em Casa. O app só lê: não manda, não apaga, não marca como lido."
                : "O acesso ao Gmail ainda não foi configurado no servidor do app."}
            </p>
            <Link href="/casa#gmail" className="mt-3 text-corpo font-medium text-brand hover:underline">
              Ir para Casa
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Pedem algo de vocês"
            description={`Lendo ${dados.conexoes.map((c) => c.email).join(" e ")}. A leitura roda sozinha a cada poucas horas, quando alguém abre o app.`}
          />
          {erros.map((c) => (
            <p key={c.id} role="alert" className="mb-3 rounded-(--radius-control) bg-danger-soft px-3 py-2 text-corpo text-danger">
              {c.email}: {c.lastError}
            </p>
          ))}
          <SecretarioLista itens={dados.pendentes} hoje={hoje} categories={categories} cards={cards} members={members} />
        </Card>
      )}
    </div>
  );
}
