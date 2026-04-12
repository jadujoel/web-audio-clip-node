import { createRoot } from "./react-dom-runtime";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
