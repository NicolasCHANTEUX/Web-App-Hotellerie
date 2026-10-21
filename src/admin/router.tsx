import { createBrowserRouter } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { AdminRouteError } from "../components/RouteError";
import {
  AdminIndexRedirect,
  AdminRoot,
  RequireAdminAuth,
  RequireCatalogAccess,
  RequireContactRequestAccess,
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
      { path: "activation", lazy: async () => ({ Component: (await import("../pages/admin/AdminActivation")).AdminActivation }) },
      {
        element: <RequireAdminAuth />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <AdminIndexRedirect /> },
              {
                path: "tableau-de-bord",
                lazy: async () => {
                  const { AdminDashboard } = await import("../pages/admin/AdminDashboard");
                  return { Component: () => <RequireReservationAccess><AdminDashboard /></RequireReservationAccess> };
                },
              },
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
              {
                path: "equipe",
                lazy: async () => {
                  const { AdminTeam } = await import("../pages/admin/AdminTeam");
                  return { Component: () => <RequireCatalogAccess><AdminTeam /></RequireCatalogAccess> };
                },
              },
              {
                path: "demandes",
                lazy: async () => {
                  const { AdminContactRequests } = await import("../pages/admin/AdminContactRequests");
                  return { Component: () => <RequireContactRequestAccess><AdminContactRequests /></RequireContactRequestAccess> };
                },
              },
              { path: "chambres", lazy: async () => ({ Component: (await import("../pages/admin/AdminRooms")).AdminRooms }) },
              {
                path: "tarifs",
                lazy: async () => {
                  const { AdminSeasons } = await import("../pages/admin/AdminSeasons");
                  return { Component: () => <RequireCatalogAccess><AdminSeasons /></RequireCatalogAccess> };
                },
              },
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
