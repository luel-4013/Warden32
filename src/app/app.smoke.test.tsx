import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import App from "./App";
import { AppStoreProvider } from "./store";
import OverviewPage from "./pages/OverviewPage";
import DevicesPage from "./pages/DevicesPage";
import ActivityPage from "./pages/ActivityPage";
import RulesPage from "./pages/RulesPage";
import TrafficPage from "./pages/TrafficPage";
import AttacksPage from "./pages/AttacksPage";
import IncidentPage from "./pages/IncidentPage";
import ResourcesPage from "./pages/ResourcesPage";
import ExperimentsPage from "./pages/ExperimentsPage";
import ComparePage from "./pages/ComparePage";
import HardwarePage from "./pages/HardwarePage";
import RegistryPage from "./pages/RegistryPage";
import DocsPage from "./pages/DocsPage";

beforeAll(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key)
    }
  });
});

describe("app smoke", () => {
  it("renders the shell with the default page", () => {
    const html = renderToString(<App />);
    expect(html).toContain("WARDEN32");
    expect(html).toContain("EXPLORER");
  });

  it("renders every page without throwing", () => {
    const pages: [string, () => JSX.Element][] = [
      ["OverviewPage", OverviewPage],
      ["DevicesPage", DevicesPage],
      ["ActivityPage", ActivityPage],
      ["RulesPage", RulesPage],
      ["TrafficPage", TrafficPage],
      ["AttacksPage", AttacksPage],
      ["IncidentPage", IncidentPage],
      ["ResourcesPage", ResourcesPage],
      ["ExperimentsPage", ExperimentsPage],
      ["ComparePage", ComparePage],
      ["HardwarePage", HardwarePage],
      ["RegistryPage", RegistryPage],
      ["DocsPage", DocsPage]
    ];
    for (const [name, Page] of pages) {
      const html = renderToString(
        <AppStoreProvider>
          <Page />
        </AppStoreProvider>
      );
      expect(html.length, `${name} rendered empty`).toBeGreaterThan(80);
    }
  });
});
