import { expect, test } from "bun:test";
import { registerNotificationIdentity } from "../src/notification-identity";

test("Windows toast identity registers the AlphaCode header and an unpacked icon for the current user", () => {
  const commands: string[][] = [];
  const icon = "C:\\Users\\Test User\\AppData\\Roaming\\alphacode-app\\notification.ico";
  registerNotificationIdentity({ id: "com.alpha.alphacodeapp", name: "AlphaCode", icon }, args => { commands.push(args); });
  const key = "HKCU\\Software\\Classes\\AppUserModelId\\com.alpha.alphacodeapp";
  expect(commands).toEqual([
    ["ADD", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", "AlphaCode", "/f"],
    ["ADD", key, "/v", "IconUri", "/t", "REG_SZ", "/d", icon, "/f"],
  ]);
});

test("registration failures reach the startup handler", () => {
  expect(() => registerNotificationIdentity({ id: "com.alpha.alphacodeapp", name: "AlphaCode", icon: "icon.ico" }, () => {
    throw new Error("Registry unavailable");
  })).toThrow("Registry unavailable");
});
