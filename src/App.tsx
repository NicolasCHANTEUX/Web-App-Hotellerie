import { Outlet, ScrollRestoration } from "react-router-dom";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";

export function App() {
  return (
    <div className="min-h-screen bg-ivory text-brown-900">
      <Header />
      <main>
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}
