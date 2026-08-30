import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AdminLayout } from "./admin/AdminLayout";
import { AdminIndexRedirect, AdminRoot, RequireAdminAuth, RequirePlanningAccess, RequireReservationAccess } from "./admin/auth";

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
  {
    path: "/admin",
    element: <AdminRoot />,
    children: [
      { path: "connexion", lazy: async () => ({ Component: (await import("./pages/admin/AdminLogin")).AdminLogin }) },
      {
        element: <RequireAdminAuth />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <AdminIndexRedirect /> },
              {
                path: "reservations",
                lazy: async () => {
                  const { AdminBookings } = await import("./pages/admin/AdminBookings");
                  return { Component: () => <RequireReservationAccess><AdminBookings /></RequireReservationAccess> };
                },
              },
              {
                path: "planning",
                lazy: async () => {
                  const { AdminPlanning } = await import("./pages/admin/AdminPlanning");
                  return { Component: () => <RequirePlanningAccess><AdminPlanning /></RequirePlanningAccess> };
                },
              },
              { path: "chambres", lazy: async () => ({ Component: (await import("./pages/admin/AdminRooms")).AdminRooms }) },
            ],
          },
        ],
      },
    ],
  },
]);
