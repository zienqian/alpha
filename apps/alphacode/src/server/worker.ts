// Compatibility entry for supervisors started before the App Server extraction.
// They retain this path in memory; keeping it lets their normal idle handoff
// load the new worker without losing active sessions or in-memory credentials.
import "@alpha/alphacode-app-server/legacy-worker";
