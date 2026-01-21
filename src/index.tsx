import { render } from "@opentui/solid";
import { App } from "./ui/App";

// Initialize tools (must be imported early to register with Tool registry)
import "./tools/init";

// Parse CLI arguments
const args = process.argv.slice(2);
const expressMode = args.includes("--express") || args.includes("-e");

render(() => <App initialExpress={expressMode} />);
