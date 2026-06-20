import { getSession } from "@/lib/auth/session";

export default async function DashboardPage() {
  const session = await getSession();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background text-foreground">
      <h1 className="text-2xl font-bold">AdOps Intelligence</h1>
      <p className="text-sm text-muted-foreground" data-testid="welcome">
        Signed in as {session?.name ?? "unknown"} ({session?.role})
      </p>
    </main>
  );
}
