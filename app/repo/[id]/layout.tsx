import { RepoShell } from "@/components/repository/repo-shell";

export default async function RepoLayout({ children, params }: LayoutProps<"/repo/[id]">) {
  const { id } = await params;
  return <RepoShell id={id}>{children}</RepoShell>;
}
