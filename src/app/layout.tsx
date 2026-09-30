import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import { THEME_COOKIE, parseTheme, themeAttribute, toasterTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fluxo – Finanças do Casal",
  description:
    "Central financeira compartilhada: faturas, categorias, parcelas, previsões, orçamentos e metas do casal.",
  applicationName: "Fluxo",
};

/**
 * A fonte do app, servida pelo proprio app (o next/font baixa no build): o
 * tema pedia "Inter" sem nunca carrega-la, e cada aparelho caia na fonte do
 * sistema.
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument",
  display: "swap",
});

const BARRA_ESCURA = "#08090c";
const BARRA_CLARA = "#f4f5f8";

export async function generateViewport(): Promise<Viewport> {
  const pref = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    // A barra do navegador no celular acompanha o tema: escura sobre um app
    // claro parece uma tarja.
    themeColor:
      pref === "claro"
        ? BARRA_CLARA
        : pref === "sistema"
          ? [
              { media: "(prefers-color-scheme: light)", color: BARRA_CLARA },
              { media: "(prefers-color-scheme: dark)", color: BARRA_ESCURA },
            ]
          : BARRA_ESCURA,
    // O app é lido em celular o tempo todo; travar o zoom prejudicaria
    // acessibilidade, então maximumScale fica livre de propósito.
    width: "device-width",
    initialScale: 1,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pref = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="pt-BR" data-theme={themeAttribute(pref)} className={sans.variable}>
      <body>
        {children}
        <Toaster
          theme={toasterTheme(pref)}
          position="top-center"
          toastOptions={{
            style: {
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-line)",
              color: "var(--color-ink)",
            },
          }}
        />
      </body>
    </html>
  );
}
