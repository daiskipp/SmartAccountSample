import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { useAuth } from "./auth";
import { configuredSmartAccountKit } from "./smart-account/config";
import "./index.css";

function App(): React.JSX.Element {
  const kit = useMemo(() => configuredSmartAccountKit(import.meta.env), []);
  const auth = useAuth();
  return <RouterProvider router={router} context={{ kit, auth }} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
