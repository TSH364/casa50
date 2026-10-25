# Fluxo (Casa 50)

Finanças da casa do Vini e da Larissa. Next.js 15 + Supabase + Tailwind 4, tudo em pt-BR.

## Versão

O número no canto da tela (`v0.12`) vem de `version` no `package.json` e é atualizado à mão.

- Todo PR atualiza a versão com `npm version <x.y.z> --no-git-tag-version`, que acerta também o `package-lock.json`.
- Coisa nova sobe o segundo número: 0.12.0 → 0.13.0.
- Só conserto sobe o terceiro: 0.12.0 → 0.12.1.

## Migrações

- As migrações em `supabase/migrations/` são aplicadas sozinhas no merge na `main`, pela integração do Supabase com o GitHub ("Deploy to production").
- O nome de cada arquivo começa pela versão. Ele precisa ser igual ao que o banco registra em `supabase_migrations.schema_migrations`, senão a integração tenta aplicar de novo.
- O deploy da Vercel e o do banco correm em paralelo. Código que lê uma coluna nova tem que funcionar sem ela (ver `listCategories` em `src/data/queries.ts`), senão as telas caem até a migração entrar.
- Depois de mesclar um PR com migração, confira no banco se ela entrou.
- Funções `language sql` têm o corpo conferido na criação. Para funções que usam uma tabela criada na mesma migração, prefira plpgsql.

## Design

- As cores, a tipografia e os componentes estão em `DESIGN_SYSTEM.md`. Tela nova usa os tokens de lá, nunca hexadecimal solto.
- Duas skills ficam em `.claude/skills/` (do bencium-marketplace, licença MIT):
  - `design-audit`: auditoria visual em três fases. Só propõe; nada é implementado sem aprovação. Os documentos que ela pede são, aqui: `DESIGN_SYSTEM.md`, `docs/produto.md`, este arquivo e o próprio código. As lições vão na seção "Decisões e lições" do `DESIGN_SYSTEM.md`, não num `LESSONS.md`.
  - `ui-typography`: regras de texto da tela. Vale a versão em pt-BR da última seção do `DESIGN_SYSTEM.md`. O modelo de CSS dela (fonte com serifa, tamanho fluido) não se aplica.
- Para ver a tela de verdade: Chromium em 375px de largura, nos temas claro e escuro.

## Antes de subir

- `npx vitest run`
- `npx tsc --noEmit`
- `npm run build`
