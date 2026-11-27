import { execFileSync } from "node:child_process";

// Windows reads the toast header from this registration, independently of app.setName().
export function registerNotificationIdentity(
  identity: { id: string; name: string; icon: string },
  run: (args: string[]) => void = args => { execFileSync("reg.exe", args, { windowsHide: true, stdio: "ignore" }); },
) {
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${identity.id}`;
  for (const [name, value] of [["DisplayName", identity.name], ["IconUri", identity.icon]] as const) {
    run(["ADD", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"]);
  }
}
