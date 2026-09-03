import { redirect } from "next/navigation";

/** A raiz nao tem conteudo proprio: o middleware ja decide entrar ou inicio. */
export default function Root() {
  redirect("/inicio");
}
