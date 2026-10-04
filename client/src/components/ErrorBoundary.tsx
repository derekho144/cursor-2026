import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || "";
      const isChunkError =
        /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|error loading dynamically imported module/i.test(
          message
        );
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">
              {isChunkError ? "頁面版本已更新，請重新載入" : "An unexpected error occurred."}
            </h2>
            {isChunkError && (
              <p className="mb-4 text-sm text-muted-foreground text-center">
                剛完成部署後，舊分頁可能會載入失效的 JS chunk。撳下面重新載入即可。
              </p>
            )}

            {(this.state.error?.stack || this.state.error?.message) && (
              <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
                <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                  {this.state.error?.stack || this.state.error?.message}
                </pre>
              </div>
            )}

            <button
              onClick={() => {
                try {
                  sessionStorage.removeItem("jd-chunk-reload");
                } catch {
                  /* private mode */
                }
                window.location.reload();
              }}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
