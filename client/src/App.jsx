import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Home from './pages/Home.jsx';
import Priority from './pages/Priority.jsx';
import Alerts from './pages/Alerts.jsx';
import Reports from './pages/Reports.jsx';
import Students from './pages/Students.jsx';
import StudentImport from './pages/StudentImport.jsx';
import StudentDetail from './pages/StudentDetail.jsx';
import Expenses from './pages/Expenses.jsx';
import Bills from './pages/Bills.jsx';
import Forecast from './pages/Forecast.jsx';
import Simulator from './pages/Simulator.jsx';
import AiAssistant from './pages/AiAssistant.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceForm from './pages/InvoiceForm.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import Settings from './pages/Settings.jsx';
import More from './pages/More.jsx';

function Loading() { return <div className="center-screen">Loading...</div>; }

function Protected() {
  const { user, profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.onboarded) return <Navigate to="/onboarding" replace />;
  return <AppShell />;
}

function PublicOnly({ children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (user && profile?.onboarded) return <Navigate to="/home" replace />;
  if (user) return <Navigate to="/onboarding" replace />;
  return children;
}

function OnboardingGate() {
  const { user, profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.onboarded) return <Navigate to="/home" replace />;
  return <Onboarding />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<OnboardingGate />} />
      <Route path="/" element={<Protected />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<Home />} />
        <Route path="priority" element={<Priority />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="reports" element={<Reports />} />
        <Route path="students" element={<Students />} />
        <Route path="students/import" element={<StudentImport />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<InvoiceForm />} />
        <Route path="invoices/:id/edit" element={<InvoiceForm />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="bills" element={<Bills />} />
        <Route path="forecast" element={<Forecast />} />
        <Route path="forecast/simulate" element={<Simulator />} />
        <Route path="ai" element={<AiAssistant />} />
        <Route path="cash-flow" element={<Forecast />} />
        <Route path="more" element={<More />} />
        <Route path="more/payments" element={<Invoices />} />
        <Route path="more/expenses" element={<Expenses />} />
        <Route path="more/bills" element={<Bills />} />
        <Route path="more/settings" element={<Settings />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
