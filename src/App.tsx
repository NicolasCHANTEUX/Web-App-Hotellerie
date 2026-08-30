import { Outlet, ScrollRestoration } from "react-router-dom";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { RouteMetadata } from "./components/RouteMetadata";

export function App() {
  return (
    <div className="min-h-screen bg-ivory text-brown-900">
      <RouteMetadata />
      <Header />
      <main>
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}
