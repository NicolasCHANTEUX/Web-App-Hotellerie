import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { Home } from "./pages/Home";
import { Accommodations } from "./pages/Accommodations";
import { AccommodationDetail } from "./pages/AccommodationDetail";
import { Booking } from "./pages/Booking";
import { Confirmation } from "./pages/Confirmation";
import { Contact } from "./pages/Contact";
import { Legal } from "./pages/Legal";

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
]);
