import { lazy, Suspense, useEffect, useRef } from "react";
import { Route, Switch, useLocation } from "wouter";
import { PublicLayout } from "@/components/Layout";
import { ToastProvider, Spinner } from "@/components/ui";
import CmsPage from "@/components/CmsPage";
import Home from "@/pages/public/Home";
import AboutPage from "@/pages/public/About";
import { ServiziPage, ToelettaturaPage, SelfServicePage, PensionePage, FidelityPage, ContattiPage, NotFound } from "@/pages/public/Pages";
import { LoginPage, RegisterPage, ForgotPage, ResetPage, ForceChangePasswordPage, VerifyEmailPage } from "@/pages/public/Auth";
import { useMe } from "@/lib/auth";
import { logoutOneSignal } from "@/lib/onesignal";

// aree riservate caricate a parte: il sito pubblico resta leggero
const BookingPage = lazy(() => import("@/pages/public/Booking"));
const ShopPage = lazy(() => import("@/pages/public/Shop"));
const AccountArea = lazy(() => import("@/pages/account/Account"));
const AdminArea = lazy(() => import("@/pages/admin/AdminLayout"));

export default function App() {
  const [loc] = useLocation();
  const { data: me } = useMe();
  const previousUser = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const nextId = me?.id ?? (me === null ? null : undefined);
    if (nextId === undefined) return;
    if (previousUser.current !== undefined && previousUser.current !== nextId) void logoutOneSignal();
    if (nextId === null) void logoutOneSignal();
    previousUser.current = nextId;
  }, [me?.id, me]);
  // password temporanea: nessuna altra schermata finché non viene cambiata
  if (me?.mustChangePassword) return <ToastProvider><PublicLayout><ForceChangePasswordPage /></PublicLayout></ToastProvider>;
  return (
    <ToastProvider>
      <Suspense fallback={<Spinner />}>
        {loc.startsWith("/admin") ? <AdminArea /> : (
          <PublicLayout>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/chi-siamo" component={AboutPage} />
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
              <Route path="/cambia-password" component={ForceChangePasswordPage} />
              <Route path="/verifica-email" component={VerifyEmailPage} />
              <Route path="/installa-app"><CmsPage slug="installa-app" mascot="welcome" fallbackTitle="Installa l'app" /></Route>
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
