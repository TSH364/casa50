"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  THEME_COOKIE,
  nextTheme,
  themeAttribute,
  themeLabel,
  type ThemePref,
} from "@/lib/theme";

/**
 * O botao do tema, na barra de cima de toda tela.
 *
 * Um toque passa para o proximo: escuro -> claro -> seguir o celular. O
 * icone mostra o tema ATUAL, e o nome dele vai no rotulo acessivel e no aviso
 * - tres estados num botao so precisam dizer onde se esta.
 *
 * A troca e imediata (o atributo do <html> muda aqui mesmo); o `refresh`
 * depois so atualiza o que o servidor pinta, como o aviso e a barra do
 * navegador.
 */
export function ThemeToggle({ initial }: { initial: ThemePref }) {
  const [pref, setPref] = useState<ThemePref>(initial);
  const router = useRouter();

  function trocar() {
    const proximo = nextTheme(pref);
    setPref(proximo);
    document.documentElement.dataset.theme = themeAttribute(proximo);
    // Um ano; `lax` porque o cookie so escolhe cor, e nao autoriza nada.
    document.cookie = `${THEME_COOKIE}=${proximo}; path=/; max-age=31536000; samesite=lax`;
    toast(`Tema: ${themeLabel(proximo).toLowerCase()}`);
    router.refresh();
  }

  const Icone = pref === "claro" ? Sun : pref === "sistema" ? Monitor : Moon;
  const proximo = themeLabel(nextTheme(pref)).toLowerCase();

  return (
    <button
      type="button"
      onClick={trocar}
      aria-label={`Tema ${themeLabel(pref).toLowerCase()}. Tocar muda para ${proximo}.`}
      title={`Tema: ${themeLabel(pref).toLowerCase()}`}
      className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Icone className="size-[18px]" aria-hidden />
    </button>
  );
}
