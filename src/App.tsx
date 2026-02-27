const collections = [
  {
    title: "Studio Ream",
    description: "Signature warm-white sheets for sketches, storyboards, and client decks.",
    price: "$24 / 250 sheets",
    details: "120 gsm · soft tooth",
    swatches: ["#f6e6cf", "#f1d7b2", "#eccb9e"],
  },
  {
    title: "Letterpress Set",
    description: "Lux cotton blend with a weight that holds ink, emboss, and foil.",
    price: "$32 / 100 sheets",
    details: "180 gsm · cotton blend",
    swatches: ["#f7f0e6", "#e8ddcc", "#d9c7af"],
  },
  {
    title: "Everyday Draft",
    description: "Bright, smooth, and dependable for high-volume production runs.",
    price: "$18 / 500 sheets",
    details: "90 gsm · smooth finish",
    swatches: ["#f4f6f3", "#e4ede6", "#d2e0d6"],
  },
];

const features = [
  {
    title: "Texture you can feel",
    description: "Choose from linen, laid, vellum, and softgrain surfaces with tactile depth.",
  },
  {
    title: "Color-matched sets",
    description: "Curated palettes that hold true under studio lights and daylight alike.",
  },
  {
    title: "Cut to your workflow",
    description: "Trim sizes, rounded corners, and fold-ready scoring delivered in days.",
  },
  {
    title: "Reliable supply",
    description: "Small-batch runs with subscription replenishment and flexible shipping.",
  },
];

const customSteps = [
  {
    title: "Share your brief",
    description: "Send dimensions, weight, and finish. We respond with a fast quote.",
  },
  {
    title: "Approve a sample",
    description: "We cut a proof pack so you can test with your pens, inks, and presses.",
  },
  {
    title: "Receive your run",
    description: "Packed flat, humidity-controlled, and delivered in 3-5 business days.",
  },
];

export default function App() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="paper-noise" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-48 right-[-10%] h-[420px] w-[420px] rounded-full bg-[rgba(199,214,223,0.55)] blur-[120px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute top-48 left-[-15%] h-[520px] w-[520px] rounded-full bg-[rgba(221,182,163,0.5)] blur-[140px]"
        aria-hidden="true"
      />

      <header className="relative z-10">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgba(32,26,20,0.2)] bg-white/70 font-display text-lg text-[var(--paper-forest)]">
              GL
            </div>
            <div>
              <p className="font-display text-lg">Grain & Loom</p>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--paper-ink-soft)]">Paper Studio</p>
            </div>
          </div>
          <div className="hidden items-center gap-8 text-sm md:flex">
            <a className="transition hover:text-[var(--paper-forest)]" href="#collections">
              Collections
            </a>
            <a className="transition hover:text-[var(--paper-forest)]" href="#custom">
              Custom Orders
            </a>
            <a className="transition hover:text-[var(--paper-forest)]" href="#sustain">
              Stewardship
            </a>
          </div>
          <a
            className="rounded-full border border-[var(--paper-forest)] px-5 py-2 text-sm font-display tracking-wide text-[var(--paper-forest)] transition hover:bg-[var(--paper-forest)] hover:text-white"
            href="#quote"
          >
            Build a Quote
          </a>
        </nav>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="flex flex-col gap-8">
            <span className="paper-tag fade-up" style={{ animationDelay: "0ms" }}>
              Seasonally curated stock
            </span>
            <div className="fade-up" style={{ animationDelay: "80ms" }}>
              <h1 className="font-display text-balance text-[clamp(2.6rem,5vw,4.8rem)] leading-[1.02]">
                Paper that makes every idea feel deliberate.
              </h1>
            </div>
            <p
              className="text-balance text-lg text-[var(--paper-ink-soft)] md:text-xl fade-up"
              style={{ animationDelay: "140ms" }}
            >
              From velvety drafting sheets to letterpress-ready cotton, Grain & Loom crafts paper that
              elevates proposals, packaging, and daily rituals.
            </p>
            <div className="flex flex-wrap items-center gap-4 fade-up" style={{ animationDelay: "200ms" }}>
              <a
                className="rounded-full bg-[var(--paper-forest)] px-6 py-3 font-display text-sm uppercase tracking-[0.2em] text-white shadow-[0_20px_40px_-24px_rgba(32,64,54,0.6)] transition hover:-translate-y-0.5"
                href="#collections"
              >
                Shop collections
              </a>
              <a
                className="rounded-full border border-[rgba(32,26,20,0.2)] px-6 py-3 font-display text-sm uppercase tracking-[0.2em] text-[var(--paper-ink)] transition hover:border-[var(--paper-forest)]"
                href="#custom"
              >
                Request custom
              </a>
            </div>
            <div className="flex flex-wrap gap-8 pt-4 text-sm text-[var(--paper-ink-soft)]">
              <div>
                <p className="font-display text-2xl text-[var(--paper-ink)]">3-5 days</p>
                <p className="uppercase tracking-[0.3em]">Production</p>
              </div>
              <div>
                <p className="font-display text-2xl text-[var(--paper-ink)]">15 textures</p>
                <p className="uppercase tracking-[0.3em]">In stock</p>
              </div>
              <div>
                <p className="font-display text-2xl text-[var(--paper-ink)]">98%</p>
                <p className="uppercase tracking-[0.3em]">Recycled fiber</p>
              </div>
            </div>
          </div>
          <div className="relative min-h-[420px]">
            <div className="absolute left-2 top-10 h-[320px] w-[240px] float-slow">
              <div className="paper-sheet" style={{ transform: "rotate(-6deg)" }} />
              <div className="absolute bottom-6 left-6 rounded-full bg-white/80 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[var(--paper-ink-soft)]">
                Linen 120 gsm
              </div>
            </div>
            <div className="absolute right-4 top-0 h-[360px] w-[270px] float-fast">
              <div className="paper-sheet" style={{ transform: "rotate(4deg)" }} />
              <div className="absolute top-8 right-8 rounded-full border border-[rgba(32,26,20,0.2)] bg-white/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--paper-ink-soft)]">
                Warm white
              </div>
            </div>
            <div className="absolute bottom-0 left-16 h-[300px] w-[260px] float-slow">
              <div className="paper-sheet" style={{ transform: "rotate(10deg)" }} />
              <div className="absolute bottom-10 right-8 rounded-full bg-[var(--paper-forest)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-white">
                Studio pack
              </div>
            </div>
          </div>
        </section>

        <section id="collections" className="mx-auto max-w-6xl px-6 py-16">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="paper-tag">Featured collections</p>
              <h2 className="font-display text-3xl md:text-4xl">Paper with a point of view.</h2>
            </div>
            <p className="max-w-xl text-balance text-[var(--paper-ink-soft)]">
              Each collection blends weight, finish, and hue for a specific creative moment. Build
              a kit or order single reams.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {collections.map((item) => (
              <article key={item.title} className="paper-card flex h-full flex-col rounded-3xl p-6">
                <div className="flex items-center gap-3">
                  {item.swatches.map((swatch) => (
                    <span
                      key={swatch}
                      className="h-8 w-8 rounded-full border border-[rgba(32,26,20,0.15)]"
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                </div>
                <h3 className="font-display mt-6 text-2xl">{item.title}</h3>
                <p className="mt-3 text-[var(--paper-ink-soft)]">{item.description}</p>
                <div className="mt-auto pt-6">
                  <p className="font-display text-lg">{item.price}</p>
                  <p className="text-sm uppercase tracking-[0.3em] text-[var(--paper-ink-soft)]">
                    {item.details}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="paper-card rounded-[32px] p-8 md:p-10">
            <p className="paper-tag">Atelier standards</p>
            <h2 className="font-display mt-6 text-3xl md:text-4xl">For studios, agencies, and makers.</h2>
            <p className="mt-4 text-balance text-[var(--paper-ink-soft)]">
              We keep a rolling archive of limited-run paper, from muted neutrals to bold, seasonal
              tones. Layer them into proposals, packaging, and printed storytelling.
            </p>
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              {features.map((feature) => (
                <div key={feature.title} className="rounded-2xl border border-[rgba(32,26,20,0.12)] bg-white/60 p-4">
                  <h3 className="font-display text-lg">{feature.title}</h3>
                  <p className="mt-2 text-sm text-[var(--paper-ink-soft)]">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-between gap-6">
            <div className="paper-card rounded-[32px] p-8">
              <h3 className="font-display text-2xl">Palette Studio Box</h3>
              <p className="mt-3 text-[var(--paper-ink-soft)]">
                12 textures · 8 weights · 6 neutral hues. Delivered with a folding guide and swatch
                logbook.
              </p>
              <div className="mt-6 flex items-center justify-between">
                <p className="font-display text-xl">$68</p>
                <a
                  className="rounded-full bg-[var(--paper-forest)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-white"
                  href="#quote"
                >
                  Reserve
                </a>
              </div>
            </div>
            <div className="paper-card rounded-[32px] p-8">
              <h3 className="font-display text-2xl">Studio Membership</h3>
              <p className="mt-3 text-[var(--paper-ink-soft)]">
                Monthly replenishment tailored to your workflow. Pause or switch anytime.
              </p>
              <div className="mt-6 flex items-center justify-between">
                <p className="font-display text-xl">From $42 / month</p>
                <a
                  className="rounded-full border border-[rgba(32,26,20,0.2)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[var(--paper-ink)]"
                  href="#quote"
                >
                  Start
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="custom" className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="paper-tag">Custom orders</p>
            <h2 className="font-display mt-6 text-3xl md:text-4xl">
              Made-to-measure paper for ambitious print runs.
            </h2>
            <p className="mt-4 text-balance text-[var(--paper-ink-soft)]">
              Cut, score, and finish to match your packaging, invitations, and internal tooling. Our
              atelier team guides you from specification to shipment.
            </p>
            <div className="mt-8 space-y-4 text-sm text-[var(--paper-ink-soft)]">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-[var(--paper-forest)]" />
                Minimum run: 250 sheets per size.
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-[var(--paper-forest)]" />
                Custom hues in as little as 10 days.
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-[var(--paper-forest)]" />
                Pair with envelopes, liners, and wraps.
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {customSteps.map((step, index) => (
              <div key={step.title} className="paper-card flex gap-4 rounded-[28px] p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(32,26,20,0.2)] bg-white/70 font-display text-lg">
                  0{index + 1}
                </div>
                <div>
                  <h3 className="font-display text-xl">{step.title}</h3>
                  <p className="mt-2 text-[var(--paper-ink-soft)]">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="sustain" className="mx-auto max-w-6xl px-6 py-16">
          <div className="paper-card rounded-[40px] p-10">
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="paper-tag">Stewardship</p>
                <h2 className="font-display mt-6 text-3xl md:text-4xl">Designed to be kept, not wasted.</h2>
                <p className="mt-4 text-balance text-[var(--paper-ink-soft)]">
                  We partner with regional mills, recycle offcuts, and ship in plastic-free packaging. Every
                  order includes care guidance to preserve the texture and tone of your sheets.
                </p>
              </div>
              <div className="grid gap-6 sm:grid-cols-3">
                {[
                  { value: "98%", label: "Recycled fiber" },
                  { value: "12", label: "Regional mills" },
                  { value: "0", label: "Plastic fillers" },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-3xl border border-[rgba(32,26,20,0.12)] bg-white/60 p-6 text-center"
                  >
                    <p className="font-display text-3xl">{stat.value}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.3em] text-[var(--paper-ink-soft)]">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="quote" className="mx-auto max-w-6xl px-6 pb-24">
          <div className="paper-card flex flex-col items-start justify-between gap-8 rounded-[40px] p-10 md:flex-row md:items-center">
            <div>
              <p className="paper-tag">Start a run</p>
              <h2 className="font-display mt-6 text-3xl md:text-4xl">Tell us what you want to make.</h2>
              <p className="mt-3 text-balance text-[var(--paper-ink-soft)]">
                We will translate your requirements into a fast quote, sample pack, and production timeline.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <a
                className="rounded-full bg-[var(--paper-forest)] px-6 py-3 font-display text-sm uppercase tracking-[0.2em] text-white"
                href="mailto:studio@grainandloom.com"
              >
                Email studio
              </a>
              <a
                className="rounded-full border border-[rgba(32,26,20,0.2)] px-6 py-3 font-display text-sm uppercase tracking-[0.2em] text-[var(--paper-ink)]"
                href="tel:+1-555-013-0909"
              >
                Call atelier
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[rgba(32,26,20,0.08)] bg-white/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm">
          <p>© 2026 Grain & Loom Paper Studio</p>
          <div className="flex flex-wrap items-center gap-6">
            <a className="transition hover:text-[var(--paper-forest)]" href="#collections">
              Collections
            </a>
            <a className="transition hover:text-[var(--paper-forest)]" href="#custom">
              Custom Orders
            </a>
            <a className="transition hover:text-[var(--paper-forest)]" href="#quote">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
