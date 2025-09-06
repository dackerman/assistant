import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders conversation view", () => {
    render(<App />);
    expect(screen.getByText("New Conversation")).toBeInTheDocument();
    expect(screen.getByText("0 messages • Ready")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Type your message..."),
    ).toBeInTheDocument();
    expect(screen.getByText("Claude 3.5 Sonnet")).toBeInTheDocument();
  });
});
