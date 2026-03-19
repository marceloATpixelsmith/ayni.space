import { createRoot } from "react-dom/client";
import App from "./App";
import { initFrontendObservability } from "@/lib/observability";
import "./index.css";

initFrontendObservability();

createRoot(document.getElementById("root")!).render(<App />);
