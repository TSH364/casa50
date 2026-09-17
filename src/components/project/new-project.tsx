"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createProject } from "@/actions/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/** O primeiro passo do projeto: dar um nome a ele. */
export function NewProject() {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function criar() {
    if (!name.trim()) {
      toast.error("Dê um nome ao projeto.");
      return;
    }
    startTransition(async () => {
      const r = await createProject({ name });
      if (r.error) toast.error(r.error);
      else toast.success("Projeto criado.");
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome do projeto (ex.: Reforma do apartamento)"
        className="min-w-0 flex-1"
        aria-label="Nome do projeto"
      />
      <Button disabled={pending} onClick={criar}>
        Criar
      </Button>
    </div>
  );
}
