import { Logo } from '@/components/Logo';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-10">
      <Logo />
      <div className="text-center max-w-sm">
        <h1 className="text-3xl font-bold tracking-tight">SCRBL</h1>
        <p className="text-neutral-300 mt-2">Prototype • Add to Home Screen to try it like an app.</p>
      </div>

      <div className="w-full max-w-sm rounded-2xl p-4 bg-surface/60 border border-white/10">
        <button className="w-full rounded-xl py-4 bg-scrbl/20 text-scrbl font-semibold hover:bg-scrbl/30 transition">
          Start a walkthrough
        </button>
      </div>

      <p className="text-xs text-neutral-500">v0.0.1 • PWA</p>
    </div>
  );
}
