import { lazy, Suspense } from "react";
import { Route, Switch, useLocation } from "wouter";
import { PublicLayout } from "@/components/Layout";
import { ToastProvider, Spinner } from "@/components/ui";
import CmsPage from "@/components/CmsPage";
import Home from "@/pages/public/Home";
import { ServiziPage, ToelettaturaPage, SelfServicePage, PensionePage, FidelityPage, ContattiPage, NotFound } from "@/pages/public/Pages";
import { LoginPage, RegisterPage, ForgotPage, ResetPage } from "@/pages/public/Auth";

// aree riservate caricate a parte: il sito pubblico resta leggero
const BookingPage = lazy(() => import("@/pages/public/Booking"));
const ShopPage = lazy(() => import("@/pages/public/Shop"));
const AccountArea = lazy(() => import("@/pages/account/Account"));
const AdminArea = lazy(() => import("@/pages/admin/AdminLayout"));

export default function App() {
  const [loc] = useLocation();
  return (
    <ToastProvider>
      <Suspense fallback={<Spinner />}>
        {loc.startsWith("/admin") ? <AdminArea /> : (
          <PublicLayout>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/chi-siamo"><CmsPage slug="chi-siamo" mascot="welcome" fallbackTitle="Chi siamo" /></Route>
              <Route path="/toelettatura" component={ToelettaturaPage} />
              <Route path="/servizi" component={ServiziPage} />
              <Route path="/richiedi-prenotazione" component={BookingPage} />
              <Route path="/self-service" component={SelfServicePage} />
              <Route path="/pensione-casalinga" component={PensionePage} />
              <Route path="/fidelity-card" component={FidelityPage} />
              <Route path="/pet-shop" component={ShopPage} />
              <Route path="/contatti" component={ContattiPage} />
              <Route path="/login" component={LoginPage} />
              <Route path="/registrazione" component={RegisterPage} />
              <Route path="/password-dimenticata" component={ForgotPage} />
              <Route path="/reset-password" component={ResetPage} />
              <Route path="/privacy-policy"><CmsPage slug="privacy-policy" fallbackTitle="Privacy Policy" /></Route>
              <Route path="/cookie-policy"><CmsPage slug="cookie-policy" fallbackTitle="Cookie Policy" /></Route>
              <Route path="/condizioni-del-servizio"><CmsPage slug="condizioni-del-servizio" fallbackTitle="Condizioni del servizio" /></Route>
              <Route path="/account"><AccountArea /></Route>
              <Route path="/account/*"><AccountArea /></Route>
              <Route component={NotFound} />
            </Switch>
          </PublicLayout>
        )}
      </Suspense>
    </ToastProvider>
  );
}
