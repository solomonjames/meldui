import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "react-error-boundary";
import { AppCrashFallback } from "@/shared/components/error/app-crash-fallback";
import { ViewErrorFallback } from "@/shared/components/error/view-error-fallback";

// Suppress React error boundary console.error noise in test output
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalError;
});

// biome-ignore lint/style/useComponentExportOnlyModules: test helper
function ThrowingComponent({ message }: { message: string }) {
  throw new Error(message);
}

describe("AppCrashFallback", () => {
  it("renders error message and reload button", () => {
    render(<AppCrashFallback error={new Error("Fatal crash")} />);

    expect(screen.getByText("Meld hit an unexpected error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("shows error details when expanded", () => {
    render(<AppCrashFallback error={new Error("Fatal crash")} />);

    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText(/Fatal crash/)).toBeInTheDocument();
  });

  it("calls window.location.reload on reload button click", () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload: reloadMock },
      writable: true,
    });

    render(<AppCrashFallback error={new Error("crash")} />);

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reloadMock).toHaveBeenCalled();
  });
});

describe("ViewErrorFallback", () => {
  it("renders error message and retry button", () => {
    render(<ViewErrorFallback error={new Error("View failed")} resetErrorBoundary={vi.fn()} />);

    expect(screen.getByText("This view couldn't load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows error details when expanded", () => {
    render(<ViewErrorFallback error={new Error("View failed")} resetErrorBoundary={vi.fn()} />);

    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText(/View failed/)).toBeInTheDocument();
  });

  it("calls resetErrorBoundary on retry click", () => {
    const resetFn = vi.fn();
    render(<ViewErrorFallback error={new Error("oops")} resetErrorBoundary={resetFn} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(resetFn).toHaveBeenCalled();
  });
});

describe("ErrorBoundary integration", () => {
  it("catches rendering errors and shows ViewErrorFallback", () => {
    render(
      <ErrorBoundary FallbackComponent={ViewErrorFallback}>
        <ThrowingComponent message="render boom" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("This view couldn't load")).toBeInTheDocument();
  });

  it("catches rendering errors and shows AppCrashFallback", () => {
    render(
      <ErrorBoundary FallbackComponent={AppCrashFallback}>
        <ThrowingComponent message="app boom" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Meld hit an unexpected error")).toBeInTheDocument();
  });

  it("calls onError with boundary label when error is caught", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary
        FallbackComponent={ViewErrorFallback}
        onError={(error, info) => {
          onError(`[ErrorBoundary:backlog]`, error.message, info.componentStack);
        }}
      >
        <ThrowingComponent message="labeled error" />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(
      "[ErrorBoundary:backlog]",
      "labeled error",
      expect.any(String),
    );
  });

  it("resets when resetKeys change", () => {
    let shouldThrow = true;

    function MaybeThrow() {
      if (shouldThrow) throw new Error("conditional error");
      return <div>recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary FallbackComponent={ViewErrorFallback} resetKeys={["page-a"]}>
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("This view couldn't load")).toBeInTheDocument();

    // Stop throwing and change resetKeys to trigger reset
    shouldThrow = false;
    rerender(
      <ErrorBoundary FallbackComponent={ViewErrorFallback} resetKeys={["page-b"]}>
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("re-shows fallback when retry triggers same error", () => {
    function AlwaysThrow() {
      throw new Error("persistent error");
    }

    render(
      <ErrorBoundary FallbackComponent={ViewErrorFallback}>
        <AlwaysThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("This view couldn't load")).toBeInTheDocument();

    // Clicking retry re-renders AlwaysThrow which throws again
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("This view couldn't load")).toBeInTheDocument();
  });
});
