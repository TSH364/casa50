"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Hammer,
  House,
  KanbanSquare,
  LogOut,
  Mic,
  MoreHorizontal,
  ReceiptText,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DoriMark } from "@/components/doria/dori-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/app/entrar/actions";
import { lembrarModo, ultimoModo } from "@/lib/doria-mode";
import type { ThemePref } from "@/lib/theme";

/** O que vai na barra do celular, fora a Dor.IA no meio. */
const ESQUERDA = [
  { href: "/inicio", label: "Início", Icon: House },
  { href: "/extratos", label: "Extratos", Icon: ReceiptText },
] as const;
const DIREITA = [{ href: "/analise", label: "Análise", Icon: Sparkles }] as const;

/** O que o celular guarda no "Mais": telas que se abrem menos. */
const MAIS = [
  { href: "/metas", label: "Metas", Icon: Target },
  { href: "/projetos", label: "Projetos", Icon: Hammer },
  { href: "/tarefas", label: "Tarefas", Icon: KanbanSquare },
  { href: "/casa", label: "Casa", Icon: Users },
] as const;

/** A coluna do computador tem espaco para tudo. */
const LATERAL = [
  { href: "/inicio", label: "Início", Icon: House },
  { href: "/extratos", label: "Extratos", Icon: ReceiptText },
  { href: "/conversa", label: "Dor.IA", Icon: null },
  { href: "/analise", label: "Análise", Icon: Sparkles },
  ...MAIS,
] as const;

/** Segurar o botao da Dor.IA por este tempo abre a conversa por texto. */
const SEGURAR_MS = 450;

/**
 * Navegacao: barra inferior no celular, coluna lateral no desktop.
 *
 * No celular sao cinco lugares: Inicio, Extratos, a Dor.IA no meio (em
 * destaque, maior e acima da barra), Analise e Mais. O botao do meio abre a
 * conversa do jeito usado por ultimo - voz ou texto - e segurar abre por
 * texto. Tema, versao e Sair sairam do topo para o "Mais": sao raros, e
 * "Sair" ficava a um toque de ser apertado sem querer.
 *
 * Cada alvo tem 44px de altura minima e a barra respeita a area segura do
 * iPhone, conforme a secao 21.
 */
export function AppNav({
  tema,
  versao,
  versaoCompleta,
}: {
  tema: ThemePref;
  versao: string;
  versaoCompleta: string;
}) {
  const pathname = usePathname();
  const [maisAberto, setMaisAberto] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const maisAtivo = MAIS.some((i) => isActive(i.href));

  return (
    <>
      {/* Celular */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex max-w-lg items-stretch px-2">
          {ESQUERDA.map((i) => (
            <li key={i.href} className="flex-1">
              <ItemBarra {...i} ativo={isActive(i.href)} />
            </li>
          ))}
          <li className="flex flex-1 justify-center">
            <BotaoDoria ativo={isActive("/conversa")} />
          </li>
          {DIREITA.map((i) => (
            <li key={i.href} className="flex-1">
              <ItemBarra {...i} ativo={isActive(i.href)} />
            </li>
          ))}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMaisAberto(true)}
              aria-haspopup="dialog"
              className={cn(
                "flex min-h-14 w-full flex-col items-center justify-center gap-1 text-legenda font-medium transition-colors",
                maisAtivo ? "font-semibold text-ink" : "text-ink-faint",
              )}
            >
              <IconeBarra ativo={maisAtivo}>
                <MoreHorizontal className="size-5" aria-hidden />
              </IconeBarra>
              Mais
            </button>
          </li>
        </ul>
      </nav>

      <Dialog open={maisAberto} onOpenChange={setMaisAberto}>
        <DialogContent title="Mais">
          <ul className="grid grid-cols-2 gap-2">
            {MAIS.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setMaisAberto(false)}
                  aria-current={isActive(href) ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-(--radius-control) border px-4 text-destaque transition-colors",
                    isActive(href)
                      ? "border-brand bg-brand-soft font-medium text-ink"
                      : "border-line bg-surface-2 text-ink hover:bg-surface-3",
                  )}
                >
                  <Icon className="size-5 text-ink-muted" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <div className="flex items-center gap-2 text-corpo text-ink-muted">
              <ThemeToggle initial={tema} />
              Tema
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center gap-2 rounded-(--radius-control) px-3 text-corpo text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <LogOut className="size-4" aria-hidden /> Sair
              </button>
            </form>
          </div>
          <p title={versaoCompleta} className="tabular mt-2 text-legenda text-ink-faint">
            Fluxo {versao}
          </p>
        </DialogContent>
      </Dialog>

      {/* Desktop */}
      <nav
        aria-label="Navegação principal"
        className="hidden w-56 shrink-0 border-r border-line px-3 py-6 md:block"
      >
        <p className="px-3 pb-6 text-corpo font-semibold uppercase tracking-[0.18em] text-brand">Fluxo</p>
        <ul className="space-y-1">
          {LATERAL.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-(--radius-control) px-3 text-corpo transition-colors",
                  isActive(href)
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {Icon ? (
                  <Icon className="size-4" aria-hidden />
                ) : (
                  <DoriMark size={20} corpo="currentColor" peito="var(--color-canvas)" />
                )}
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function IconeBarra({ ativo, children }: { ativo: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "flex h-7 items-center justify-center rounded-full",
        ativo ? "w-12 bg-brand-soft text-brand" : "w-7",
      )}
    >
      {children}
    </span>
  );
}

function ItemBarra({
  href,
  label,
  Icon,
  ativo,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  ativo: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center gap-1 text-legenda transition-colors",
        ativo ? "font-semibold text-ink" : "font-medium text-ink-faint",
      )}
    >
      <IconeBarra ativo={ativo}>
        <Icon className="size-5" aria-hidden />
      </IconeBarra>
      {label}
    </Link>
  );
}

/**
 * O botao do meio. Toque: abre do jeito usado por ultimo. Segurar: texto.
 *
 * Um <button> com o router, e nao um <Link>: segurar um link no celular abre
 * o menu de pre-visualizacao do sistema, que roubaria o gesto.
 */
function BotaoDoria({ ativo }: { ativo: boolean }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segurou = useRef(false);

  function limpar() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  return (
    <button
      type="button"
      aria-label="Falar com a Dor.IA. Segure para escrever."
      aria-current={ativo ? "page" : undefined}
      onPointerDown={() => {
        segurou.current = false;
        limpar();
        timer.current = setTimeout(() => {
          segurou.current = true;
          lembrarModo("texto");
          router.push("/conversa?modo=texto");
        }, SEGURAR_MS);
      }}
      onPointerUp={limpar}
      onPointerLeave={limpar}
      onPointerCancel={limpar}
      onContextMenu={(ev) => ev.preventDefault()}
      onClick={() => {
        if (segurou.current) return;
        router.push(`/conversa?modo=${ultimoModo()}`);
      }}
      className="-mt-6 flex select-none flex-col items-center gap-1 text-legenda font-bold text-ink [-webkit-touch-callout:none]"
    >
      <span className="relative flex size-16 items-center justify-center rounded-full border-4 border-surface bg-doria shadow-[0_8px_20px_rgba(124,134,255,0.45)]">
        <DoriMark size={44} />
        <span className="absolute -bottom-0.5 -right-1 flex size-[22px] items-center justify-center rounded-full bg-ink text-canvas">
          <Mic className="size-3" aria-hidden />
        </span>
      </span>
      Dor.IA
    </button>
  );
}
