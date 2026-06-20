export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-16">
        <div className="mb-6 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-200">
          RS Forge AI · Swift Memory Leak Analyzer
        </div>

        <h1 className="max-w-4xl text-center text-4xl font-bold tracking-tight sm:text-6xl">
          Find iOS memory leaks before they crash your app.
        </h1>

        <p className="mt-6 max-w-2xl text-center text-lg text-slate-300">
          Paste Swift code and get retain-cycle explanation, exact fix, and
          Xcode verification steps.
        </p>

        <div className="mt-10 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Issue Type
              </label>
              <select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-200 outline-none focus:border-cyan-400">
                <option>Memory Leak</option>
                <option>Retain Cycle</option>
                <option>Crash Risk</option>
                <option>Performance</option>
                <option>Kiosk / Long-running Memory Growth</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Mode
              </label>
              <select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-200 outline-none focus:border-cyan-400">
                <option>Beginner Mode</option>
                <option>Developer Mode</option>
                <option>Team Review Mode</option>
              </select>
            </div>
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Paste Swift Code
            </label>
            <textarea
              className="min-h-64 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-200 outline-none focus:border-cyan-400"
              placeholder="Paste your Swift ViewController, Cell, ViewModel, or closure code here..."
            />
          </div>

          <button className="mt-5 w-full rounded-lg bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300">
            Analyze Memory Risk
          </button>
        </div>

        <div className="mt-10 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="font-semibold">Retain Chain</h3>
            <p className="mt-2 text-sm text-slate-400">
              Understand what is holding your ViewController in memory.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="font-semibold">Exact Fix</h3>
            <p className="mt-2 text-sm text-slate-400">
              Get practical Swift fixes like weak self, cleanup, and lifecycle handling.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="font-semibold">Xcode Verify</h3>
            <p className="mt-2 text-sm text-slate-400">
              Learn how to verify deinit, Memory Graph, and repeated-flow memory growth.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}