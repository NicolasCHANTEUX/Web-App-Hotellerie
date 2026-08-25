import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AdminLayout } from "./admin/AdminLayout";
import { AdminIndexRedirect, AdminRoot, RequireAdminAuth, RequirePlanningAccess, RequireReservationAccess } from "./admin/auth";
import { Home } from "./pages/Home";
import { Accommodations } from "./pages/Accommodations";
import { AccommodationDetail } from "./pages/AccommodationDetail";
import { Booking } from "./pages/Booking";
import { Confirmation } from "./pages/Confirmation";
import { Contact } from "./pages/Contact";
import { Legal } from "./pages/Legal";
import { AdminBookings } from "./pages/admin/AdminBookings";
import { AdminLogin } from "./pages/admin/AdminLogin";
import { AdminRooms } from "./pages/admin/AdminRooms";
import { AdminPlanning } from "./pages/admin/AdminPlanning";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "hebergements", element: <Accommodations /> },
      { path: "hebergements/:slug", element: <AccommodationDetail /> },
      { path: "reservation", element: <Booking /> },
      { path: "confirmation", element: <Confirmation /> },
      { path: "contact", element: <Contact /> },
      { path: "mentions-legales", element: <Legal /> },
    ],
  },
  {
    path: "/admin",
    element: <AdminRoot />,
    children: [
      { path: "connexion", element: <AdminLogin /> },
      {
        element: <RequireAdminAuth />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <AdminIndexRedirect /> },
              { path: "reservations", element: <RequireReservationAccess><AdminBookings /></RequireReservationAccess> },
              { path: "planning", element: <RequirePlanningAccess><AdminPlanning /></RequirePlanningAccess> },
              { path: "chambres", element: <AdminRooms /> },
            ],
          },
        ],
      },
    ],
  },
]);
