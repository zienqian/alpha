# AlphaCode App

The desktop product is named **AlphaCode**. Its source package is `alphacode-app`.
It provides desktop access using Electron and the existing Web UI.
Users navigate projects and sessions, compose formatted prompts, review streaming
messages and tool activity, manage approvals and queues, and inspect Skills and
Trace through the same components as the browser version.

The Bun App Server remains responsible for model execution, tools and persistence.
The Electron main process owns desktop integration and forwards requests to the
shared local service. Closing the UI must not terminate another client's work.

Windows x64 is the currently verified platform. Build outputs include a portable
application directory with Bun, ripgrep and production dependencies. Signed
installers and update publishing are not configured. First-time project/model
configuration still uses the CLI.
