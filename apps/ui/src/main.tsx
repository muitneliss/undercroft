import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
// Side-effect import: Vite extracts this into a hashed CSS asset the control plane serves.
import "./index.css";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
