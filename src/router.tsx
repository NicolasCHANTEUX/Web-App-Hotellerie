import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, lazy: async () => ({ Component: (await import("./pages/Home")).Home }) },
      { path: "hebergements", lazy: async () => ({ Component: (await import("./pages/Accommodations")).Accommodations }) },
      { path: "hebergements/:slug", lazy: async () => ({ Component: (await import("./pages/AccommodationDetail")).AccommodationDetail }) },
      { path: "reservation", lazy: async () => ({ Component: (await import("./pages/Booking")).Booking }) },
      { path: "confirmation", lazy: async () => ({ Component: (await import("./pages/Confirmation")).Confirmation }) },
      { path: "contact", lazy: async () => ({ Component: (await import("./pages/Contact")).Contact }) },
      { path: "mentions-legales", lazy: async () => ({ Component: (await import("./pages/Legal")).Legal }) },
    ],
  },
]);
