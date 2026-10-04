"use client";

import { FiltrosCompactos } from "@/components/filtros-compactos";

/** Os filtros do Inicio: a pilula compartilhada com Extratos (`FiltrosCompactos`). */
export function FiltrosInicio(props: Omit<React.ComponentProps<typeof FiltrosCompactos>, "descricao">) {
  return <FiltrosCompactos {...props} descricao="O recorte vale para o Início inteiro." />;
}
