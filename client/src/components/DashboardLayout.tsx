import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BarChart3,
  Briefcase,
  Camera,
  FileText,
  GripVertical,
  LayoutDashboard,
  LogOut,
  Mail,
  Package,
  PanelLeft,
  PieChart,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
  Crown,
  Target,
  Linkedin,
  UserCog,
} from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import {
  resolvePageIdForPath,
  userCanAccessPage,
  type PageId,
} from "@shared/pagePermissions";

const DEFAULT_MENU_ITEMS = [
  { id: "dashboard", icon: LayoutDashboard, label: "儀表板", path: "/" },
  { id: "quotes", icon: FileText, label: "報價單", path: "/quotes" },
  { id: "email-inquiries", icon: Mail, label: "詢價郵件", path: "/email-inquiries" },
  { id: "clients", icon: Users, label: "客戶管理", path: "/clients" },
  { id: "loyalty", icon: Crown, label: "會員方案", path: "/loyalty" },
  { id: "deliveries", icon: Package, label: "相片交付", path: "/deliveries" },
  { id: "ad-expenses", icon: BarChart3, label: "廣告開支", path: "/ad-expenses" },
  { id: "platform-efficiency", icon: PieChart, label: "平台效益分析", path: "/platform-efficiency" },
  { id: "ad-sync", icon: RefreshCw, label: "平台同步", path: "/ad-sync" },
  { id: "reports", icon: TrendingUp, label: "月度報表", path: "/reports" },
  { id: "freehunter-board", icon: Briefcase, label: "FH 工作板", path: "/freehunter-board" },
  { id: "expenses", icon: TrendingDown, label: "收入及支出", path: "/expenses" },
  { id: "follow-up", icon: Mail, label: "報價跟進", path: "/follow-up" },
  { id: "pitch-outreach", icon: Target, label: "開拓客戶", path: "/pitch-outreach" },
  { id: "linkedin-ops", icon: Linkedin, label: "LinkedIn 內容", path: "/linkedin-ops" },
  { id: "employees", icon: UserCog, label: "員工管理", path: "/employees" },
];

const SIDEBAR_WIDTH_KEY = "jd-sidebar-width";
const SIDEBAR_ORDER_KEY = "jd-sidebar-order";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 200;
const MAX_WIDTH = 320;

// Icon map for serialization
const ICON_MAP: Record<string, React.ElementType> = {
  dashboard: LayoutDashboard,
  quotes: FileText,
  clients: Users,
  deliveries: Package,
  "ad-expenses": BarChart3,
  "platform-efficiency": PieChart,
  "ad-sync": RefreshCw,
  reports: TrendingUp,
  "email-inquiries": Mail,
  "freehunter-board": Briefcase,
  "expenses": TrendingDown,
  "loyalty": Crown,
  "follow-up": Mail,
  "pitch-outreach": Target,
  "linkedin-ops": Linkedin,
  employees: UserCog,
};

// Safe localStorage wrapper – returns null if unavailable (e.g. iframe, SSR, blocked storage)
function safeLocalStorageGet(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function safeLocalStorageSet(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function loadMenuOrder() {
  try {
    const saved = safeLocalStorageGet(SIDEBAR_ORDER_KEY);
    if (!saved) return DEFAULT_MENU_ITEMS;
    const order: string[] = JSON.parse(saved);
    const reordered = order
      .map((id) => DEFAULT_MENU_ITEMS.find((item) => item.id === id))
      .filter(Boolean) as typeof DEFAULT_MENU_ITEMS;
    // Add any new items not in saved order
    const missing = DEFAULT_MENU_ITEMS.filter((item) => !order.includes(item.id));
    return [...reordered, ...missing];
  } catch {
    return DEFAULT_MENU_ITEMS;
  }
}

// Sortable nav item component
function SortableNavItem({
  item,
  isActive,
  isCollapsed,
  isDragging,
  onNavigate,
}: {
  item: typeof DEFAULT_MENU_ITEMS[0];
  isActive: boolean;
  isCollapsed: boolean;
  isDragging: boolean;
  onNavigate: (path: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSelfDragging,
  } = useSortable({ id: item.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSelfDragging ? 0.3 : 1,
  };

  return (
    <SidebarMenuItem ref={setNodeRef} style={style}>
      <div className="flex items-center group">
        {/* Drag handle — only visible when sidebar is expanded */}
        {!isCollapsed && (
          <div
            {...attributes}
            {...listeners}
            className="flex items-center justify-center w-5 h-10 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-40 hover:!opacity-70 transition-opacity shrink-0 ml-1"
            style={{ touchAction: "none" }}
            title="拖拉排序"
          >
            <GripVertical className="h-3 w-3 text-muted-foreground" />
          </div>
        )}
        <SidebarMenuButton
          isActive={isActive}
          onClick={() => onNavigate(item.path)}
          tooltip={item.label}
          className="h-10 transition-all font-light flex-1"
          style={
            isActive
              ? {
                  background: "rgba(212,168,67,0.12)",
                  borderLeft: "2px solid #d4a843",
                  color: "#d4a843",
                }
              : { borderLeft: "2px solid transparent" }
          }
        >
          <item.icon className="h-4 w-4 shrink-0" style={isActive ? { color: "#d4a843" } : {}} />
          <span style={{ fontSize: "0.85rem" }}>{item.label}</span>
        </SidebarMenuButton>
      </div>
    </SidebarMenuItem>
  );
}

function LoginScreen() {
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      utils.auth.me.setData(undefined, data as any);
      await utils.auth.me.invalidate();
      toast.success("登入成功");
    },
    onError: (e) => toast.error(e.message || "登入失敗"),
  });

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: "#0a0a0a" }}
    >
      <div className="flex flex-col items-center gap-6 p-8 max-w-sm w-full text-center">
        <div>
          <div
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: "2rem",
              color: "#d4a843",
              letterSpacing: "0.3em",
              marginBottom: "4px",
            }}
          >
            JD STUDIO
          </div>
          <div
            style={{
              fontSize: "0.65rem",
              color: "#666",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            Admin Management System
          </div>
        </div>
        <div
          style={{
            width: "40px",
            height: "1px",
            background: "linear-gradient(to right, transparent, #d4a843, transparent)",
          }}
        />
        <div>
          <h2 className="text-lg font-light text-foreground mb-2">請先登入</h2>
          <p className="text-sm text-muted-foreground">員工用帳號密碼；管理員可用 Manus</p>
        </div>

        <form
          className="w-full space-y-3 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            if (!username.trim() || !password) {
              toast.error("請輸入帳號及密碼");
              return;
            }
            loginMutation.mutate({ username: username.trim(), password });
          }}
        >
          <div>
            <label className="text-xs text-muted-foreground">帳號</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full px-3 py-2 rounded text-sm"
              style={{
                background: "#111",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#fff",
              }}
              placeholder="username"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full px-3 py-2 rounded text-sm"
              style={{
                background: "#111",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#fff",
              }}
              placeholder="••••••••"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loginMutation.isPending}
            style={{
              background: "#d4a843",
              color: "#0a0a0a",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontSize: "0.75rem",
            }}
          >
            {loginMutation.isPending ? "登入中…" : "帳號密碼登入"}
          </Button>
        </form>

        <div className="w-full flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex-1 h-px bg-white/10" />
          或
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <a href={getLoginUrl()} target="_top" style={{ width: "100%", display: "block" }}>
          <Button
            className="w-full"
            variant="outline"
            style={{
              borderColor: "rgba(212,168,67,0.4)",
              color: "#d4a843",
              fontWeight: 600,
              letterSpacing: "0.08em",
              fontSize: "0.75rem",
            }}
          >
            <Camera className="mr-2 h-4 w-4" />
            Manus 登入（管理員）
          </Button>
        </a>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = safeLocalStorageGet(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user, logout } = useAuth();

  useEffect(() => {
    safeLocalStorageSet(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return <LoginScreen />;
  }

  if (user.role !== "admin" && user.isActive === false) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ background: "#0a0a0a" }}
      >
        <div className="flex flex-col items-center gap-6 p-8 max-w-sm w-full text-center">
          <h2 className="text-lg font-light text-foreground">帳戶已停用</h2>
          <p className="text-sm text-muted-foreground">
            你的員工帳戶尚未開啟使用，請聯絡管理員。
          </p>
          <Button
            onClick={() => logout()}
            variant="outline"
            className="w-full"
          >
            登出
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: {
  children: React.ReactNode;
  setSidebarWidth: (w: number) => void;
}) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Sortable menu state
  const [menuItems, setMenuItems] = useState(() => loadMenuOrder());
  const [activeId, setActiveId] = useState<string | null>(null);

  const visibleMenuItems = useMemo(() => {
    return menuItems.filter((item) =>
      userCanAccessPage({
        role: user?.role,
        isActive: user?.isActive,
        allowedPages: user?.allowedPages,
        pageId: item.id as PageId,
      })
    );
  }, [menuItems, user?.role, user?.isActive, user?.allowedPages]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const activeMenuItem = visibleMenuItems.find((item) => item.path === location);

  // Redirect if current path is not permitted
  useEffect(() => {
    const pageId = resolvePageIdForPath(location);
    if (!pageId) return;
    const ok = userCanAccessPage({
      role: user?.role,
      isActive: user?.isActive,
      allowedPages: user?.allowedPages,
      pageId,
    });
    if (!ok) {
      const fallback = visibleMenuItems[0]?.path ?? "/";
      if (location !== fallback) setLocation(fallback);
    }
  }, [location, user, visibleMenuItems, setLocation]);

  // Close sidebar on mobile after navigation
  const handleNavigate = (path: string) => {
    setLocation(path);
    if (isMobile) {
      // Small delay to allow navigation to register first
      setTimeout(() => toggleSidebar(), 50);
    }
  };

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    setMenuItems((items) => {
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      const newItems = arrayMove(items, oldIndex, newIndex);
      safeLocalStorageSet(SIDEBAR_ORDER_KEY, JSON.stringify(newItems.map((i) => i.id)));
      return newItems;
    });
  }

  const activeItem = activeId ? menuItems.find((i) => i.id === activeId) : null;

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r" disableTransition={isResizing}>
          {/* Header */}
          <SidebarHeader className="h-16 justify-center border-b" style={{ borderColor: "rgba(212,168,67,0.2)" }}>
            <div className="flex items-center gap-3 px-2 w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded transition-colors shrink-0"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <div className="min-w-0 flex items-center gap-2">
                  <img
                    src="https://d2xsxph8kpxj0f.cloudfront.net/310519663457748523/VbnWSJV6UQ79sGuykqPPae/jd-studio-logo-dark_3217ad3b.png"
                    alt="JD Studio"
                    style={{
                      height: "36px",
                      width: "auto",
                      objectFit: "contain",
                      filter: "brightness(1.1) contrast(1.05)",
                    }}
                  />
                </div>
              )}
            </div>
          </SidebarHeader>

          {/* Navigation */}
          <SidebarContent className="gap-0 pt-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={visibleMenuItems.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <SidebarMenu className="px-2 py-1">
                  {visibleMenuItems.map((item) => {
                    const isActive =
                      location === item.path ||
                      (item.path !== "/" && location.startsWith(item.path));
                    return (
                      <SortableNavItem
                        key={item.id}
                        item={item}
                        isActive={isActive}
                        isCollapsed={isCollapsed}
                        isDragging={activeId === item.id}
                        onNavigate={handleNavigate}
                      />
                    );
                  })}
                </SidebarMenu>
              </SortableContext>

              {/* Drag overlay */}
              <DragOverlay>
                {activeItem ? (
                  <div
                    className="flex items-center gap-2 h-10 px-3 rounded-md text-sm font-light"
                    style={{
                      background: "rgba(212,168,67,0.15)",
                      border: "1px solid rgba(212,168,67,0.3)",
                      color: "#d4a843",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      cursor: "grabbing",
                    }}
                  >
                    <activeItem.icon className="h-4 w-4" style={{ color: "#d4a843" }} />
                    <span style={{ fontSize: "0.85rem" }}>{activeItem.label}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </SidebarContent>

          {/* Footer */}
          <SidebarFooter className="p-3 border-t" style={{ borderColor: "rgba(212,168,67,0.1)" }}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left focus:outline-none">
                  <Avatar className="h-8 w-8 shrink-0" style={{ border: "1px solid rgba(212,168,67,0.4)" }}>
                    <AvatarFallback
                      className="text-xs font-medium"
                      style={{ background: "rgba(212,168,67,0.15)", color: "#d4a843" }}
                    >
                      {user?.name?.charAt(0).toUpperCase() ?? "J"}
                    </AvatarFallback>
                  </Avatar>
                  {!isCollapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-none">{user?.name || "管理員"}</p>
                      <p className="text-xs text-muted-foreground truncate mt-1">{user?.email || ""}</p>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>登出系統</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        {/* Resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div
            className="flex h-14 items-center justify-between px-4 sticky top-0 z-40 border-b"
            style={{ background: "#0a0a0a", borderColor: "rgba(212,168,67,0.15)" }}
          >
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-8 w-8 rounded" />
              <span className="text-sm font-light">{activeMenuItem?.label ?? "JD Studio"}</span>
            </div>
            <span style={{ fontFamily: "'Playfair Display', serif", color: "#d4a843", fontSize: "0.9rem", letterSpacing: "0.15em" }}>
              JD
            </span>
          </div>
        )}
        <main className="flex-1 p-3 sm:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
