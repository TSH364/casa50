"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  ReceiptText,
  TrendingUp,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/inicio", label: "Início", Icon: House },
  { href: "/extratos", label: "Extratos", Icon: ReceiptText },
  { href: "/previsao", label: "Previsão", Icon: TrendingUp },
  { href: "/insights", label: "Insights", Icon: Sparkles },
  { href: "/metas", label: "Metas", Icon: Target },
  { href: "/casa", label: "Casa", Icon: Users },
] as const;

/**
 * Navegacao: barra inferior no celular, coluna lateral no desktop.
 *
 * Cada alvo tem 44px de altura minima e a barra inferior respeita a area
 * segura do iPhone, conforme a secao 21.
 */
export function AppNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Celular */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex max-w-lg">
          {ITEMS.map(({ href, label, Icon }) => (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                  isActive(href) ? "text-brand" : "text-ink-faint",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Desktop */}
      <nav
        aria-label="Navegação principal"
        className="hidden w-56 shrink-0 border-r border-line px-3 py-6 md:block"
      >
        <p className="px-3 pb-6 text-[13px] font-semibold uppercase tracking-[0.18em] text-brand">
          Fluxo
        </p>
        <ul className="space-y-1">
          {ITEMS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-[--radius-control] px-3 text-sm transition-colors",
                  isActive(href)
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
