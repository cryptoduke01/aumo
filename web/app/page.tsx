import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Control, Thesis } from "@/components/landing/pinned-sections";
import { Markets } from "@/components/landing/markets";
import { Closing, Hero, Notes, RunsOn } from "@/components/landing/static-sections";
import site from "@/components/site/site.module.css";

// Home: Ink hero → pinned thesis → pinned markets on paper → pinned guardrails on Ink →
// what it runs on → research → closing banner → footer.
export default function Landing() {
  return (
    <div className={`${site.site} flex flex-1 flex-col`}>
      <SiteHeader variant="overlay" />
      <main>
        <Hero />
        <Thesis />
        <Markets />
        <Control />
        <RunsOn />
        <Notes />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
