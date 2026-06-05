import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the main dashboard from mock data", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Local Smart Room" })).toBeInTheDocument();
    expect(screen.getByLabelText("Connection status")).toHaveTextContent("Mock data");
    expect(screen.getByRole("heading", { name: "Recent events" })).toBeInTheDocument();
  });

  it("keeps requested power separate from reported power", () => {
    render(<App />);

    expect(screen.getByText("Reported power").nextElementSibling).toHaveTextContent("off");
    expect(screen.getByText("Requested power").nextElementSibling).toHaveTextContent("on");
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("shows stale and offline device health labels", () => {
    render(<App />);

    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("renders platform event feed entries from mock state", () => {
    render(<App />);

    expect(screen.getByText("command.requested")).toBeInTheDocument();
    expect(screen.getByText("command.dispatched")).toBeInTheDocument();
    expect(screen.getByText("device.state.reported")).toBeInTheDocument();
    expect(screen.getByText("simulator-adapter")).toBeInTheDocument();
  });
});
