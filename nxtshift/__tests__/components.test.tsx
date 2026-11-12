import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ActiveDeskCard } from "@/components/desk/ActiveDeskCard";
import { PingButton } from "@/components/desk/PingButton";
import { TopAlerts } from "@/components/desk/TopAlerts";
import { MyRequests } from "@/components/desk/MyRequests";
import type { PingRow } from "@/types/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JoinForm } from "@/features/auth/JoinForm";
import { joinWorkspace } from "@/features/auth/auth-service";

jest.mock("@/features/auth/auth-service", () => ({ joinWorkspace: jest.fn() }));
jest.mock("@/features/notifications/registration", () => ({ registerForPush: jest.fn() }));

describe("PingButton", () => {
  it("fires when enabled and exposes an accessible label", async () => {
    const onPress = jest.fn();
    await render(<PingButton onPress={onPress} disabled={false} loading={false} urgent hint="Sends: Urgent Issue" />);
    await fireEvent.press(screen.getByRole("button", { name: "Ping active desk" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("is disabled when no desk is active", async () => {
    const onPress = jest.fn();
    await render(<PingButton onPress={onPress} disabled loading={false} urgent={false} hint="No desk is active" />);
    await fireEvent.press(screen.getByRole("button", { name: "Ping active desk" }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("ActiveDeskCard", () => {
  it("shows NO ACTIVE SHIFT when nothing is on duty", async () => {
    await render(<ActiveDeskCard desks={[]} selected={null} onSelect={jest.fn()} timeZone="UTC" />);
    expect(screen.getByText("NO ACTIVE SHIFT")).toBeTruthy();
  });

  it("shows desk label and status only", async () => {
    await render(
      <ActiveDeskCard
        desks={[{ desk_label: "Front Desk", status: "awaiting_relief", ends_at: "2030-01-01T22:00:00Z" }]}
        selected={null}
        onSelect={jest.fn()}
        timeZone="UTC"
      />,
    );
    expect(screen.getByText("Front Desk")).toBeTruthy();
    expect(screen.getByText("AWAITING RELIEF")).toBeTruthy();
    expect(screen.getByText("until 22:00")).toBeTruthy();
  });

  it("asks the user to choose when multiple desks are active", async () => {
    const onSelect = jest.fn();
    await render(
      <ActiveDeskCard
        desks={[
          { desk_label: "Front Desk", status: "checked_in", ends_at: "2030-01-01T22:00:00Z" },
          { desk_label: "North Desk", status: "awaiting_relief", ends_at: "2030-01-01T22:00:00Z" },
        ]}
        selected={null}
        onSelect={onSelect}
        timeZone="UTC"
      />,
    );
    await fireEvent.press(screen.getByRole("radio", { name: /North Desk/ }));
    expect(onSelect).toHaveBeenCalledWith("North Desk");
  });
});

describe("TopAlerts", () => {
  it("renders at most three alerts with priority and validity", async () => {
    const now = Date.now();
    const alerts = Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      message: `Alert ${i}`,
      priority: i === 0 ? ("critical" as const) : ("normal" as const),
      created_at: new Date(now - i * 3600_000).toISOString(),
    }));
    await render(<TopAlerts alerts={alerts} isLoading={false} error={null} onRetry={jest.fn()} />);
    expect(screen.getByText("Alert 0")).toBeTruthy();
    expect(screen.getByText("CRITICAL")).toBeTruthy();
    expect(screen.queryByText("Alert 3")).toBeNull();
    expect(screen.getAllByText(/expires in/)).toHaveLength(3);
  });

  it("shows an empty state", async () => {
    await render(<TopAlerts alerts={[]} isLoading={false} error={null} onRetry={jest.fn()} />);
    expect(screen.getByText("No active alerts")).toBeTruthy();
  });
});

describe("MyRequests", () => {
  const ping = (o: Partial<PingRow>): PingRow => ({
    id: Math.random().toString(),
    category: "urgent_desk",
    preset: "urgent_issue",
    message: null,
    target_shift_id: "s",
    sender_member_id: "me",
    acknowledged_at: null,
    escalated_at: null,
    created_at: new Date().toISOString(),
    ...o,
  });

  it("only shows ACKNOWLEDGED when the server recorded it", async () => {
    await render(
      <MyRequests
        pings={[
          ping({}),
          ping({ acknowledged_at: new Date().toISOString() }),
          ping({ escalated_at: new Date().toISOString() }),
        ]}
      />,
    );
    expect(screen.getAllByText("ACKNOWLEDGED")).toHaveLength(1);
    expect(screen.getByText("WAITING")).toBeTruthy();
    expect(screen.getByText("ESCALATED")).toBeTruthy();
  });
});

describe("JoinForm", () => {
  it("validates input before contacting the server", async () => {
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <JoinForm onJoined={jest.fn()} />
      </QueryClientProvider>,
    );
    await fireEvent.changeText(screen.getByLabelText("Invite code"), "abc");
    await fireEvent.changeText(screen.getByLabelText("Callsign"), "x");
    await fireEvent.press(screen.getByRole("button", { name: "JOIN" }));
    await waitFor(() => expect(screen.getByText(/6-character code/)).toBeTruthy());
    expect(screen.getByText(/3–24 letters/)).toBeTruthy();
    expect(joinWorkspace).not.toHaveBeenCalled();
  });

  it("submits a normalized invite code", async () => {
    (joinWorkspace as jest.Mock).mockResolvedValueOnce({});
    const onJoined = jest.fn();
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <JoinForm onJoined={onJoined} />
      </QueryClientProvider>,
    );
    await fireEvent.changeText(screen.getByLabelText("Invite code"), "r7k2q9");
    await fireEvent.changeText(screen.getByLabelText("Callsign"), "Runner_Alpha");
    await fireEvent.press(screen.getByRole("button", { name: "JOIN" }));
    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(joinWorkspace).toHaveBeenCalledWith("R7K2Q9", "Runner_Alpha");
  });
});
