import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-bg flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image src="/logo.png" alt="Rezonest" width={180} height={48} priority className="h-11 w-auto" />
          <p className="text-sm text-muted-foreground">Work OS · Agency management</p>
        </div>
        <div className="glass rounded-2xl border p-6 shadow-lg shadow-black/5">{children}</div>
        <p className="mt-6 text-center text-xs text-muted-foreground">© Rezonest Digital &amp; Services, Pune</p>
      </div>
    </main>
  );
}
