import { createBrowserRouter } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { AdminRouteError } from "../components/RouteError";
import {
  AdminIndexRedirect,
  AdminRoot,
  RequireAdminAuth,
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
            ],
          },
        ],
      },
    ],
  },
  ]);
}
