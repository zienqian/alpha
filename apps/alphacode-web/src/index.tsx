import { createRoot } from "react-dom/client";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <AppProviders>
    <App />
  </AppProviders>,
);
