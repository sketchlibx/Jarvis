import { describe, it, expect } from "vitest";
import { UnimplementedDeviceChannel } from "../../device/DeviceChannel";
import { NoScreenCaptureProvider } from "../../screen/ScreenCaptureProvider";
import { UnimplementedCommunicationProvider } from "../../communication/CommunicationProvider";
import { UnimplementedWebSearchProvider } from "../../websearch/WebSearchProvider";

describe("Phase 6 adversarial tests — spec section 24", () => {
  describe("remote execution bypass", () => {
    it("DeviceChannel.sendTransfer always refuses — no execution path exists to bypass", async () => {
      const channel = new UnimplementedDeviceChannel();
      await expect(
        channel.sendTransfer(
          { kind: "approved_task", payload: { maliciousScript: "rm -rf /" }, fromDevice: { deviceId: "a", deviceName: "A" }, toDevice: { deviceId: "b", deviceName: "B" } },
          { approvedByUser: true, approvedAt: new Date().toISOString() }
        )
      ).rejects.toThrow();
    });

    it("pairing never auto-succeeds, even with a well-formed device identity", async () => {
      const channel = new UnimplementedDeviceChannel();
      const paired = await channel.requestPairing({ deviceId: "x", deviceName: "Attacker Device" });
      expect(paired).toBe(false);
    });
  });

  describe("screen capture without permission", () => {
    it("NoScreenCaptureProvider never returns a frame, regardless of requested mode", async () => {
      const provider = new NoScreenCaptureProvider();
      await expect(provider.capture("full_screen")).rejects.toThrow();
    });

    it("NoScreenCaptureProvider reports permission as never granted", () => {
      const provider = new NoScreenCaptureProvider();
      expect(provider.getPermissionState().granted).toBe(false);
    });
  });

  describe("communication provider — no fake platform control", () => {
    it("answer/reject/sendMessage/placeOutgoingCall all refuse on an unconnected platform", async () => {
      const provider = new UnimplementedCommunicationProvider("Discord");
      await expect(provider.answer("call1")).rejects.toThrow();
      await expect(provider.reject("call1")).rejects.toThrow();
      await expect(provider.sendMessage("user1", "hello")).rejects.toThrow();
      await expect(provider.placeOutgoingCall("user1")).rejects.toThrow();
    });
  });

  describe("web search — no fabricated results", () => {
    it("UnimplementedWebSearchProvider never returns fabricated results", async () => {
      const provider = new UnimplementedWebSearchProvider();
      await expect(provider.search("anything")).rejects.toThrow();
    });
  });
});
