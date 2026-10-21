import { createBrowserRouter } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { AdminRouteError } from "../components/RouteError";
import {
  AdminIndexRedirect,
  AdminRoot,
  RequireAdminAuth,
  RequireCatalogAccess,
  RequirePlanningAccess,
  RequireReservationAccess,
} from "./auth";

export function createAdminRouter() {
  return createBrowserRouter([
  {
    path: "/admin",
    element: <AdminRoot />,
    errorElement: <AdminRouteError />,
    children: [
      { path: "connexion", lazy: async () => ({ Component: (await import("../pages/admin/AdminLogin")).AdminLogin }) },
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
                  const { AdminBookings } = await import("../pages/admin/AdminBookings");
                  return { Component: () => <RequireReservationAccess><AdminBookings /></RequireReservationAccess> };
                },
              },
              {
                path: "planning",
                lazy: async () => {
                  const { AdminPlanning } = await import("../pages/admin/AdminPlanning");
                  return { Component: () => <RequirePlanningAccess><AdminPlanning /></RequirePlanningAccess> };
                },
              },
              { path: "chambres", lazy: async () => ({ Component: (await import("../pages/admin/AdminRooms")).AdminRooms }) },
              {
                path: "options",
                lazy: async () => {
                  const { AdminExtras } = await import("../pages/admin/AdminExtras");
                  return { Component: () => <RequireCatalogAccess><AdminExtras /></RequireCatalogAccess> };
                },
              },
              {
                path: "taxe-de-sejour",
                lazy: async () => {
                  const { AdminTouristTaxes } = await import("../pages/admin/AdminTouristTaxes");
                  return { Component: () => <RequireCatalogAccess><AdminTouristTaxes /></RequireCatalogAccess> };
                },
              },
              {
                path: "etablissement",
                lazy: async () => {
                  const { AdminProperty } = await import("../pages/admin/AdminProperty");
                  return { Component: () => <RequireCatalogAccess><AdminProperty /></RequireCatalogAccess> };
                },
              },
            ],
          },
        ],
      },
    ],
  },
  ]);
}
