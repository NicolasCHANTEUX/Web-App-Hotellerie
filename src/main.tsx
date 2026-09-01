import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./index.css";

if (window.location.pathname === "/") {
  const heroPreload = document.createElement("link");
  heroPreload.rel = "preload";
  heroPreload.as = "image";
  heroPreload.type = "image/avif";
  heroPreload.href = "/images/hotel/hero-1280.avif";
  heroPreload.setAttribute("imagesrcset", "/images/hotel/hero-768.avif 768w, /images/hotel/hero-1280.avif 1280w, /images/hotel/hero-1920.avif 1920w");
  heroPreload.setAttribute("imagesizes", "100vw");
  heroPreload.setAttribute("fetchpriority", "high");
  document.head.append(heroPreload);
}

const root = createRoot(document.getElementById("root")!);
const smokeWindow = window as Window & { __RIVAGE_CAPTURE_ROOT__?: (unmount: () => void) => void };
const isSmokeRender = Boolean(smokeWindow.__RIVAGE_CAPTURE_ROOT__);

const routerPromise = window.location.pathname.startsWith("/admin")
  ? import("./admin/router").then((module) => module.createAdminRouter())
  : Promise.resolve(router);

void routerPromise.then(async (activeRouter) => {
  if (!activeRouter.state.initialized) {
    await new Promise<void>((resolve) => {
      const unsubscribe = activeRouter.subscribe((state) => {
        if (!state.initialized) return;
        unsubscribe();
        resolve();
      });
    });
  }
  const application = (
    <RouterProvider router={activeRouter} />
  );
  root.render(isSmokeRender ? application : (
    <StrictMode>
      {application}
    </StrictMode>
  ));
  smokeWindow.__RIVAGE_CAPTURE_ROOT__?.(() => {
    activeRouter.dispose();
    root.unmount();
  });
});
