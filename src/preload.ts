// Loaded with `node --import ./dist/preload.js` so the drop happens before the app's own
// modules (and their imports' top-level code) are evaluated — not merely before main() runs.
import { loadSecretsAndDropPrivileges } from "./secrets.js";

loadSecretsAndDropPrivileges();
