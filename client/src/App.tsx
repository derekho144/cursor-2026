import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";

// Eagerly load the most-visited pages for instant navigation
import Dashboard from "./pages/Dashboard";
import QuotesList from "./pages/QuotesList";

// Lazy-load all other pages to reduce initial bundle size
const QuoteForm = lazy(() => import("./pages/QuoteForm"));
const QuoteDetail = lazy(() => import("./pages/QuoteDetail"));
const AdExpenses = lazy(() => import("./pages/AdExpenses"));
const AdSync = lazy(() => import("./pages/AdSync"));
const MonthlyReport = lazy(() => import("./pages/MonthlyReport"));
const PlatformEfficiency = lazy(() => import("./pages/PlatformEfficiency"));
const GoogleAdsQuality = lazy(() => import("./pages/GoogleAdsQuality"));
const ClientsList = lazy(() => import("./pages/ClientsList"));
const ClientDetail = lazy(() => import("./pages/ClientDetail"));
const DeliveryList = lazy(() => import("./pages/DeliveryList"));
const DeliveryPage = lazy(() => import("./pages/DeliveryPage"));
const SignPage = lazy(() => import("./pages/SignPage"));
const QuotePrintPage = lazy(() => import("./pages/QuotePrintPage"));
const EmailInquiries = lazy(() => import("./pages/EmailInquiries"));
const FreehunterBoard = lazy(() => import("./pages/FreehunterBoard"));
const Expenses = lazy(() => import("./pages/Expenses"));
const LoyaltyPage = lazy(() => import("./pages/Loyalty"));
const ReceiptPrintPage = lazy(() => import("./pages/ReceiptPrintPage"));
const QuoteFollowUp = lazy(() => import("./pages/QuoteFollowUp"));
const PitchOutreach = lazy(() => import("./pages/PitchOutreach"));
const LinkedInOps = lazy(() => import("./pages/LinkedInOps"));
const AcceptedMerchantsBank = lazy(() => import("./pages/AcceptedMerchantsBank"));
const Employees = lazy(() => import("./pages/Employees"));
const PricingLearning = lazy(() => import("./pages/PricingLearning"));

// Minimal spinner shown while lazy chunks are loading
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "rgba(212,168,67,0.6)", borderTopColor: "transparent" }} />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/quotes" component={QuotesList} />
        <Route path="/quotes/accepted-merchants" component={AcceptedMerchantsBank} />
        <Route path="/quotes/new" component={QuoteForm} />
        <Route path="/quotes/:id/edit" component={QuoteForm} />
        <Route path="/quotes/:id" component={QuoteDetail} />
        <Route path="/ad-expenses" component={AdExpenses} />
        <Route path="/ad-sync" component={AdSync} />
        <Route path="/reports" component={MonthlyReport} />
        <Route path="/platform-efficiency" component={PlatformEfficiency} />
        <Route path="/google-ads-quality" component={GoogleAdsQuality} />
        <Route path="/clients" component={ClientsList} />
        <Route path="/clients/:id" component={ClientDetail} />
        <Route path="/deliveries" component={DeliveryList} />
        <Route path="/delivery/:token" component={DeliveryPage} />
        <Route path="/sign/:token" component={SignPage} />
        <Route path="/print/quote/:id" component={QuotePrintPage} />
        <Route path="/receipt/:token" component={ReceiptPrintPage} />
        <Route path="/email-inquiries" component={EmailInquiries} />
        <Route path="/freehunter-board" component={FreehunterBoard} />
        <Route path="/expenses" component={Expenses} />
        <Route path="/loyalty" component={LoyaltyPage} />
        <Route path="/follow-up" component={QuoteFollowUp} />
        <Route path="/pitch-outreach" component={PitchOutreach} />
        <Route path="/linkedin-ops" component={LinkedInOps} />
        <Route path="/employees" component={Employees} />
        <Route path="/pricing-learning" component={PricingLearning} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <LanguageProvider>
        <TooltipProvider>
          <Toaster
            theme="dark"
            toastOptions={{
              style: {
                background: "#111",
                border: "1px solid rgba(212,168,67,0.3)",
                color: "#e8e0d0",
              },
            }}
          />
          <Router />
        </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
