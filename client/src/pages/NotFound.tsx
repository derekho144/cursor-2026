import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "#0a0a0a" }}
    >
      <div className="text-center">
        <div
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: "6rem",
            color: "rgba(212,168,67,0.15)",
            lineHeight: 1,
            letterSpacing: "0.1em",
          }}
        >
          404
        </div>
        <div
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: "1.2rem",
            color: "#d4a843",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            marginTop: "16px",
          }}
        >
          JD STUDIO
        </div>
        <div
          style={{
            width: "40px",
            height: "1px",
            background: "linear-gradient(to right, transparent, #d4a843, transparent)",
            margin: "16px auto",
          }}
        />
        <p className="text-sm text-muted-foreground mb-8">找不到此頁面</p>
        <button
          onClick={() => setLocation("/")}
          className="px-6 py-2.5 text-xs transition-all hover:opacity-80"
          style={{
            border: "1px solid rgba(212,168,67,0.4)",
            color: "#d4a843",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            borderRadius: "2px",
          }}
        >
          返回儀表板
        </button>
      </div>
    </div>
  );
}
